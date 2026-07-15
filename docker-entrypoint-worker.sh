#!/bin/sh
set -e

echo "FastMark worker: starting…"
exec npx tsx src/worker/index.ts
