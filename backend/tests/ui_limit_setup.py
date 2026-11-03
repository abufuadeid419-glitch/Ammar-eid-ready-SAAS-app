# Helper: put org_test_1 on TEST_LIMIT plan (products limit 1) for UI alert test, or restore Pro. usage: python ui_limit_setup.py on|off
import sys
from test_saas_billing_cycle import call, act, DEV, ORG, PRO_ID

c, plans = call("GET", "/plans", DEV)
lp = next((p for p in plans if p["name"] == "TEST_LIMIT"), None)
print("TEST_LIMIT:", lp and (lp["id"], lp.get("status"), lp.get("active")))
if sys.argv[1] == "on":
    print(call("POST", f"/dev/plans/{lp['id']}/archive", DEV, json={"restore": True})[0])
    print(call("POST", f"/dev/plans/{lp['id']}/publish", DEV)[0])
    print(call("POST", f"/dev/orgs/{ORG}/assign-plan", DEV, json={"plan_id": lp["id"], "days": 30}))
else:
    print(call("POST", f"/dev/orgs/{ORG}/assign-plan", DEV, json={"plan_id": PRO_ID, "days": 365})[0])
    print(call("POST", f"/dev/plans/{lp['id']}/archive", DEV)[0])
c, s = call("GET", "/subscription", "test_token_owner")
print(s["plan_name"], s["status"], s["expires_at"], [(m["key"], m["pct"]) for m in s["meters"]])
