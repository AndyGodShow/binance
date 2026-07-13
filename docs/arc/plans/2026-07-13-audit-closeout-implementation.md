# Audit Closeout Implementation Plan

> **For Arc:** Execute incrementally with tests first. Do not commit, push, deploy, edit `.env*`, remove symbols, or reduce retained market fields.

**Source:** `docs/arc/audits/2026-07-13-working-tree-audit.md`
**Goal:** Close every confirmed audit finding while preserving the full Binance futures universe, request protection, public behavior, and user-owned working-tree changes.
**Stack:** Next.js 16, React 19, TypeScript 5, Node test runner, npm, Upstash-compatible Redis REST.
**Planned at:** current intentionally dirty working tree on `codex/audit-remediation`.

## File structure

- `src/lib/marketRouteCache.ts`: in-process enriched/lightweight cache coalescing only.
- `src/lib/marketHealth.ts`: pure health/readiness policy.
- `src/lib/marketCoordination.ts`: shared market build/health metadata contract and Redis REST adapter.
- `src/lib/distributedLease.ts`: owner-safe acquire/renew/release operations.
- `src/lib/marketDataPipeline.ts`: deadline/abort-aware full-market orchestration.
- `src/lib/env.ts`: normalization plus domain-specific readers without cross-domain validation.
- `scripts/verify-*.mjs`: observable deployment contracts, not source/config self-tests.
- `tests/` or existing Node test locations: behavior and browser safety nets without new dependencies unless already available.

## Tasks

<task id="1" depends="" type="auto">
  <name>Make lightweight and enriched freshness truthful</name>
  <files><modify>src/lib/marketRouteCache.ts</modify><modify>src/app/api/market/route.ts</modify><modify>src/lib/marketHealth.ts</modify><test>src/lib/marketRouteCache.test.ts</test><test>src/lib/marketHealth.test.ts</test></files>
  <read_first>src/app/api/market/route.ts; src/lib/marketRouteCache.ts; src/lib/marketHealth.ts</read_first>
  <action>Add a short lightweight TTL with a single in-flight refresh promise; never truncate symbols. Add an enriched maximum-age policy so stale data may still be served but cannot report ready. Remove the unused buildDeadlineMs option.</action>
  <test_code>Tests prove fresh fallback reuse, stale fallback single-flight refresh, failed refresh preservation, and expired enriched readiness.</test_code>
  <verify>Target Node tests pass; lint and typecheck pass.</verify>
  <done>No indefinitely frozen lightweight cache and no indefinitely ready enriched snapshot.</done>
  <commit>fix(market): enforce truthful snapshot freshness</commit>
</task>

<task id="2" depends="1" type="auto">
  <name>Share market health metadata across route functions</name>
  <files><create>src/lib/marketCoordination.ts</create><test>src/lib/marketCoordination.test.ts</test><modify>src/app/api/market/route.ts</modify><modify>src/app/api/health/market/route.ts</modify></files>
  <read_first>src/lib/distributedLease.ts; src/lib/env.ts; both market routes</read_first>
  <action>Persist non-sensitive snapshot/build metadata in Redis REST with bounded TTL. Health reads shared metadata when Redis is configured and falls back to process state only in local/non-distributed mode. Redis failures produce explicit degraded health and do not increase upstream calls.</action>
  <test_code>Adapter tests cover read/write, invalid payload, Redis failure, expiry, and route-independent reconstruction.</test_code>
  <verify>Target tests, lint, typecheck, and health smoke pass.</verify>
  <done>Health no longer assumes market and health routes share memory.</done>
  <commit>fix(market): share health metadata through redis</commit>
</task>

<task id="3" depends="2" type="auto">
  <name>Bound full-market builds by deadline and lease ownership</name>
  <files><modify>src/lib/distributedLease.ts</modify><modify>src/lib/marketBuildConfig.ts</modify><modify>src/lib/marketDataPipeline.ts</modify><modify>src/app/api/market/route.ts</modify><test>related market and lease tests</test></files>
  <read_first>all provider calls in marketDataPipeline; async timeout helpers; distributed lease tests</read_first>
  <action>Derive one AbortSignal from the build deadline and pass it through OI, Wei, Kline, and sentiment calls where supported. Add owner-safe lease renewal and final ownership validation; stop work and refuse snapshot commit after ownership loss.</action>
  <test_code>Tests cover deadline abort, renewal, owner mismatch, competing builders, release, and failed-provider recovery.</test_code>
  <verify>Target tests pass; no full build continues after abort in the test harness; lint/typecheck/build pass.</verify>
  <done>A build cannot safely outlive its lease or publish after losing ownership.</done>
  <commit>fix(market): fence full snapshot builds</commit>
