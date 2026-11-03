"""Fully verified (password + TOTP + trusted device) throw-away developer session for automated tests.
Requires `bash dev_sec_env.sh add` first (and `restore` afterwards)."""
import base64, hashlib, hmac, json, secrets, struct, subprocess, time
import requests

SITE = "https://fearless-ostrich-878.eu-west-1.convex.site/api"
_TOKEN = None


def _totp(secret_b32):
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    h = hmac.new(key, struct.pack(">Q", int(time.time() // 30)), hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000).zfill(6)


def verified_dev_token():
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    tok = secrets.token_hex(24)
    sh = "export $(grep CONVEX_DEPLOY_KEY /app/backend/.env | xargs) && npx convex run devSec:"
    subprocess.run(sh + "testPurge '{\"phone\":\"+963900000008\"}'", shell=True, cwd="/app/frontend", check=True, capture_output=True)
    subprocess.run(sh + f"testSeed '{json.dumps({'phone': '+963900000008', 'token': tok})}'", shell=True, cwd="/app/frontend", check=True, capture_output=True)
    H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    secret = requests.post(SITE + "/dev/sec/setup", headers=H, timeout=60).json()["secret"]
    r = requests.post(SITE + "/dev/sec/setup/confirm", headers=H, timeout=60,
                      data=json.dumps({"code": _totp(secret), "device_secret": secrets.token_hex(32), "label": "pytest"}))
    assert r.status_code == 200, r.text
    _TOKEN = tok
    return tok
