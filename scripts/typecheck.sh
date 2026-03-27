#!/usr/bin/env bash
set -euo pipefail

npx next typegen

mkdir -p .next/types
cp -f node_modules/next/dist/server/use-cache/cache-life.d.ts .next/types/cache-life.d.ts
test -f .next/types/cache-life.d.ts

npx tsc --noEmit --incremental false
