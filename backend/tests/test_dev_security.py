"""Developer account security E2E (Convex HTTP). Run: bash dev_sec_env.sh add && pytest test_dev_security.py; bash dev_sec_env.sh restore"""
import base64, hashlib, hmac, json, os, secrets, struct, subprocess, time
import pytest, requests

SITE = os.environ.get("CONVEX_SITE", "https://fearless-ostrich-878.eu-west-1.convex.site") + "/api"
PHONE = "+963900000009"
S = {}


def totp(secret_b32, step=None):
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    step = step if step is not None else int(time.time() // 30)
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000).zfill(6)


def fresh_code(secret):
    """Wait for a time-step never used before (server rejects replays)."""
    step = int(time.time() // 30)
    if S.get("last_step", -1) >= step:
        time.sleep(30 - time.time() % 30 + 0.5)
        step = int(time.time() // 30)
    S["last_step"] = step
    return totp(secret, step)


def call(method, path, token=None, body=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    r = requests.request(method, SITE + path, headers=h, data=json.dumps(body) if body is not None else None, timeout=60)
    return r.status_code, (r.json() if r.content else None)


def seed():
    tok = secrets.token_hex(24)
    arg = json.dumps({"phone": PHONE, "token": tok})
    subprocess.run(f"export $(grep CONVEX_DEPLOY_KEY /app/backend/.env | xargs) && npx convex run devSec:testSeed '{arg}'", shell=True, cwd="/app/frontend", check=True, capture_output=True)
    return tok


DEV_A = secrets.token_hex(32)
DEV_B = secrets.token_hex(32)


def test_01_unverified_dev_blocked():
    S["tA"] = seed()
    c, me = call("GET", "/auth/me", S["tA"])
    assert c == 200 and me["role"] == "DEVELOPER" and me["dev_mfa"] is False
    assert "phone" not in me and "email" not in me
    for p in ["/dev/stats", "/dev/orgs", "/dev/sec/devices", "/dev/sec/logs"]:
        c, b = call("GET", p, S["tA"])
        assert c == 403, (p, c, b)


def test_02_owner_cannot_use_dev():
    for p in ["/dev/stats", "/dev/sec/status", "/dev/orgs"]:
        c, _ = call("GET", p, "test_token_owner")
        assert c == 403
    c, _ = call("GET", "/dev/stats", "test_token_dev")
    assert c == 401  # legacy fixed test developer removed


def test_03_password_set_and_login():
    c, b = call("POST", "/auth/password", S["tA"], {"password": "Sec12345test"})
    assert c == 200, b
    c, b = call("POST", "/auth/password/login", body={"phone": PHONE, "password": "wrong-pass1"})
    assert c == 400
    c, b = call("POST", "/auth/password/login", body={"phone": PHONE, "password": "Sec12345test"})
    assert c == 200 and b["user"]["dev_mfa"] is False and "phone" not in b["user"]
    S["tA"] = b["session_token"]


def test_04_setup_totp():
    c, st = call("GET", "/dev/sec/status", S["tA"])
    assert c == 200 and st["enrolled"] is False and st["verified"] is False
    c, b = call("POST", "/dev/sec/setup", S["tA"])
    assert c == 200 and b["uri"].startswith("otpauth://totp/SmartSystem:Admin") and PHONE not in b["uri"]
    S["secret"] = b["secret"]
    c, b = call("POST", "/dev/sec/setup/confirm", S["tA"], {"code": "000000" if totp(S["secret"]) != "000000" else "111111", "device_secret": DEV_A, "label": "A"})
    assert c == 400
    c, b = call("POST", "/dev/sec/setup/confirm", S["tA"], {"code": fresh_code(S["secret"]), "device_secret": DEV_A, "label": "A"})
    assert c == 200 and len(b["recovery_codes"]) == 10, b
    S["codes"] = b["recovery_codes"]
    c, me = call("GET", "/auth/me", S["tA"])
    assert me["dev_mfa"] is True
    c, _ = call("GET", "/dev/stats", S["tA"])
    assert c == 200


def test_05_second_setup_blocked_without_recent_mfa_other_session():
    c, b = call("POST", "/auth/password/login", body={"phone": PHONE, "password": "Sec12345test"})
    S["tB"] = b["session_token"]
    c, b = call("POST", "/dev/sec/setup", S["tB"])
    assert c == 403, b


def test_06_new_device_needs_approval():
    c, b = call("POST", "/dev/sec/verify", S["tB"], {"code": fresh_code(S["secret"]), "device_secret": DEV_B, "label": "B"})
    assert c == 200 and b["status"] == "pending" and len(b["code"]) == 6, b
    S["approve"] = b["code"]
    c, _ = call("GET", "/dev/stats", S["tB"])
    assert c == 403
    c, devs = call("GET", "/dev/sec/devices", S["tA"])
    pend = [d for d in devs if d["status"] == "pending"]
    assert len(pend) == 1
    S["pid"] = pend[0]["id"]
    wrong = "123456" if S["approve"] != "123456" else "654321"
    c, _ = call("POST", f"/dev/sec/devices/{S['pid']}/approve", S["tA"], {"code": wrong})
    assert c == 400
    c, b = call("POST", f"/dev/sec/devices/{S['pid']}/approve", S["tA"], {"code": S["approve"]})
    assert c == 200, b
    c, me = call("GET", "/auth/me", S["tB"])
    assert me["dev_mfa"] is True
    c, _ = call("GET", "/dev/stats", S["tB"])
    assert c == 200


def test_07_replay_rejected():
    c, b = call("POST", "/auth/password/login", body={"phone": PHONE, "password": "Sec12345test"})
    t = b["session_token"]
    code = totp(S["secret"], S["last_step"])  # already used step
    c, b = call("POST", "/dev/sec/verify", t, {"code": code, "device_secret": DEV_A, "label": "A"})
    assert c == 400, b
    S["tC"] = t


def test_08_revoke_device_kills_sessions():
    c, devs = call("GET", "/dev/sec/devices", S["tA"])
    b_dev = [d for d in devs if d["status"] == "trusted" and not d["current"]][0]
    c, _ = call("POST", f"/dev/sec/devices/{b_dev['id']}/revoke", S["tA"])
    assert c == 200
    c, _ = call("GET", "/dev/stats", S["tB"])
    assert c == 401
    # revoked device cannot come back with TOTP only
    c, b = call("POST", "/auth/password/login", body={"phone": PHONE, "password": "Sec12345test"})
    t = b["session_token"]
    c, b = call("POST", "/dev/sec/verify", t, {"code": fresh_code(S["secret"]), "device_secret": DEV_B, "label": "B"})
    assert c == 400 and "استرداد" in b["detail"], b
    # recovery code re-trusts it (single use)
    c, b = call("POST", "/dev/sec/verify", t, {"code": S["codes"][0], "device_secret": DEV_B, "label": "B"})
    assert c == 200 and b["status"] == "ok", b
    c, b = call("POST", "/auth/password/login", body={"phone": PHONE, "password": "Sec12345test"})
    c, b = call("POST", "/dev/sec/verify", b["session_token"], {"code": S["codes"][0], "device_secret": DEV_B, "label": "B"})
    assert c == 400
    S["tB"] = t


def test_09_lockout_after_5_fails():
    c, b = call("POST", "/auth/password/login", body={"phone": PHONE, "password": "Sec12345test"})
    t = b["session_token"]
    bad = "999999" if totp(S["secret"]) != "999999" else "888888"
    msgs = []
    for _ in range(5):
        msgs.append(call("POST", "/dev/sec/verify", t, {"code": bad, "device_secret": DEV_A, "label": "A"}))
        if "قفل" in (msgs[-1][1] or {}).get("detail", ""):
            break
    assert all(c == 400 for c, _ in msgs)
    assert "قفل" in msgs[-1][1]["detail"]
    c, _ = call("GET", "/dev/sec/status", t)
    assert c == 401  # session ended on lockout
    c, st = call("GET", "/dev/sec/status", S["tA"])
    assert st["locked_minutes"] > 0


def test_10_logs_and_revoke_all():
    c, logs = call("GET", "/dev/sec/logs", S["tA"])
    ev = {l["event"] for l in logs}
    assert {"2fa.enabled", "device.pending", "device.approved", "device.revoked", "recovery.used", "2fa.locked", "password.fail"} <= ev, ev
    c, b = call("POST", "/dev/sec/revoke-all", S["tA"], {"include_current": False})
    assert c == 200
    c, _ = call("GET", "/dev/stats", S["tB"])
    assert c == 401
    c, _ = call("GET", "/dev/stats", S["tA"])
    assert c == 200
    c, b = call("POST", "/dev/sec/revoke-all", S["tA"], {"include_current": True})
    assert c == 200
    c, _ = call("GET", "/dev/stats", S["tA"])
    assert c == 401


def test_11_support_number():
    c, b = call("GET", "/settings/payment", "test_token_owner")
    assert c == 200 and b["whatsapp"] == "+963947744162"
