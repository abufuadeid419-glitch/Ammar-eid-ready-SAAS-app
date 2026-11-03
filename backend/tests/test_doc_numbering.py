# Document numbering: reserved blocks per device + validation/idempotency of client-stamped doc_no (Convex HTTP API)
import os
import uuid

import pytest
import requests

SITE = os.environ.get("EXPO_PUBLIC_CONVEX_SITE_URL") or "https://fearless-ostrich-878.eu-west-1.convex.site"
BASE = SITE.rstrip("/") + "/api"
AGENT = {"Authorization": "Bearer test_token_agent", "Content-Type": "application/json"}
OWNER = {"Authorization": "Bearer test_token_owner", "Content-Type": "application/json"}
KINDS = ["sale", "col", "ret", "pay", "wret"]
DEV_A = "testdevice_abc12345"
DEV_B = "otherdevice_xyz98765"
CUSTOMER = "TEST_ef6d264373ec"
PRODUCT = "504c618ff474444793b7f4ac7ba26bc1"  # TEST_PROD_06c08830


def reserve(dev, kinds=KINDS):
    return requests.post(f"{BASE}/numbers/reserve", headers=AGENT, json={"device_id": dev, "kinds": kinds}, timeout=30)


def err(r):
    try:
        j = r.json()
        return str(j.get("detail", j))
    except Exception:
        return r.text


def free_number(blocks, kind="sale"):
    for b in sorted([b for b in blocks if b["kind"] == kind], key=lambda b: b["start"]):
        for n in range(b["start"], b["end"] + 1):
            if n not in b["used"]:
                return n
    return None


# ---- reserve ----
class TestReserve:
    def test_reserve_shape_and_kinds(self):
        r = reserve(DEV_A)
        assert r.status_code == 200, err(r)
        blocks = r.json()
        assert {b["kind"] for b in blocks} == set(KINDS)
        prefixes = {"sale": "INV", "col": "RCV", "ret": "RET", "pay": "PAY", "wret": "WRT"}
        for b in blocks:
            assert set(["id", "kind", "prefix", "start", "end", "used"]) <= set(b)
            assert b["prefix"] == prefixes[b["kind"]]
            assert b["end"] >= b["start"] and isinstance(b["used"], list)

    def test_reserve_idempotent_same_device(self):
        a = reserve(DEV_A).json()
        b = reserve(DEV_A).json()
        key = lambda xs: sorted((x["id"], x["start"], x["end"]) for x in xs)
        assert key(a) == key(b)

    def test_other_device_disjoint(self):
        a = reserve(DEV_A).json()
        b = reserve(DEV_B).json()
        for k in KINDS:
            ra = [(x["start"], x["end"]) for x in a if x["kind"] == k]
            rb = [(x["start"], x["end"]) for x in b if x["kind"] == k]
            for s1, e1 in ra:
                for s2, e2 in rb:
                    assert e1 < s2 or e2 < s1, f"overlap {k}: {s1}-{e1} vs {s2}-{e2}"

    # NEW rules: block sizes sale 40, col 40, ret 10, pay 10, wret 5 (fresh device gets exactly one block per kind)
    def test_fresh_device_block_sizes(self):
        dev = f"testfresh_{uuid.uuid4().hex[:12]}"
        a = reserve(dev).json()
        sizes = {"sale": 40, "col": 40, "ret": 10, "pay": 10, "wret": 5}
        assert sorted(x["kind"] for x in a) == sorted(KINDS)
        for b in a:
            assert b["end"] - b["start"] + 1 == sizes[b["kind"]], b
            assert b["used"] == []
        # repeat -> no new allocation
        b2 = reserve(dev).json()
        assert sorted(x["id"] for x in a) == sorted(x["id"] for x in b2)

    # NEW rule: top-up only when outstanding < half block -> device with used numbers still gets SAME blocks
    def test_partially_used_device_no_new_block(self):
        a = reserve(DEV_A).json()
        b = reserve(DEV_A).json()
        assert sorted(x["id"] for x in a) == sorted(x["id"] for x in b)
        sizes = {"sale": 40, "col": 40, "ret": 10, "pay": 10, "wret": 5}
        for k in KINDS:
            out = sum(x["end"] - x["start"] + 1 - len(x["used"]) for x in b if x["kind"] == k)
            assert out >= sizes[k] / 2, (k, out)

    def test_short_device_id_rejected(self):
        r = reserve("short")
        assert r.status_code >= 400
        assert "معرّف الجهاز" in err(r)

    def test_unknown_kind_ignored(self):
        r = reserve(DEV_A, ["bogus"])
        assert r.status_code == 200 and r.json() == []

    def test_no_auth(self):
        r = requests.post(f"{BASE}/numbers/reserve", json={"device_id": DEV_A, "kinds": KINDS}, timeout=30)
        assert r.status_code in (401, 403)

    def test_owner_blocks_list(self):
        r = requests.get(f"{BASE}/numbers/blocks", headers=OWNER, timeout=30)
        assert r.status_code == 200, err(r)
        rows = r.json()
        assert any(x["device_id"] == DEV_A for x in rows)
        assert all("unused" in x and "user_id" in x for x in rows)

    def test_agent_cannot_list_blocks(self):
        r = requests.get(f"{BASE}/numbers/blocks", headers=AGENT, timeout=30)
        assert r.status_code in (401, 403)