</task>

<task id="4" depends="1" type="auto">
  <name>Remove cross-domain failure coupling and ambiguous provider errors</name>
  <files><modify>src/lib/env.ts</modify><modify>env consumers and tests</modify><modify>src/lib/onchain/service.ts</modify><modify>onchain types/tests</modify><modify>backtest kline type imports</modify></files>
  <read_first>all readServerEnv call sites; onchain search stages; backtestKlineMerge contract</read_first>
  <action>Introduce domain readers so each entry validates only its own configuration. Preserve existing defaults. Represent onchain search provider failures separately from confirmed empty results. Move KlineData imports out of transport routes.</action>
  <test_code>Tests prove invalid Solana cannot break Binance-only consumers, invalid Binance cannot break unrelated consumers, and provider failure differs from no result.</test_code>
  <verify>Target tests, lint, typecheck, and build pass.</verify>
  <done>Configuration and failure semantics respect domain boundaries.</done>
  <commit>refactor(config): isolate domain validation</commit>
</task>

<task id="5" depends="2,3,4" type="auto">
  <name>Make verification test real behavior</name>
  <files><modify>scripts/verify-market-enrichment.mjs</modify><modify>scripts/verify-api-smoke.mjs</modify><modify>.github/workflows/ci.yml where required</modify><modify>market/macro/onchain tests</modify><create>browser behavior tests only with existing tooling</create></files>
  <read_first>package scripts; CI workflow; current source-regex/config-only tests; UI accessibility paths</read_first>
  <action>Require full symbol uniqueness, finite critical values, explicit per-field enhanced coverage, minimum symbol count, and expected degradation reasons. Replace configuration/source checks with injected route/pipeline behavior tests. Add critical browser coverage using existing tooling; do not add a dependency solely for audit cosmetics.</action>
  <test_code>Negative fixtures must fail each verifier contract; handler tests prove actual builder/policy wiring; browser tests cover tabs, full market rows, modal keyboard/focus, backtest, macro and onchain failure states.</test_code>
  <verify>All script tests and available browser tests pass; CI YAML remains valid.</verify>
  <done>Green verification corresponds to valid, non-empty, full-universe behavior.</done>
  <commit>test(quality): verify production behavior contracts</commit>
</task>

<task id="6" depends="4,5" type="auto">
  <name>Finish boundary and redundancy cleanup</name>
  <files><modify>BacktestPanel family and contracts</modify><modify>OI route/smoke only after compatibility confirmation</modify><modify>README documentation</modify></files>
  <read_first>Backtest controls/results props; OI callers; README and package usage</read_first>
  <action>Replace duplicated backtest type and long setter prop lists with cohesive typed view models/actions. Remove only confirmed unreachable OI plumbing; otherwise document its compatibility status. Remove stale Blob/cron documentation only after confirming no source/deploy reference. Do not edit `.env*`.</action>
  <test_code>Existing behavior tests remain green; add focused reducer/view-model tests where state ownership changes.</test_code>
  <verify>Tests/lint/typecheck/build pass; rg confirms no duplicate type or confirmed stale documentation remains.</verify>
  <done>Confirmed redundancy is removed without behavior or data loss.</done>
  <commit>refactor(quality): close confirmed audit debt</commit>
</task>

<task id="7" depends="1,2,3,4,5,6" type="auto">
  <name>Run production-path verification and re-audit</name>
  <files><create>docs/arc/audits/2026-07-13-post-closeout-audit.md</create></files>
  <read_first>all task diffs; original rubric; CI and smoke commands</read_first>
  <action>Run Node/Python tests, ESLint, typecheck, production build, diff check, secret scan, API smoke, full-universe and enrichment checks. Run real Redis integration only when credentials are supplied through process environment; otherwise mark it externally blocked without fabrication. Re-score with the same strict rubric.</action>
  <test_code>No synthetic evidence.</test_code>
  <verify>Every command and count is recorded, including explicit skip reasons.</verify>
  <done>A fresh audit identifies no unvetted Critical/High finding and reports remaining external prerequisites.</done>
  <commit>docs(audit): record closeout verification</commit>
</task>

## Decision log

- 2026-07-13: Keep the existing branch and dirty workspace; commit labels are documentation only because the user prohibited automatic commits.
- 2026-07-13: Preserve every market symbol and all enhanced fields. Refresh/caching changes may alter timing, never retention.
- 2026-07-13: Do not change rate-limit policy in this plan because security instructions require separate approval; verification may expose its deployment limitation.
- 2026-07-13: Do not edit `.env*`. Stale environment documentation is handled in README only unless the user separately authorizes `.env.example` changes.
