# Dev delete powers (devAdmin.ts) — SAFE tests against live Convex. Never hard-deletes org_test_1.
import os
import time
import pytest
import requests
from devauth_helper import verified_dev_token
DEV = verified_dev_token()

SITE = os.environ.get("EXPO_PUBLIC_CONVEX_SITE_URL")
if not SITE:
    for line in open("/app/frontend/.env"):
        if line.startswith("EXPO_PUBLIC_CONVEX_SITE_URL="):
            SITE = line.split("=", 1)[1].strip().strip('"')
API = SITE.rstrip("/") + "/api"
ORG = "org_test_1"


def call(method, path, token, **kw):
    r = requests.request(method, API + path, headers={"Authorization": f"Bearer {token}"}, timeout=30, **kw)
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text}
    return r.status_code, body


def err(body):
    return str(body.get("detail") or body.get("error") or body.get("message") or body)


# --- RBAC: non-dev callers rejected
@pytest.mark.parametrize("token", ["test_token_owner", "test_token_agent"])
@pytest.mark.parametrize("path,payload", [
    (f"/dev/orgs/{ORG}/delete", {"confirm": "WRONG"}),
    (f"/dev/orgs/{ORG}/soft-delete", {"restore": True}),
    (f"/dev/orgs/{ORG}/cancel-subscription", {}),
    ("/dev/plans/nonexistent_plan/delete", {}),
    ("/dev/users/nonexistent_user/delete", {}),
    ("/dev/upgrade-requests/nonexistent_req/delete", {}),
])
def test_non_dev_forbidden(token, path, payload):
    s, b = call("POST", path, token, json=payload)
    assert s >= 400, (s, b)
    assert "ليس لديك صلاحية" in err(b), b


# --- Hard delete wrong confirm (safe)
def test_hard_delete_wrong_confirm():
    s, b = call("POST", f"/dev/orgs/{ORG}/delete", DEV, json={"confirm": "WRONG"})
    assert s >= 400
    assert "اكتب اسم المؤسسة بالضبط" in err(b), b
    s, me = call("GET", "/auth/me", "test_token_owner")
    assert s == 200 and (me.get("org") or {}).get("id") == ORG


def test_hard_delete_unknown_org():
    s, b = call("POST", "/dev/orgs/org_does_not_exist_xyz/delete", DEV, json={"confirm": "x"})
    assert s >= 400 and "المؤسسة غير موجودة" in err(b), b


# --- Soft delete + MANDATORY restore
def test_soft_delete_and_restore():
    try:
        s, b = call("POST", f"/dev/orgs/{ORG}/soft-delete", DEV, json={})
        assert s == 200 and b.get("ok"), b
        s, me = call("GET", "/auth/me", "test_token_owner")
        print("me after soft delete:", s, (me.get("org") or {}).get("status"))
        assert (me.get("org") or {}).get("status") == "DELETED", me
        s, p = call("GET", "/products", "test_token_owner")
        print("owner /products after soft delete:", s, str(p)[:200])
        assert s >= 400 and "963947744162" in err(p), p
        s, ag = call("GET", "/products", "test_token_agent")
        print("agent /products after soft delete:", s, str(ag)[:200])
        assert s >= 400
    finally:
        s, b = call("POST", f"/dev/orgs/{ORG}/soft-delete", DEV, json={"restore": True})
        print("restore:", s, b)
    s, me = call("GET", "/auth/me", "test_token_owner")
    assert (me.get("org") or {}).get("status") == "ACTIVE", me
    s, p = call("GET", "/products", "test_token_owner")
    assert s == 200, p
    s, a = call("GET", f"/dev/audit?org_id={ORG}", DEV)
    txt = str(a)
    assert "org.delete_soft" in txt and "org.restore" in txt


# --- Plan create -> delete -> gone + audit
def test_plan_delete():
    s, b = call("POST", "/dev/plans", DEV, json={"tier": "PRO", "name": "TEST_DEL_PLAN", "price": 5})
    print("create plan:", s, str(b)[:300])
    assert s == 200, b
    pid = b.get("id") or (b.get("plan") or {}).get("id")
    assert pid, b
    s, plans = call("GET", "/plans", DEV)
    assert pid in str(plans)
    s, d = call("POST", f"/dev/plans/{pid}/delete", DEV, json={})
    assert s == 200 and d.get("ok"), d
    s, plans = call("GET", "/plans", DEV)
    assert pid not in str(plans)
    s, d2 = call("POST", f"/dev/plans/{pid}/delete", DEV, json={})
    assert s >= 400 and "الخطة غير موجودة" in err(d2)
    s, a = call("GET", "/dev/audit", DEV)
    assert "plan.delete" in str(a) and pid in str(a)


# --- User delete guards (no real deletions)
def test_user_delete_owner_guard():
    s, b = call("POST", "/dev/users/user_test_owner/delete", DEV, json={})
    assert s >= 400 and "هذا مالك مؤسسة" in err(b), b


def test_user_delete_self_guard():
    s, me = call("GET", "/auth/me", DEV)
    uid = me.get("user_id") or (me.get("user") or {}).get("user_id")
    assert uid, me
    s, b = call("POST", f"/dev/users/{uid}/delete", DEV, json={})
    assert s >= 400 and "لا يمكنك حذف حسابك الحالي" in err(b), b


def test_user_delete_unknown():
    s, b = call("POST", "/dev/users/user_nope_xyz_123/delete", DEV, json={})
    assert s >= 400 and "المستخدم غير موجود" in err(b), b


# --- Payment request delete (old CANCELLED/REJECTED of org_test_1)
def test_payment_request_delete():
    s, reqs = call("GET", "/upgrade-requests", DEV)
    assert s == 200, reqs
    items = reqs if isinstance(reqs, list) else (reqs.get("items") or reqs.get("requests") or [])
    cand = [r for r in items if r.get("org_id") == ORG and r.get("status") in ("CANCELLED", "REJECTED")]
    print("candidates:", len(cand), [(r.get("id"), r.get("status")) for r in cand[:5]])
    if not cand:
        pytest.skip("no CANCELLED/REJECTED request for org_test_1")
    rid = cand[-1]["id"]
    s, d = call("POST", f"/dev/upgrade-requests/{rid}/delete", DEV, json={})
    assert s == 200 and d.get("ok"), d
    s, reqs2 = call("GET", "/upgrade-requests", DEV)
    assert rid not in str(reqs2)
    s, a = call("GET", "/dev/audit", DEV)
    assert "payment.delete" in str(a) and rid in str(a)


def test_org_still_active_final():
    s, me = call("GET", "/auth/me", "test_token_owner")
    if (me.get("org") or {}).get("status") != "ACTIVE":
        call("POST", f"/dev/orgs/{ORG}/soft-delete", DEV, json={"restore": True})
        time.sleep(1)
        s, me = call("GET", "/auth/me", "test_token_owner")
    assert (me.get("org") or {}).get("status") == "ACTIVE"
