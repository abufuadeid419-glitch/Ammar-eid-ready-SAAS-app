# Soft-deleted (DELETED) org lockout: owner sees deleted msg + WhatsApp support, billing blocked, dev cannot re-activate via billing
# LIVE Convex deployment — only touches org_test_1. Tests run in file order and share state. Restores org_test_1 at the end.
import uuid, datetime as dt
import pytest
from test_saas_billing_cycle import call, png_b64, detail, PRO_ID, SHAM, DEV, OWNER, ORG

WA = "+963947744162"
DEV_MSG = "المؤسسة محذوفة"
S = {}


def org_status():
    c, b = call("GET", "/auth/me", OWNER)
    assert c == 200, b
    return (b.get("org") or {}).get("status"), b.get("org") or {}


@pytest.fixture(scope="module", autouse=True)
def lifecycle():
    # Precondition: org ACTIVE, no open payment request; create a PENDING request to test approval-while-deleted
    st, org = org_status()
    if st == "DELETED":
        call("POST", f"/dev/orgs/{ORG}/soft-delete", DEV, json={"restore": True})
    c, reqs = call("GET", "/upgrade-requests", OWNER)
    for r in (reqs if isinstance(reqs, list) else []):
        if r.get("status") in ("PENDING", "UNDER_REVIEW", "NEEDS_INFO"):
            call("POST", f"/upgrade-requests/{r['id']}/cancel", OWNER)
    S["before"] = org_status()[1]
    c, q = call("GET", f"/subscription/quote?plan_id={PRO_ID}&billing=monthly", OWNER)
    amount = q.get("due") if c == 200 and q.get("due") else 25
    body = {"plan_id": PRO_ID, "billing": "monthly", "method_id": SHAM, "amount": amount, "payment_ref": f"TESTREF-{uuid.uuid4().hex[:10]}",
            "transfer_date": dt.date.today().isoformat(), "idem_key": uuid.uuid4().hex[:20], "receipt": png_b64()}
    S["body"] = body
    c, b = call("POST", "/upgrade-requests", OWNER, json=body)
    S["pending"] = b.get("id") if c == 200 and isinstance(b, dict) else None
    print("pending request:", c, S["pending"] or detail(b))
    yield
    # Teardown: ALWAYS restore org_test_1 and drop the test request
    call("POST", f"/dev/orgs/{ORG}/soft-delete", DEV, json={"restore": True})
    if S.get("pending"):
        call("POST", f"/upgrade-requests/{S['pending']}/cancel", OWNER)
    print("final status:", org_status()[0])


# --- soft delete
def test_dev_soft_delete():
    c, b = call("POST", f"/dev/orgs/{ORG}/soft-delete", DEV, json={})
    assert c == 200 and b.get("ok") is True, b
    assert org_status()[0] == "DELETED"


# --- owner while deleted
def test_owner_me_shows_deleted():
    st, _ = org_status()
    assert st == "DELETED"


@pytest.mark.parametrize("path", ["/products", "/customers", "/sales", "/stats/overview"])
def test_owner_org_routes_blocked(path):
    c, b = call("GET", path, OWNER)
    print(path, c, detail(b))
    assert c >= 400 and WA in detail(b), (c, b)


@pytest.mark.parametrize("path", ["/subscription", f"/subscription/quote?plan_id={PRO_ID}&billing=monthly", "/plans", "/payment-methods", "/upgrade-requests"])
def test_owner_billing_reads_blocked(path):
    c, b = call("GET", path, OWNER)
    print(path, c, detail(b))
    assert c >= 400 and WA in detail(b), (c, b)


def test_owner_submit_payment_blocked():
    body = {**S["body"], "idem_key": uuid.uuid4().hex[:20], "payment_ref": f"TESTREF-{uuid.uuid4().hex[:10]}", "receipt": png_b64()}
    c, b = call("POST", "/upgrade-requests", OWNER, json=body)
    print("submit", c, detail(b))
    assert c >= 400 and WA in detail(b) and "الحساب موقوف" in detail(b), (c, b)


def test_owner_resubmit_receipt_blocked():
    if not S.get("pending"):
        pytest.skip("no pending request")
    c, b = call("POST", f"/upgrade-requests/{S['pending']}/receipt", OWNER, json={"receipt": png_b64(), "payment_ref": "TESTREF-X1"})
    print("resubmit", c, detail(b))
    assert c >= 400, (c, b)


# --- developer billing paths must not re-activate
def test_dev_assign_plan_blocked():
    c, b = call("POST", f"/dev/orgs/{ORG}/assign-plan", DEV, json={"plan_id": PRO_ID, "days": 30, "note": "TEST"})
    print("assign", c, detail(b))
    assert c >= 400 and DEV_MSG in detail(b), (c, b)
    assert org_status()[0] == "DELETED"


def test_dev_patch_status_active_blocked():
    c, b = call("PATCH", f"/dev/orgs/{ORG}", DEV, json={"status": "ACTIVE"})
    print("patch", c, detail(b))
    assert c >= 400 and DEV_MSG in detail(b), (c, b)
    assert org_status()[0] == "DELETED"


@pytest.mark.parametrize("action", ["reactivate", "unfreeze", "extend", "suspend", "freeze"])
def test_dev_sub_actions_blocked(action):
    c, b = call("POST", f"/dev/subscriptions/{ORG}/action", DEV, json={"action": action, "days": 5})
    print(action, c, detail(b))
    assert c >= 400 and DEV_MSG in detail(b), (c, b)
    assert org_status()[0] == "DELETED"


def test_dev_approve_pending_blocked():
    if not S.get("pending"):
        pytest.skip("no pending request created")
    c, b = call("PATCH", f"/dev/upgrade-requests/{S['pending']}", DEV, json={"action": "approve"})
    print("approve", c, detail(b))
    assert c >= 400 and DEV_MSG in detail(b), (c, b)
    assert org_status()[0] == "DELETED"
    c, d = call("GET", f"/dev/orgs/{ORG}", DEV)
    reqs = (d.get("requests") or []) if isinstance(d, dict) else []
    r = next((x for x in reqs if x.get("id") == S["pending"]), None)
    print("request status after failed approve:", r and r.get("status"))
    if r:
        assert r.get("status") != "APPROVED"
