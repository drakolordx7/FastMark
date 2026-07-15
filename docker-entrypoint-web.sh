#!/bin/sh
set -e
npx tsx src/lib/db/migrate.ts
exec npm run start
