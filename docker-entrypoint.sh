#!/bin/sh
set -e

# Litestream backups (P5) are opt-in. When LITESTREAM_BUCKET is set, restore the DB
# from the replica if one exists (fresh container / volume), then run the app under
# continuous replication. Otherwise run the app directly — so the deploy works fine
# before backups are configured.
if [ -n "${LITESTREAM_BUCKET}" ]; then
  echo "[entrypoint] Litestream enabled (bucket=${LITESTREAM_BUCKET}); restoring if a replica exists."
  litestream restore -if-replica-exists "${DB_PATH}" || true
  echo "[entrypoint] Starting app under Litestream replication."
  exec litestream replicate -exec "node server.js"
fi

echo "[entrypoint] LITESTREAM_BUCKET not set; running without backups."
exec node server.js
