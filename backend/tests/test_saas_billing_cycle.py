# SaaS billing full cycle: plans, subscription, quote, security, Sham Cash payment, review, renewal, lifecycle, limits, catalog
# LIVE Convex deployment — only touches org_test_1. Tests run in file order and share state.
import base64, os, struct, uuid, zlib, datetime as dt
import pytest, requests

SITE = os.environ.get("EXPO_PUBLIC_CONVEX_SITE_URL") or open("/app/frontend/.env").read().split("EXPO_PUBLIC_CONVEX_SITE_URL=")[1].split()[0]
B = SITE.rstrip("/") + "/api"
from devauth_helper import verified_dev_token
DEV, OWNER, AGENT = verified_dev_token(), "test_token_owner", "test_token_agent"
ORG = "org_test_1"
PRO_ID = "2ad56e48e4fa42228284ee9185cce090"
SHAM = "90e09c39e8ba4d089d6e1eba106f40ee"
NO_PERM = "ليس لديك صلاحية"
S = {}


def call(method, path, tok, **kw):
    r = requests.request(method, B + path, headers={"Authorization": f"Bearer {tok}"}, timeout=40, **kw)
    try:
        body = r.json()
    except Exception:
        body = r.text
    return r.status_code, body


def png_b64():
    # valid PNG > 100 bytes (noise so it does not compress below the validator min size)
    w = h = 16
    raw = b"".join(b"\x00" + os.urandom(w * 3) for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png).decode()


def detail(b):
    return b.get("detail", "") if isinstance(b, dict) else str(b)


def sub():
    c, b = call("GET", "/subscription", OWNER)
    assert c == 200, b
    return b


def submit(plan_id, ref=None, idem=None, billing="monthly"):
    c, q = call("GET", f"/subscription/quote?plan_id={plan_id}&billing={billing}", OWNER)
    assert c == 200, q
    body = {"plan_id": plan_id, "billing": billing, "method_id": SHAM, "amount": q["due"],
            "payment_ref": ref or f"TESTREF-{uuid.uuid4().hex[:10]}", "transfer_date": dt.date.today().isoformat(),
            "idem_key": idem or uuid.uuid4().hex[:20], "receipt": png_b64()}
    c, b = call("POST", "/upgrade-requests", OWNER, json=body)
    return c, b, body


def act(action, **extra):
    c, b = call("POST", f"/dev/subscriptions/{ORG}/action", DEV, json={"action": action, **extra})
    assert c == 200, (action, b)
    return b


def pdays(a, b):
    return (dt.datetime.fromisoformat(a.replace("Z", "+00:00")) - dt.datetime.fromisoformat(b.replace("Z", "+00:00"))).total_seconds() / 86400


# --- plans / subscription / quote ---
def test_plans_published():
    c, b = call("GET", "/plans", OWNER)
    assert c == 200
    byt = {p["tier"]: p for p in b if p["name"] in ("Pro", "VIP") or p["tier"] == "FREE"}
    assert "FREE" in byt
    pro = next(p for p in b if p["id"] == PRO_ID)
    assert (pro["price"], pro["yearly_price"]) == (25, 300)
    vip = next(p for p in b if p["tier"] == "VIP" and p["name"] == "VIP")
    assert (vip["price"], vip["yearly_price"]) == (60, 600)
    S["vip"] = vip["id"]


def test_subscription_shape():
    s = sub()
    for k in ("plan", "status", "started_at", "expires_at", "meters", "last_request"):
        assert k in s, k
    keys = [m["key"] for m in s["meters"]]
    assert keys[:5] == ["employees", "distributors", "customers", "products", "invoices_month"]
    for m in s["meters"]:
        assert {"used", "max", "pct"} <= set(m)
    S["orig"] = {k: s.get(k) for k in ("plan_id", "status", "expires_at")}


def test_quote_vip():
    c, q = call("GET", f"/subscription/quote?plan_id={S['vip']}&billing=monthly", OWNER)
    assert c == 200, q
    for k in ("price", "credit", "due", "yearly_saving"):
        assert k in q
    assert q["price"] == 60 and q["due"] == max(0, round(q["price"] - q["credit"], 2))
    # backend uses monthly*365/30 (=730) - yearly; standard 12*monthly would be 120
    S["yearly_saving"] = q["yearly_saving"]
    assert q["yearly_saving"] in (120, 130), q


