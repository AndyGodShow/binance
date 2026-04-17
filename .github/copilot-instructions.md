# Copilot Instructions

本仓库是一个 Binance U 本位合约数据分析面板，面向高频盯盘、策略研究、历史数据下载、回测和模拟交易。请把它当作一个金融行情研究工具来维护：数据获取、指标计算、策略扫描、风险控制和 UI 展示必须保持清晰分层。

## Project Context

- Framework: Next.js 16 App Router
- UI: React 19, TypeScript, CSS Modules
- Data fetching: SWR, custom hooks, Next.js API routes
- Charts: Recharts
- Package manager: npm
- Deployment target: Vercel, `sin1` region in `vercel.json`

## Architecture Rules

- Put external data entry points and HTTP response handling in `src/app/api/`.
- Put reusable calculations, transformations, technical indicators, caching, backtest logic and service logic in `src/lib/`.
- Put strategy definitions and registry wiring in `src/strategies/`.
- Put position sizing and risk management logic in `src/lib/risk/`.
- Put client UI state, browser behavior and interactions in `src/components/` or `src/hooks/`.
- Do not place complex indicator calculations directly inside React components.
- Prefer the existing `@/*` path alias when importing from `src`.
- Add `"use client"` only when a component needs React hooks, browser APIs or client-side interaction state.

## Data And API Safety

- Preserve existing caching, batching, timeout, retry and failover behavior when touching market, Kline, open interest, funding, backtest or data download logic.
- Avoid changes that increase Binance API weight or request fan-out without an explicit reason.
- Do not hard-code secrets, tokens or private endpoints.
- Optional environment variables include `COINALYZE_API_KEY`, `MORALIS_API_KEY`, `SOLANA_NETWORK` and `BINANCE_FAPI_BASES`.

## Style

- Keep TypeScript strict and follow the surrounding file style.
- Most TypeScript and TSX files use single quotes.
- CSS should stay in CSS Modules, usually colocated under `src/components/`.
- Keep changes focused. Avoid unrelated formatting churn and large refactors.
- Add new dependencies only when necessary, and use npm so `package-lock.json` stays authoritative.

## Verification

Choose the smallest useful verification for the change:

```bash
npm run lint
npm run typecheck
```

Run a production build when touching Next.js config, API routes, server logic, dependencies or deployment behavior:

```bash
npm run build
```

For backtest, historical data, Kline, market data or download changes, start the app first and then run:

```bash
SYMBOL_LIMIT=10 CONCURRENCY=3 npm run verify:backtest
```

The repository has `src/lib/**/*.test.ts` files using `node:test`, but `package.json` currently does not define a unified `test` script.

## Files To Avoid Unless Explicitly Requested

- `.env*`
- `node_modules/`
- `.next/`
- `.vercel/`
- `.playwright-cli/`
- `output/`
- `data/historical/`
- `coverage/`, `out/`, `build/`
- `tsconfig.tsbuildinfo`, `next-env.d.ts`
- `.agents/workflows/auto-deploy.md`

## Response Guidance

- Default to Chinese when communicating in this repository.
- Before non-trivial edits, briefly state the intended files and scope.
- When commands or deployment details are uncertain, say they are pending confirmation instead of guessing.
- At the end of a task, report what changed, what was verified, what passed or failed, and any remaining risk.
- Do not commit, push or deploy unless the user explicitly asks.
