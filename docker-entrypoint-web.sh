#!/bin/sh
set -e

echo "FastMark web: waiting for database…"
i=0
until npx tsx src/lib/db/migrate.ts; do
  i=$((i + 1))
  if [ "$i" -ge 40 ]; then
    echo "FastMark web: migration failed after retries. Check DATABASE_URL / Postgres password."
    exit 1
  fi
  echo "FastMark web: DB not ready (attempt $i), retrying in 3s…"
  sleep 3
done

echo "FastMark web: starting Next.js…"
exec npm run start -- -H 0.0.0.0 -p 3000