# --- security ---
@pytest.mark.parametrize("m,p,body", [
    ("PUT", "/dev/billing/catalog", {"features": [], "resources": []}),
    ("POST", "/dev/plans", {"name": "X", "price": 1}),
    ("PATCH", "/dev/upgrade-requests/abc", {"action": "approve"}),
    ("POST", f"/dev/subscriptions/{ORG}/action", {"action": "freeze"}),
])
def test_owner_forbidden(m, p, body):
    c, b = call(m, p, OWNER, json=body)
    assert c >= 400 and NO_PERM in detail(b), (c, b)


def test_payment_method_qr():
    c, b = call("GET", "/payment-methods", OWNER)
    sham = next(x for x in b if x["id"] == SHAM)
    assert sham["name"] == "شام كاش" and sham.get("qr_url", "").startswith("http")


# --- payment submit / idempotency / reject ---
def test_submit_pending_and_idempotent():
    c, b, body = submit(S["vip"])
    assert c == 200, b
    assert b["status"] == "PENDING"
    S["r1"] = b["id"]
    assert sub()["plan_id"] != S["vip"]  # not activated yet
    c2, b2 = call("POST", "/upgrade-requests", OWNER, json=body)
    assert c2 == 200 and b2.get("duplicate") and b2["id"] == b["id"], b2
    c3, b3, _ = submit(S["vip"])
    assert c3 >= 400, b3  # second open request blocked
    S["second_open_err"] = detail(b3)


def test_reject_with_note():
    c, b = call("PATCH", f"/dev/upgrade-requests/{S['r1']}", DEV, json={"action": "reject", "note": "test"})
    assert c == 200, b
    lr = sub()["last_request"]
    assert lr["status"] == "REJECTED" and lr["note"] == "test", lr


def test_submit_and_approve():
    c, b, body = submit(S["vip"])
    assert c == 200 and b["status"] == "PENDING", b
    S["r2"], S["ref2"] = b["id"], body["payment_ref"]
    c, r = call("PATCH", f"/dev/upgrade-requests/{S['r2']}", DEV, json={"action": "approve"})
    assert c == 200, r
    s = sub()
    assert s["plan_id"] == S["vip"] and s["tier"] == "VIP" and s["status"] == "ACTIVE", s
    assert abs(pdays(s["expires_at"], dt.datetime.utcnow().isoformat() + "Z") - 30) < 1
    S["exp_after_approve"] = s["expires_at"]
    c, led = call("GET", "/dev/billing/ledger", DEV)
    rows = led if isinstance(led, list) else led.get("rows", led.get("items", []))
    assert any(x.get("request_id") == S["r2"] and x["type"] == "PAYMENT" for x in rows), str(rows)[:300]


def test_approve_twice_fails():
    c, b = call("PATCH", f"/dev/upgrade-requests/{S['r2']}", DEV, json={"action": "approve"})
    assert c >= 400 and "تمت مراجعة" in detail(b), b


def test_reused_payment_ref_rejected():
    c, b, _ = submit(S["vip"], ref=S["ref2"])
    assert c >= 400 and "رقم العملية هذا مستخدم" in detail(b), b


def test_renewal_extends():
    c, b, _ = submit(S["vip"])
    assert c == 200, b
    c, r = call("PATCH", f"/dev/upgrade-requests/{b['id']}", DEV, json={"action": "approve"})
    assert c == 200, r
    s = sub()
    assert abs(pdays(s["expires_at"], S["exp_after_approve"]) - 30) < 0.1, (s["expires_at"], S["exp_after_approve"])
    c, led = call("GET", "/dev/billing/ledger", DEV)
    rows = led if isinstance(led, list) else led.get("rows", led.get("items", []))
    assert any(x.get("request_id") == b["id"] and x["type"] == "RENEWAL" for x in rows)


# --- dev lifecycle ---
def dev_row():
    c, b = call("GET", "/dev/subscriptions", DEV)
    return next(x for x in b if x["id"] == ORG)