# ---- sale doc_no validation (errors roll back -> no data written) ----
def sale_body(doc_no, sid=None):
    return {"id": sid or f"TEST_{uuid.uuid4().hex}", "doc_no": doc_no, "customer_id": CUSTOMER,
            "items": [{"product_id": PRODUCT, "quantity": 1, "unit": "PIECE"}], "paid_amount": 0, "notes": "TEST_numbering"}


class TestSaleDocNo:
    def test_out_of_range(self):
        r = requests.post(f"{BASE}/sales", headers=AGENT, json=sale_body("INV-99999999"), timeout=30)
        assert r.status_code >= 400 and "خارج النطاق" in err(r), err(r)

    def test_bad_format(self):
        for bad in ["INV-12", "RCV-00010", "abc"]:
            r = requests.post(f"{BASE}/sales", headers=AGENT, json=sale_body(bad), timeout=30)
            assert r.status_code >= 400 and "غير صالح" in err(r), (bad, err(r))

    @pytest.mark.skipif(os.environ.get("RUN_SALE_CREATE") != "1", reason="creates a live sale; limited to 1 per run")
    def test_valid_then_idempotent_then_reuse(self):
        blocks = reserve(DEV_A).json()
        n = free_number(blocks)
        assert n
        no = f"INV-{n:05d}"
        sid = f"TEST_{uuid.uuid4().hex}"
        r1 = requests.post(f"{BASE}/sales", headers=AGENT, json=sale_body(no, sid), timeout=30)
        assert r1.status_code == 200, err(r1)
        assert r1.json()["invoice_no"] == no
        # resend same id -> same doc
        r2 = requests.post(f"{BASE}/sales", headers=AGENT, json=sale_body(no, sid), timeout=30)
        assert r2.status_code == 200, err(r2)
        assert r2.json()["id"] == sid and r2.json()["invoice_no"] == no
        # number marked used exactly once
        used = [b for b in reserve(DEV_A).json() if b["kind"] == "sale" and b["start"] <= n <= b["end"]]
        if used:
            assert used[0]["used"].count(n) == 1
        # reuse with another id -> rejected
        r3 = requests.post(f"{BASE}/sales", headers=AGENT, json=sale_body(no), timeout=30)
        assert r3.status_code >= 400 and "مستخدم مسبقاً" in err(r3), err(r3)
        # only one sale with that number
        sales = requests.get(f"{BASE}/sales", headers=AGENT, timeout=30).json()
        assert sum(1 for s in sales if s["invoice_no"] == no) == 1
