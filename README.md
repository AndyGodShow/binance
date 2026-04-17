# Binance U 本位合约数据面板

一个面向高频盯盘、策略研究、历史数据下载、回测和模拟交易的加密货币数据分析面板。项目基于 Next.js App Router 构建，聚合 Binance U 本位合约行情、持仓量、资金费率、多周期 K 线、技术指标、策略信号、宏观市场数据和链上代币研究数据，目标是在一个界面内完成“发现机会 -> 验证策略 -> 管理风险”的研究闭环。

> 本项目用于行情研究、策略辅助和模拟验证，不构成投资建议，也不应直接替代独立风控或交易系统。

## 核心能力

- **实时市场监控**：聚合合约行情、成交量、持仓量、资金费率、多周期涨跌幅和多维排行榜。
- **多周期指标分析**：支持 RSRS、布林带、肯特纳通道、Volatility Squeeze、ADX、Volume Profile、CVD 等指标视角。
- **策略扫描中心**：内置强突破、趋势确认、资金流入、RSRS、波动率挤压等策略，并通过注册表统一管理。
- **预警与提醒**：支持实时信号提醒、定时提醒、浏览器通知、信号池和自选列表追踪。
- **历史数据与回测**：支持 K 线拉取、覆盖率检查、批量回测、净值曲线、回撤和策略结果对比。
- **宏观与链上研究**：整合宏观市场视角和链上代币分析，辅助判断市场环境与资金偏好。
- **模拟交易与风控**：提供模拟交易、仓位计算、策略风控配置和不同策略的风险管理逻辑。

## 技术栈

- **框架**：Next.js 16 App Router
- **UI**：React 19、TypeScript、CSS Modules
- **数据请求**：SWR、自定义 hooks、Next.js API routes
- **图表**：Recharts
- **工具库**：lucide-react、clsx
- **代码检查**：ESLint 9、`eslint-config-next`
- **部署**：Vercel，`vercel.json` 当前指定 `sin1` region
- **包管理器**：npm，依据仓库内 `package-lock.json`

## 快速开始

```bash
npm install
npm run dev
```

默认开发地址：

```text
http://localhost:3000
```

常用命令：

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
```

回测与市场接口抽样验证需要先启动本地应用：

```bash
npm run dev
SYMBOL_LIMIT=10 CONCURRENCY=3 npm run verify:backtest
```

## 项目结构

```text
src/app/          Next.js App Router 页面、布局和 API routes
src/components/   面板 UI 组件与 CSS Modules
src/hooks/        客户端状态、SWR、可见性、自选和提醒 hooks
src/lib/          数据获取、缓存、指标计算、回测、宏观、链上和共享类型
src/lib/risk/     仓位、风控配置和策略风险管理逻辑
src/lib/onchain/  链上分析、服务层、展示层和类型
src/strategies/   策略注册表和策略实现
docs/             架构说明、历史数据指南、链上研究和钱包计划
scripts/          类型检查和回测验证脚本
data/             本地数据目录，data/historical/ 被 git 忽略
```

## 架构原则

项目的核心约束是保持数据、计算、策略和展示分层清晰：

- API routes 负责外部数据入口、HTTP 响应、缓存和失败切换。
- `src/lib/` 负责可复用计算、数据转换、指标、回测和服务逻辑。
- `src/strategies/` 负责策略定义、注册和扫描条件。
- `src/lib/risk/` 负责仓位和风控计算。
- `src/components/` 与 `src/hooks/` 负责 UI 展示、交互状态和浏览器行为。

修改行情、K 线、持仓量、回测或下载逻辑时，应保留现有缓存、批处理、超时、重试和 failover 模式，避免引入 API 限流风险。

## 环境变量

项目可以在没有私有密钥的情况下运行基础功能。可选环境变量包括：

```text
COINALYZE_API_KEY
MORALIS_API_KEY
SOLANA_NETWORK
BINANCE_FAPI_BASES
```

不要提交 `.env*` 文件或任何私有 token。

## 文档

- `docs/project_summary.md`：项目整体能力、架构现状和优化方向。
- `docs/历史数据获取指南.md`：历史数据、K 线下载和回测数据获取说明。
- `docs/onchain-data-research.md`：链上数据研究记录。
- `docs/wallet-integration-plan.md`：钱包集成计划。
- `AGENTS.md`：给 Codex、Copilot 和其他 AI 编码助手看的仓库级协作提示词。

## AI 协作提示

如果你使用 GitHub Copilot、Codex 或其他 AI 工具参与开发，请优先阅读：

- `.github/copilot-instructions.md`
- `AGENTS.md`

这两个文件约束了项目分层、命令、测试方式、文件禁区和沟通偏好，能减少 AI 把高频数据逻辑写进组件、破坏缓存策略或误改本地密钥的风险。
