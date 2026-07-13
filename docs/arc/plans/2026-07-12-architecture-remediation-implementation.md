# Architecture Remediation Implementation Plan

> **For Arc:** Use /arc:implement to execute this plan. No automatic commit, push, deployment, or secret changes.

**Source:** `docs/arc/audits/2026-07-11-full-codebase-audit.md`, architecture and operations findings
**Goal:** Remove confirmed god-file boundaries while preserving the full market-data universe and all existing public behavior.
**Stack:** Next.js 16 + React 19 + TypeScript 5 + Node test runner + npm
**Planned at:** `HEAD` (working tree already contains the audit remediation and is intentionally uncommitted)
**Out of scope:** Production deployment, Redis credentials, automatic commits/pushes, and changes to market-data retention.

## File structure

- `src/components/BacktestPanel.tsx`: retain top-level composition and user interaction wiring.
- `src/components/backtest/`: own result presentation and run-controller UI boundaries.
- `src/lib/backtestPanelSupport.ts`: own pure interval, pagination, formatting, and request-result helpers.
- `src/lib/onchain/service.ts`: retain research-payload orchestration only.
- `src/lib/onchain/tokenIdentity.ts`: own identity and candidate-mapping rules.
- `src/lib/onchain/tokenEligibility.ts`: own eligibility and concentration exposure rules.
- `src/lib/onchain/providerAdapters.ts`: own Moralis/DEX response mapping and provider I/O.

## Tasks

<task id="1" depends="" type="auto">
  <name>Characterize public refactor boundaries</name>
  <files><test>src/lib/onchain/service.test.ts</test><test>src/lib/backtestSymbolValidation.test.ts</test></files>
  <read_first>src/components/BacktestPanel.tsx; src/lib/onchain/service.ts; existing tests</read_first>
  <action>Keep existing service exports and rendered labels stable. Add focused tests only where an extracted pure boundary lacks direct coverage.</action>
  <test_code>Existing onchain eligibility, identity, provider-status, and backtest validation tests are the characterization safety net.</test_code>
  <verify>`npm test` exits 0 before structural moves.</verify>
  <done>Public behavior is covered before extraction.</done>
  <commit>test(architecture): characterize refactor boundaries</commit>
</task>

<task id="2" depends="1" type="auto">
  <name>Split BacktestPanel responsibilities</name>
  <files><modify>src/components/BacktestPanel.tsx</modify><create>src/components/backtest/*.tsx</create><create>src/lib/backtestPanelSupport.ts</create></files>
  <read_first>src/components/BacktestPanel.tsx; src/components/BacktestPanel.module.css; backtest domain modules</read_first>
  <action>Extract pure helpers, result views, and run control one boundary at a time. Preserve props, labels, state transitions, all-symbol selection, concurrency limits, and latest-run protection. Keep each authored file below 600 lines where practical and below 1000 lines unconditionally.</action>
  <test_code>Pure support functions receive direct Node tests; existing backtest suites cover business behavior.</test_code>
  <verify>`npm test`, `npm run typecheck`, and `npm run lint -- --max-warnings=0` exit 0; `wc -l` reports no BacktestPanel-family file above 1000 lines.</verify>
  <done>Backtest orchestration and presentation have explicit ownership boundaries.</done>
  <commit>refactor(backtest): split panel orchestration and result views</commit>
</task>

<task id="3" depends="1" type="auto">
  <name>Split onchain service responsibilities</name>
  <files><modify>src/lib/onchain/service.ts</modify><create>src/lib/onchain/tokenIdentity.ts</create><create>src/lib/onchain/tokenEligibility.ts</create><create>src/lib/onchain/providerAdapters.ts</create></files>
  <read_first>src/lib/onchain/service.ts; src/lib/onchain/types.ts; src/lib/onchain/service.test.ts; src/lib/onchain/onchainTracker.e2e.test.ts</read_first>
  <action>Move pure identity and eligibility rules plus provider-specific I/O/mapping behind typed module interfaces. Re-export existing public functions from service.ts during migration. Do not change fallback, status, or data-quality semantics.</action>
  <test_code>Existing service and tracker E2E tests must pass unchanged; add direct tests for newly public pure boundaries only when coverage is absent.</test_code>
  <verify>`npm test`, `npm run typecheck`, and `npm run lint -- --max-warnings=0` exit 0; no onchain authored source file exceeds 1000 lines.</verify>
  <done>Onchain orchestration no longer owns provider mapping, identity, and eligibility rules.</done>
  <commit>refactor(onchain): separate providers identity and eligibility</commit>
</task>

<task id="4" depends="2,3" type="auto">
  <name>Run complete quality and production-path verification</name>
  <files><modify>docs/arc/audits/2026-07-11-full-codebase-audit.md</modify></files>
  <read_first>package.json; .github/workflows/ci.yml; market smoke scripts</read_first>
  <action>Run Node and Python tests, ESLint, typecheck, Knip, dependency audit, production build, and local API smoke. Record production-only Redis/monitoring/deployment checks as external prerequisites rather than fabricating evidence.</action>
  <test_code>No new test code; this is the complete verification gate.</test_code>
  <verify>Every declared command has recorded exit status and counts; skipped production checks have explicit reasons.</verify>
  <done>Architecture score is recalculated from current evidence using the original rubric.</done>
  <commit>docs(audit): record architecture remediation verification</commit>
</task>

## Decision log

- 2026-07-12: Preserve all market symbols and enhanced fields; architecture work must not introduce Top-N truncation.
- 2026-07-12: Repository instructions prohibit automatic commits, so task commit labels are documentation only until the user explicitly authorizes commits.
