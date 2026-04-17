# AGENTS.md

本文件是仓库级 AI 协作提示词，适用于 Codex、GitHub Copilot 和其他参与本项目的编码助手。它的目标不是替代 README，而是让 AI 在修改代码时理解项目边界、数据风险、验证方式和协作习惯。

## Project Overview

本仓库是一个 Binance U 本位合约数据分析面板，面向高频盯盘、策略研究、历史数据下载、回测和模拟交易场景。

应用基于 Next.js App Router 构建，主要聚合 Binance 合约行情、持仓量、资金费率、多周期 K 线、技术指标、策略信号、宏观市场数据和链上代币研究数据。核心原则是：数据获取、指标计算、策略扫描、风险控制和 UI 展示保持清晰分层，避免把高频数据逻辑散落到组件内部。

本文件是当前仓库的项目级 agent 指南。全局 Codex 偏好应放在 `~/.codex/AGENTS.md`，不要写进本项目文件。若未来在子目录增加更具体的 `AGENTS.md` 或 `AGENTS.override.md`，更靠近被修改文件的说明优先。

## Default Goal For AI Changes

每次改动都应优先维护这三件事：

- **数据可靠性**：行情、K 线、持仓量、资金费率、宏观和链上数据入口要保留缓存、超时、重试和失败兜底。
- **研究闭环**：新增功能应尽量服务于盯盘、筛选、策略验证、回测、模拟交易或风险控制之一。
- **低副作用**：避免无关重构、格式化 churn、请求频率放大、密钥暴露和部署流程误触发。

## Tech Stack

- 框架：Next.js 16 App Router
- UI：React 19、TypeScript、CSS Modules
- 数据请求：SWR、自定义 hooks、Next.js API routes
- 图表：Recharts
- 图标/工具库：lucide-react、clsx
- 语言/运行时：TypeScript 5、Node.js
- 代码检查：ESLint 9、`eslint-config-next`
- 包管理器：npm，依据是仓库内的 `package-lock.json`
- 部署配置：Vercel，`vercel.json` 指定 `sin1` region

## Commands

使用 npm，不要混用 pnpm/yarn，除非用户明确要求切换包管理器。

```bash
npm install
```

安装依赖。

```bash
npm run dev
```

启动本地开发服务器。README 记录的默认地址是 `http://localhost:3000`。

```bash
npm run build
```

构建生产版本。涉及 Next.js 配置、API routes、服务端逻辑、依赖或部署行为时应优先运行。

```bash
npm run start
```

在完成生产构建后启动生产服务器。

```bash
npm run lint
```

运行 ESLint。

```bash
npm run typecheck
```

运行 `scripts/typecheck.sh`。该脚本会执行 `npx next typegen`，准备 `.next/types/cache-life.d.ts`，然后运行 `npx tsc --noEmit --incremental false`。

```bash
npm run verify:backtest
```

运行 `scripts/verify-backtest-batch.mjs`。该命令需要有正在运行的应用接口，默认访问 `http://127.0.0.1:3000`，用于抽样验证市场和回测 API 响应。

该脚本支持：

- `BASE_URL`：覆盖默认应用地址。
- `SYMBOL_LIMIT`：抽样币种数量，默认 `30`。
- `CONCURRENCY`：验证并发数，默认 `3`。

示例：

```bash
SYMBOL_LIMIT=10 CONCURRENCY=3 npm run verify:backtest
```

通用单元测试命令：待确认。仓库中存在 `src/lib/**/*.test.ts`，使用 Node 内置 `node:test` 和 `node:assert/strict`，但 `package.json` 当前没有声明 `test` 脚本。

格式化命令：待确认。`package.json` 当前没有声明 Prettier 或其他 formatter 脚本。

## Project Structure

- `src/app/`：Next.js App Router 入口。
- `src/app/page.tsx`：主客户端面板外壳、tab 编排和主要数据流。
- `src/app/layout.tsx`：根布局、metadata、全局样式和错误边界。
- `src/app/api/`：API routes，包括 market、macro、longshort、open interest、RSRS、backtest klines、onchain dashboard、data download 等接口。
- `src/components/`：React UI 组件与对应 CSS Modules。
- `src/hooks/`：客户端 hooks，包括页面可见性、SWR 持久化、自选列表、策略扫描、提醒监控、定时提醒等。
- `src/lib/`：核心业务逻辑、指标计算、缓存、数据获取、Binance/Coinalyze 封装、回测引擎、排行榜、宏观逻辑、提醒逻辑和共享类型。
- `src/lib/risk/`：风控配置、仓位计算、价格工具和策略风控逻辑。
- `src/lib/onchain/`：链上分析、展示层、服务逻辑和类型。
- `src/lib/services/`：服务式数据收集逻辑。
- `src/strategies/`：策略注册表和策略实现。
- `public/`：静态 SVG 资源。
- `docs/`：项目文档、研究记录、钱包集成计划、历史数据指南。
- `scripts/`：类型检查和回测验证脚本。
- `data/`：本地数据目录；`data/historical/` 被 git 忽略。
- `output/`：生成物目录，例如 Playwright 截图。
- `.agents/workflows/`：已有 agent 工作流说明。

