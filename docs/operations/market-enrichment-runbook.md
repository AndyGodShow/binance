# Market Enrichment Production Runbook

## Purpose

`/api/market` intentionally separates availability from research-grade data quality:

- The service preserves the complete Binance USDT perpetual universe even when enrichment is unavailable.
- A lightweight response is usable for basic market display but is not production-ready for research and strategy scanning.
- Production enrichment requires a distributed Redis REST lease so multiple serverless instances do not start the same expensive full-market build.

Do not make readiness green by trimming symbols, permanently removing fields, or bypassing the distributed lease.

## Health contract

Check `GET /api/health/market` without authentication. The response contains no Redis URL or token.

| HTTP | Status | Meaning | Operator action |
|---|---|---|---|
| 200 | `ready`, `enriched`, `ready` | Full enriched snapshot is available | No action |
| 200 | `degraded`, `lightweight`, `building` | Full build is within its five-minute budget | Observe until ready |
| 503 | `not-ready`, `lightweight`, `blocked` | Production Redis lease is not configured | Fix Redis configuration; do not scale traffic |
| 503 | `not-ready`, `lightweight`, `stuck` | Enrichment exceeded its build budget | Inspect upstream failures and lease/cache state |
| 503 | `not-ready`, `unavailable` | No renderable market data | Treat as an availability incident |

`serving: true` means the endpoint can still return the complete lightweight universe. It does not override `ready: false`.

## Required runtime configuration

Configure one supported Redis REST pair in the deployment secret manager:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

Never place real values in `.env.example`, repository documentation, logs, CI output, or command history shared in reports.

## Pre-deployment verification

Run the normal quality gates first:

```bash
npm test
npm run lint -- --max-warnings=0
npm run typecheck
npm run build
```

Start the built application with production settings and Redis secrets injected only into the process environment. Then run:

```bash
BASE_URL=http://127.0.0.1:3000 npm run verify:market-enrichment
```

The verifier must prove all of the following:

- At least 500 market symbols are present; the observed count should normally be close to the current Binance universe.
- The lightweight and enriched symbol sets are identical.
- Every row retains `symbol`, `lastPrice`, `quoteVolume`, `markPrice`, and `fundingRate`.
- Configured enhanced fields meet the minimum coverage threshold.
- Health `symbolCount` equals the enriched response count.
- A second market request succeeds and records cache-hit latency.

Thresholds can be tightened without editing code:

```bash
MARKET_MIN_SYMBOLS=600 \
MARKET_MIN_ENHANCED_COVERAGE=0.8 \
MARKET_READY_TIMEOUT_MS=360000 \
BASE_URL=http://127.0.0.1:3000 \
npm run verify:market-enrichment
```

Do not lower thresholds merely to make a failing deployment pass. First establish whether Binance changed its active universe or an upstream enrichment source is degraded.

## Production readiness gate

For a deployed preview or production URL:

```bash
API_SMOKE_ENDPOINTS=market-health \
API_SMOKE_REQUIRE_MARKET_READY=1 \
BASE_URL=https://deployment.example.com \
npm run verify:api
```

The strict gate must fail on HTTP 503, lightweight data, a blocked build, or a stuck build. Scheduled CI without Redis intentionally performs only the health-contract check and must not be cited as production readiness evidence.

## Alert recommendations

Configure the external monitor to alert when any condition persists:

- `ready=false` for 10 minutes.
- `dataQuality=lightweight` for longer than the five-minute build budget.
- `reason=redis-not-configured` on any production instance.
- `reason=enrichment-stuck` on two consecutive checks.
- `symbolCount` falls more than 10% below the previous healthy baseline.
- `/api/market` returns 5xx or an empty/non-array payload.

Use a low-frequency readiness probe. Do not poll `/api/market` aggressively as a health check because it can schedule enrichment work.

## Incident triage

1. Read `/api/health/market` and record only non-sensitive fields.
2. Confirm whether `/api/market` still returns the full lightweight universe.
3. If `redis-not-configured`, verify both URL and token exist in the deployment secret manager and belong to the same Redis database.
4. If `enrichment-stuck`, inspect logs for lease acquisition, lease release, Binance timeout, and partial kline enrichment messages.
5. Run the strict readiness smoke once; avoid repeated manual requests while the build is still inside its budget.
6. After remediation, run `verify:market-enrichment` and preserve its timing/coverage summary as incident evidence.

## Degradation and rollback

The safe degradation mode is the existing fail-closed behavior: continue serving every symbol with lightweight fields while reporting not-ready. Do not introduce an unleased full build during an incident; that can create a cross-instance request storm.

Rollback when a release causes any of these regressions relative to the last healthy release:

- The symbol universe is truncated or differs between lightweight and enriched responses.
- Required fields disappear.
- Multiple instances start concurrent full-market builds.
- Cached response latency or upstream request volume rises materially without an intentional budget change.
- The readiness endpoint reports ready while the market payload is lightweight.

Use the hosting platform's previously verified deployment rollback mechanism. This runbook does not authorize commits, pushes, deployments, secret changes, or rollback execution; those actions require explicit user approval.

## Evidence to retain

For each production verification or incident, retain:

- Deployment identifier and timestamp.
- `verify:market-enrichment` JSON summary.
- Strict readiness smoke result.
- Symbol count and enhanced-field coverage.
- Initial, ready, enriched, and cached timings.
- Sanitized error categories, without URLs containing credentials or authorization headers.
