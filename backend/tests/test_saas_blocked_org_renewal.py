# Blocked (FROZEN) org: owner must still be able to view subscription/quote and submit a renewal payment
import uuid, datetime as dt
from test_saas_billing_cycle import call, act, png_b64, detail, PRO_ID, SHAM, OWNER


def test_frozen_owner_can_renew():
    act("freeze")
    try:
        res = {}
        res["subscription"] = call("GET", "/subscription", OWNER)
        res["quote"] = call("GET", f"/subscription/quote?plan_id={PRO_ID}&billing=monthly", OWNER)
        res["plans"] = call("GET", "/plans", OWNER)
        res["methods"] = call("GET", "/payment-methods", OWNER)
        body = {"plan_id": PRO_ID, "billing": "monthly", "method_id": SHAM, "amount": 25, "payment_ref": f"TESTREF-{uuid.uuid4().hex[:8]}",
                "transfer_date": dt.date.today().isoformat(), "idem_key": uuid.uuid4().hex[:16], "receipt": png_b64()}
        res["submit"] = call("POST", "/upgrade-requests", OWNER, json=body)
        for k, (c, b) in res.items():
            print("FROZEN", k, c, detail(b) if c != 200 else "ok")
        if res["submit"][0] == 200:
            call("POST", f"/upgrade-requests/{res['submit'][1]['id']}/cancel", OWNER)
    finally:
        act("unfreeze")
    assert all(res[k][0] == 200 for k in ("subscription", "quote", "submit")), {k: v[0] for k, v in res.items()}