修改前可按场景补读文档：

- 总体架构不清楚时读 `docs/project_summary.md`。
- 修改历史数据、下载或回测逻辑时读 `docs/历史数据获取指南.md`。
- 修改链上或钱包相关逻辑时读 `docs/onchain-data-research.md` 和 `docs/wallet-integration-plan.md`。

## Coding Conventions

- 保持 TypeScript 严格模式。`tsconfig.json` 启用了 `strict: true` 和 `noEmit: true`。
- 优先沿用现有分层：
  - 外部数据入口和 HTTP 响应逻辑放在 `src/app/api/`。
  - 可复用计算、数据转换、指标和策略辅助逻辑放在 `src/lib/`。
  - UI 状态、浏览器行为和交互逻辑放在 `src/components/` 或 `src/hooks/`。
  - 策略定义和注册放在 `src/strategies/`。
  - 风控计算放在 `src/lib/risk/`。
- 从 `src` 导入时优先使用已有的 `@/*` 路径别名。
- 保持文件现有风格。多数 TypeScript/TSX 文件使用单引号；配置文件可能使用双引号。不要做无关格式化。
- 组件样式使用 CSS Modules，通常与组件同在 `src/components/` 下。
- 只有需要 React hooks、浏览器 API 或客户端交互状态的组件才添加 `"use client"`。
- 修改行情、K 线、持仓量或回测数据获取时，保留已有缓存、批处理、超时、重试和 failover 模式，避免引入 API 限流风险。
- 不要在组件里堆放复杂指标计算；优先抽到 `src/lib/` 并为纯逻辑补测试。
- 不要硬编码密钥、token 或私有 endpoint。可选环境变量包括 `COINALYZE_API_KEY`、`MORALIS_API_KEY`、`SOLANA_NETWORK`、`BINANCE_FAPI_BASES`。
- 新增依赖前先确认必要性。确实需要新增依赖时，使用 npm 更新 `package-lock.json`。
- 改动公共类型、API 响应结构或策略信号结构时，同步检查调用方、展示层和相关测试。

## Testing and Verification

根据改动范围选择最小但有效的验证方式。不要编造不存在的命令。

常规 TypeScript/UI 改动：

```bash
npm run lint
npm run typecheck
```

涉及 API routes、服务端逻辑、Next.js 配置、依赖或部署行为：

```bash
npm run build
```

涉及回测、历史数据、K 线、市场数据或数据下载：

```bash
npm run dev
npm run verify:backtest
```

如果默认回测验证太重，可以降低抽样：

```bash
SYMBOL_LIMIT=10 CONCURRENCY=3 npm run verify:backtest
```

涉及纯逻辑模块时，优先补或更新 `src/lib/**/*.test.ts`。当前测试使用 `node:test`，但仓库未声明统一测试脚本，因此具体运行命令为待确认。

涉及视觉或交互改动时：

- 启动本地应用。
- 在浏览器中检查受影响 tab 或组件。
- 若使用 Playwright 或截图验证，生成物应放在 `output/` 或既有约定目录中，不要提交无关截图。

完成任务时必须说明：

- 实际运行了哪些命令。
- 哪些通过、哪些失败。
- 如果跳过检查，说明原因，例如需要外部 API、缺少凭据、需要正在运行的 dev server，或命令待确认。

## Files Agents Should Avoid

除非任务明确要求，否则不要编辑：

- `.env*`，包括 `.env.local`：本地密钥和环境配置。
- `node_modules/`：安装依赖目录。
- `.next/`：Next.js 构建/开发输出。
- `.vercel/`：Vercel 本地项目元数据。
- `.playwright-cli/`：浏览器自动化生成的日志、快照和截图。
- `output/`：生成截图和报告。
- `data/historical/`：大型本地历史数据，已被 git 忽略。
- `coverage/`、`out/`、`build/`：生成输出。
- `tsconfig.tsbuildinfo`、`next-env.d.ts`：TypeScript/Next 生成文件。
- `package-lock.json`：只有依赖变更需要 npm 更新 lockfile 时才修改。
- `.agents/workflows/auto-deploy.md`：已有自动部署说明，只有用户明确要求调整工作流时才修改。

不要删除或重置用户已有改动。遇到无关的 dirty worktree 文件，忽略即可；如果影响当前任务，先读懂并顺着现有改动继续。

## Communication Preferences

- 默认使用中文沟通。
- 开始非平凡修改前，简要说明计划改动范围和涉及文件。
- 不确定的命令、测试方式或部署流程写“待确认”，不要猜。
- 汇报结果时优先讲结论、改了什么、验证了什么、还有什么风险。
- 修改密钥、部署配置、依赖策略、数据保留策略或自动部署流程前先询问。
- 除非用户明确要求，不要自动 commit、push 或触发部署。
- 如果用户要求部署，再参考 `.agents/workflows/auto-deploy.md`，并在执行前确认当前分支、远端和将要推送的改动。
- 保持改动聚焦，避免顺手做大范围重构、格式化 churn 或无关清理。
