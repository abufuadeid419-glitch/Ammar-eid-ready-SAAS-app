# Employee name ownership (owner-only set/edit via invite + PATCH /employees/:id/name) + SaaS iteration-12 fix retests
# LIVE Convex deployment — only touches org_test_1. Tests run in file order and share state.
import pytest
from test_saas_billing_cycle import call, act, detail, DEV, OWNER, AGENT, NO_PERM

AGENT_UID = "user_test_agent"
S = {}


def employees():
    c, b = call("GET", "/employees", OWNER)
    assert c == 200, b
    return b


# --- invite requires a name ---
@pytest.mark.parametrize("name", ["", " ", "A"])
def test_invite_requires_name(name):
    c, b = call("POST", "/employees/invite", OWNER, json={"name": name, "employee_type": "FIELD_AGENT"})
    assert c >= 400 and "أدخل اسم الموظف" in detail(b), (c, b)


def test_invite_create_rename_delete():
    c, b = call("POST", "/employees/invite", OWNER, json={"name": "TEST_INV_NAME", "employee_type": "ACCOUNTANT"})
    if c != 200:
        c, b = call("POST", "/employees/invite", OWNER, json={"name": "TEST_INV_NAME", "employee_type": "FIELD_AGENT"})
    if c != 200 and ("الحد الأقصى" in detail(b) or "تسمح" in detail(b)):
        pytest.skip(f"employee limit blocks invite: {detail(b)}")
    assert c == 200, b
    assert b["code"].startswith("EMP-") and b["name"] == "TEST_INV_NAME", b
    iid = b["id"]
    S["inv"] = iid
    try:
        inv = next(i for i in employees()["invitations"] if i["id"] == iid)
        assert inv["name"] == "TEST_INV_NAME"
        c, r = call("PATCH", f"/employees/{iid}/name", OWNER, json={"name": "TEST_INV_RENAMED"})
        assert c == 200 and r.get("name") == "TEST_INV_RENAMED", (c, r)
        inv = next(i for i in employees()["invitations"] if i["id"] == iid)
        assert inv["name"] == "TEST_INV_RENAMED", inv
        # invalid rename on invite
        c, r = call("PATCH", f"/employees/{iid}/name", OWNER, json={"name": "x"})
        assert c >= 400, (c, r)
    finally:
        c, _ = call("DELETE", f"/employees/invite/{iid}", OWNER)
        assert c == 200
    assert not any(i["id"] == iid for i in employees()["invitations"])


def test_rename_unknown_id():
    c, b = call("PATCH", "/employees/does_not_exist_xyz/name", OWNER, json={"name": "TEST name"})
    assert c >= 400 and "الموظف غير موجود" in detail(b), (c, b)


# --- owner renames an existing employee ---
def test_owner_renames_agent_and_me_reflects():
    emp = next(e for e in employees()["employees"] if e["user_id"] == AGENT_UID)
    S["orig_agent_name"] = emp.get("name")
    print("original agent name:", S["orig_agent_name"])
    try:
        c, b = call("PATCH", f"/employees/{AGENT_UID}/name", OWNER, json={"name": "TEST وكيل"})
        assert c == 200 and b["name"] == "TEST وكيل", (c, b)
        c, me = call("GET", "/auth/me", AGENT)
        assert c == 200, me
        u = me.get("user", me)
        assert u["name"] == "TEST وكيل", u
        emp = next(e for e in employees()["employees"] if e["user_id"] == AGENT_UID)
        assert emp["name"] == "TEST وكيل"
    finally:
        if S["orig_agent_name"]:
            c, b = call("PATCH", f"/employees/{AGENT_UID}/name", OWNER, json={"name": S["orig_agent_name"]})
            assert c == 200, b
    c, me = call("GET", "/auth/me", AGENT)
    assert me.get("user", me)["name"] == S["orig_agent_name"]


# --- employee can't change own name ---
def test_agent_cannot_set_own_name():
    c, b = call("POST", "/auth/name", AGENT, json={"name": "X Y"})
    assert c >= 400 and "اسم الموظف يحدده المالك فقط" in detail(b), (c, b)
    c, me = call("GET", "/auth/me", AGENT)
    assert me.get("user", me)["name"] != "X Y"


def test_agent_cannot_rename_via_patch():
    c, b = call("PATCH", f"/employees/{AGENT_UID}/name", AGENT, json={"name": "X Y"})
    assert c >= 400 and NO_PERM in detail(b), (c, b)


# --- SaaS iteration-12 fixes ---
def test_frozen_owner_billing_access():
    act("freeze")
    try:
        c, s = call("GET", "/subscription", OWNER)
        assert c == 200 and s["status"] == "FROZEN", (c, s)
        c, plans = call("GET", "/plans", OWNER)
        assert c == 200, plans
        vip = next(p for p in plans if p["tier"] == "VIP" and p["name"] == "VIP")
        c, q = call("GET", f"/subscription/quote?plan_id={vip['id']}&billing=monthly", OWNER)
        assert c == 200 and "due" in q, (c, q)
        c, u = call("GET", "/upgrade-requests", OWNER)
        assert c == 200, (c, u)
    finally:
        act("unfreeze")
    c, s = call("GET", "/subscription", OWNER)
    assert s["status"] == "ACTIVE", s


@pytest.mark.parametrize("promo", [25, 30])
def test_promo_must_be_less_than_price(promo):
    c, b = call("POST", "/dev/plans", DEV, json={"name": "TEST_PROMO_BAD", "tier": "PRO", "price": 25, "promo_price": promo, "max_employees": 3})
    if c == 200:  # cleanup stray plan
        pid = b["id"] if isinstance(b, dict) else b
        call("POST", f"/dev/plans/{pid}/archive", DEV)
    assert c >= 400 and "سعر العرض يجب أن يكون أقل" in detail(b), (c, b)


def test_quote_vip_yearly_saving_120():
    c, plans = call("GET", "/plans", OWNER)
    vip = next(p for p in plans if p["tier"] == "VIP" and p["name"] == "VIP")
    c, q = call("GET", f"/subscription/quote?plan_id={vip['id']}&billing=monthly", OWNER)
    assert c == 200 and q["yearly_saving"] == 120, q


def test_zz_final_state():
    c, s = call("GET", "/subscription", OWNER)
    assert s["status"] == "ACTIVE", s
    if S.get("orig_agent_name"):
        c, me = call("GET", "/auth/me", AGENT)
        assert me.get("user", me)["name"] == S["orig_agent_name"]
