#!/bin/bash
# Usage: dev_sec_env.sh add|restore — temporarily allow the reserved test phones as developers.
set -e
cd /app/frontend
export $(grep CONVEX_DEPLOY_KEY /app/backend/.env | xargs)
PHONES="+963900000009 +963900000008"
if [ "$1" = "add" ]; then
  [ -f /tmp/dev_hash_orig ] || echo -n "$(npx convex env get DEVELOPER_PHONES_HASH)" > /tmp/dev_hash_orig
  PEPPER=$(npx convex env get OTP_PEPPER)
  V=$(cat /tmp/dev_hash_orig)
  for P in $PHONES; do V="$V,$(echo -n "$PEPPER:$P" | sha256sum | cut -d' ' -f1)"; done
  npx convex env set DEVELOPER_PHONES_HASH "$V" >/dev/null
  echo added
else
  npx convex env set DEVELOPER_PHONES_HASH "$(cat /tmp/dev_hash_orig)" >/dev/null
  rm -f /tmp/dev_hash_orig
  for P in $PHONES; do npx convex run devSec:testPurge "{\"phone\":\"$P\"}" >/dev/null; done
  echo restored
fi