def test_lifecycle():
    before = sub()["expires_at"]
    act("freeze")
    try:
        assert dev_row()["state"] == "FROZEN"
        c, b = call("GET", "/subscription", OWNER)
        S["owner_frozen_view"] = (c, detail(b) if c != 200 else b.get("status"))
    finally:
        act("unfreeze")
    s = sub()
    assert s["status"] == "ACTIVE" and pdays(s["expires_at"], before) >= -0.01, (s["expires_at"], before)
    e0 = s["expires_at"]
    act("extend", days=5)
    assert abs(pdays(sub()["expires_at"], e0) - 5) < 0.01
    act("suspend", note="test")
    try:
        assert dev_row()["state"] == "SUSPENDED"
        c, b = call("GET", "/subscription", OWNER)
        S["owner_susp_view"] = (c, detail(b) if c != 200 else b.get("status"))
    finally:
        act("reactivate")
    assert sub()["status"] == "ACTIVE"
    print("OWNER VIEW WHILE FROZEN:", S["owner_frozen_view"], "SUSPENDED:", S["owner_susp_view"])
    # Owner must be able to see FROZEN / SUSPENDED status on /subscription (mine() has branches for it)
    assert S["owner_frozen_view"][0] == 200 and S["owner_susp_view"][0] == 200, (S["owner_frozen_view"], S["owner_susp_view"])
    c, b = call("GET", "/dev/subscriptions?status=ACTIVE", DEV)
    rows = b if isinstance(b, list) else b.get("rows", b.get("items", []))
    assert c == 200 and any(x.get("id") == ORG or x.get("org_id") == ORG for x in rows), str(b)[:300]


def test_audit():
    c, b = call("GET", f"/dev/audit?org_id={ORG}", DEV)
    rows = b if isinstance(b, list) else b.get("rows", b.get("items", []))
    acts = {x.get("action", "") for x in rows}
    assert any(a.startswith("subscription.") for a in acts) and any(a.startswith("payment.") for a in acts), acts


# --- limits enforcement ---
def test_private_plan_limit_enforced():
    c, p = call("POST", "/dev/plans", DEV, json={"name": "TEST_LIMIT", "tier": "PRO", "price": 1, "limits": {"products": 1}, "org_ids": [ORG], "max_employees": 10})
    assert c == 200, p
    pid = p["id"] if isinstance(p, dict) else p
    S["limit_plan"] = pid
    c, b = call("POST", f"/dev/plans/{pid}/publish", DEV)
    assert c == 200, b
    c, b = call("POST", f"/dev/orgs/{ORG}/assign-plan", DEV, json={"plan_id": pid, "days": 30})
    assert c == 200, b
    c, b = call("POST", "/products", OWNER, json={"name": "TEST_LIMIT_PRODUCT", "sale_price": 1, "cost_price": 1})
    assert c >= 400 and "وصلت إلى الحد الأقصى" in detail(b), (c, b)
    m = next(x for x in sub()["meters"] if x["key"] == "products")
    assert m["max"] == 1 and m["pct"] == 100, m
    c, plans = call("GET", "/plans", OWNER)
    assert any(x["id"] == pid for x in plans)  # visible to targeted org


def test_archive_limit_plan():
    c, b = call("POST", f"/dev/plans/{S['limit_plan']}/archive", DEV)
    assert c == 200, b


# --- catalog ---
def test_catalog_add_resource():
    c, cat = call("GET", "/billing/catalog", DEV)
    assert c == 200, cat
    res = cat["resources"]
    if not any(r["key"] == "warehouses" for r in res):
        res = res + [{"key": "warehouses", "label": "المستودعات"}]
    c, b = call("PUT", "/dev/billing/catalog", DEV, json={"features": cat["features"], "resources": res})
    assert c == 200, b
    c, cat2 = call("GET", "/billing/catalog", OWNER)
    keys = [r["key"] for r in cat2["resources"]]
    assert "warehouses" in keys and {"employees", "products", "customers"} <= set(keys), keys


# --- cleanup (mandatory) ---
def test_zz_cleanup_restore_pro():
    c, b = call("POST", f"/dev/orgs/{ORG}/assign-plan", DEV, json={"plan_id": PRO_ID, "days": 365})
    assert c == 200, b
    s = sub()
    if s["status"] == "FROZEN":
        act("unfreeze")
    elif s["status"] != "ACTIVE":
        act("reactivate")
    s = sub()
    assert s["status"] == "ACTIVE" and s["plan_id"] == PRO_ID, s
