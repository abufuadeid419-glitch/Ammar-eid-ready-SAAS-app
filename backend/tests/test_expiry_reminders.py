# Plan Expiry Reminders: /renew page + REST regression (read-only, no SMS, no writes)
import os
import subprocess
import json
import pytest
import requests

SITE = os.environ.get("CONVEX_SITE_URL", "https://fearless-ostrich-878.eu-west-1.convex.site").rstrip("/")
OWNER = {"Authorization": "Bearer test_token_owner"}


# Renew landing page linked from SMS
class TestRenewPage:
    def test_renew_200_html(self):
        r = requests.get(f"{SITE}/renew", timeout=20)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/html")
        assert "no-store" in r.headers.get("cache-control", "")

    def test_renew_content(self):
        t = requests.get(f"{SITE}/renew", timeout=20).text
        assert 'dir="rtl"' in t and 'lang="ar"' in t
        assert 'href="smartsystem://upgrade"' in t
        assert 'location.href="smartsystem://upgrade"' in t
        assert "تجديد" in t

    def test_renew_post_not_routed(self):
        r = requests.post(f"{SITE}/renew", timeout=20)
        assert r.status_code in (404, 405)


# Regression: existing REST API
class TestRegression:
    def test_auth_me(self):
        r = requests.get(f"{SITE}/api/auth/me", headers=OWNER, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("phone") == "+963900000002" or d.get("user", {}).get("phone") == "+963900000002"

    def test_plans(self):
        r = requests.get(f"{SITE}/api/plans", headers=OWNER, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))

    def test_auth_me_no_token(self):
        r = requests.get(f"{SITE}/api/auth/me", timeout=20)
        assert r.status_code == 401


def _convex_env():
    env = dict(os.environ)
    for line in open("/app/backend/.env"):
        if line.startswith("CONVEX_DEPLOY_KEY="):
            env["CONVEX_DEPLOY_KEY"] = line.split("=", 1)[1].strip().strip('"')
    if "CONVEX_DEPLOY_KEY" not in env:
        pytest.skip("no deploy key")
    return env


# Read-only reminder batch (internalQuery) via Convex CLI - never runs the action/mutation
class TestBatchQuery:
    def test_batch_query(self):
        p = subprocess.run(["npx", "convex", "run", "billing:expiryReminderBatch"],
                           cwd="/app/frontend", env=_convex_env(), capture_output=True, text=True, timeout=120)
        assert p.returncode == 0, p.stderr[-500:]
        out = json.loads(p.stdout.strip())
        assert isinstance(out, list)
        for item in out:
            assert set(item) >= {"org", "owner_id", "key", "title", "body", "phone", "text"}
            assert item["text"].endswith("/renew")

    def test_function_spec(self):
        p = subprocess.run(["npx", "convex", "function-spec"],
                           cwd="/app/frontend", env=_convex_env(), capture_output=True, text=True, timeout=120)
        assert p.returncode == 0, p.stderr[-500:]
        fns = {f["identifier"]: f for f in json.loads(p.stdout)["functions"] if "identifier" in f}
        assert fns["billing.js:expiryReminderBatch"]["functionType"] == "Query"
        assert fns["billing.js:expiryReminderBatch"]["visibility"]["kind"] == "internal"
        assert fns["billing.js:markExpiryReminded"]["functionType"] == "Mutation"
        assert fns["billing.js:markExpiryReminded"]["visibility"]["kind"] == "internal"
        assert fns["billing.js:sendExpiryReminders"]["functionType"] == "Action"
        assert fns["billing.js:sendExpiryReminders"]["visibility"]["kind"] == "internal"


# Local unit checks (stage logic, clamp, action loop with mocked sendSms)
def test_local_unit():
    p = subprocess.run(["node", "/app/backend/tests/expiry_stage_unit.js"], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stdout[-1500:]
