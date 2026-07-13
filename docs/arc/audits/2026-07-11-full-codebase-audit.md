# 全代码库审计报告

**日期：** 2026-07-11
**范围：** 全仓库
**项目类型：** Next.js 16 / React 19 / TypeScript 5，附独立 Python 研究管线
**项目阶段：** Production（README 明确列出公开仓库和线上 Vercel 地址）
**审查角色：** performance、architecture、Next.js、product、security、senior、test quality、accessibility

> 严重度按生产阶段校准。本报告只审查并记录，没有修改业务代码、依赖或部署配置。

## 结论

项目的机械质量门禁良好：生产构建、TypeScript、ESLint、344 个 Node 测试和 11 个 Python 测试均通过；核心领域逻辑也有相当数量的行为测试。真正拉低健康度的是生产运行路径：全量市场接口把 660 个标的的研究级增强放进同步 HTTP 冷启动，实测超过客户端 25 秒预算并继续运行到服务端 60 秒超时；同时生产框架版本存在高危公告，关键前端和服务模块已经形成多职责 god files，且 API smoke、Python、UI 行为未进入统一 CI 门禁。

## Scorecard：6/21 — Fragile

| # | 维度 | 分数 | 依据 |
|---|---|:---:|---|
| 1 | Security Posture | 1/3 | 生产 Next.js 版本有高危公告；公开高成本 API 缺少共享限流。未发现硬编码密钥。 |
| 2 | Performance | 0/3 | `/api/market` 冷启动已实测超时，全量增强和缓存周期会持续放大上游请求。 |
| 3 | Architecture | 0/3 | 1 个 2000+ 行和多个 1000+ 行多职责源码文件；市场研究批处理与交互请求耦合。 |
| 4 | Code Quality | 1/3 | 工具全绿，但存在吞错、语义失真、分散环境配置和大规模死导出。 |
| 5 | Test Health | 1/3 | 单元测试多且稳定，但唯一真实 API smoke 为 10/11，失败路径未进入默认门禁；关键 endpoint 测试依赖源码正则。 |
| 6 | Resilience | 2/3 | 已有缓存、超时、重试、stale/fallback；但长任务取消、部分失败表达和持久化水合仍不完整。 |
| 7 | Operations | 1/3 | 构建/类型/Lint 干净且有 Vercel 配置，但没有 CI、监控或统一 Node+Python+API 门禁。 |
| | **总分** | **6/21** | **生产环境存在明确的可用性与维护风险。** |

| Bonus | 分数 | 依据 |
|---|:---:|---|
| Accessibility | 1/3 | 原生控件基础尚可，但两个模态和多处核心交互对键盘/读屏用户不可用。 |

## 项目画像与机械检查

- 248 个代码/脚本/测试文件，其中 63 个测试文件；另有 12 个 API route、32 个 client modules。
- 生产源码中 16 个文件超过 600 行，5 个超过 1000 行，1 个超过 2000 行。
- React 信号：36 个 `useEffect`；未发现 `dangerouslySetInnerHTML`、`eval`、legacy React API 或 raw `<img>`。
- CSS 信号：27 处 `transition: all`，0 处 `prefers-reduced-motion`。
- Knip：1 个未用文件、25 个未用导出、26 个未用导出类型、1 个未用依赖、1 个重复导出。
- 密钥强特征扫描：0 个匹配；`.env.local` 被 git ignore。
- 依赖审计：生产依赖 2 个 high、0 critical；全依赖 5 个 high、0 critical。
- Codebase map：检测到的两个循环均为 `import type`，不会形成运行时循环。

### 实际执行结果

| 检查 | 结果 |
|---|---|
| `npm run build` | 未执行：审计终端没有 `npm` 可执行文件，不代表项目失败。 |
| 直接运行 `next build`（同一项目依赖） | 通过；生成 15 个路由条目，其中 12 个为 API route。 |
| `next typegen` + `tsc --noEmit --incremental false` | 通过。 |
| ESLint `src scripts` | 通过，0 输出。 |
| Node test runner | 344/344 通过。 |
| `python3 -m unittest tests.test_ledger_strategy` | 11/11 通过。 |
| `verify-api-smoke.mjs` | 10/11；`market` 在 24,995ms 被中止，其余 10 个通过。 |
| `npm audit --omit=dev --json`（临时 npm CLI） | 2 high：`next`、`undici`；0 critical。 |
| Knip | 完成；发现上述未使用/重复表面。 |

验证使用工作区提供的 Node 24.14.0；项目声明 Node 22.x，因此正式修复后还应在 Node 22 CI 中重跑。

## 规格/行为符合性发现

### High — 主市场 API 不满足仓库自己的 smoke 超时预算

**文件：** `src/app/api/market/route.ts:13`、`src/lib/marketDataPipeline.ts:262`、`src/lib/marketBuildConfig.ts:18`
**证据：** 文档默认单接口预算为 25 秒；实测 `/api/market` 在 24,995ms 中止。服务端继续对 660 个标的构建，直到 60 秒 timeout。
**影响：** 冷实例或缓存失效时，主行情增强不可在既定预算内交付；调用方取消后仍可能继续消耗 Binance 配额和函数时长。
**建议：** `/api/market` 快速返回最近快照或明确的 `building/lightweight` 状态；将完整增强改为受控后台快照生产，并把 deadline/AbortSignal 传到上游。

### High — 历史数据下载把部分失败报告为完成

**文件：** `src/lib/services/dataCollector.ts:107`
**证据：** `curl` 未使用 `--fail`；下载/解压异常在逐日循环中记录后继续，循环结束固定打印 `Download completed`。
**影响：** 4xx/5xx、无效 ZIP 或部分日期缺失可能被当作成功，回测数据完整性被高估。
**建议：** 校验 HTTP 状态、ZIP/CSV 内容，返回逐日结构化结果并区分 success/partial/failed。

### High — 链上服务把上游故障降级成“没有结果”

**文件：** `src/lib/onchain/service.ts:950`、`:1155`、`:1199`
**证据：** 多个 provider/universe 请求异常直接返回 `[]`，缺少来源级失败标志。
**影响：** 用户无法区分“真实无匹配”和“所有数据源失败”，与项目“数据可信度优先”的产品边界冲突。
**建议：** provider 返回 `{data, status, errorKind, updatedAt}`；只在最终聚合边界决定展示 fallback。

## 代码质量与生产风险发现

### High — 生产 Next.js 版本命中高危公告

**文件：** `package.json:29`
**证据：** `next@16.2.4` 的生产审计包含 DoS、Proxy bypass 和 SSRF 类 high advisories；审计建议修复到 16.2.10。其中 DoS 与当前 App Router 部署直接相关，Proxy/WebSocket 类路径仍需结合实际启用配置判断。
**影响：** 生产服务存在已知拒绝服务风险；其他公告是否可利用取决于对应功能路径是否启用。
**建议：** 单独安排依赖升级，连同 `eslint-config-next` 对齐至至少 16.2.10，重跑完整门禁和 API smoke。依赖修改需单独确认。

### High — `/api/market` 把全市场研究批处理放在同步请求路径

**文件：** `src/lib/marketBuildConfig.ts:18`、`src/lib/marketDataPipeline.ts:312`、`src/app/api/market/route.ts:69`
**证据：** production enrichment limits 为 Infinity；约 660 个 symbol 被分成 40 个一组串行处理，每组并行拉 15m/5m/1d 后再拉情绪数据；route 等完整构建 60 秒才 fallback。
**影响：** 关键路径约为 17 个串行网络阶段，总请求随标的线性增长；公开请求还能跨 Vercel 实例重复触发。
**建议：** 快照生产/消费分离；交互路由只读共享快照；全覆盖改为异步分片、增量刷新和共享锁；为昂贵 route 加共享限流、并发预算和 429/Retry-After。

### High — `BacktestPanel` 是 2035 行多职责 god component

**文件：** `src/components/BacktestPanel.tsx:153`、`:588`、`:737`、`:1051`、`:1272`
**证据：** 同一 client 文件负责下载、覆盖率、预检重试、并发、风险参数、单币/组合回测、约 30 个状态和约 760 行 JSX。
**影响：** 网络、状态与渲染无法隔离测试；重跑/卸载缺少 generation id 和 AbortSignal，旧任务可能继续消耗资源或覆盖新状态。
**建议：** 先补 characterization tests，再提取 typed API client、preflight service、batch runner、`useBacktestRunController`/reducer 和结果子组件。

### High — 根页面客户端边界过宽，全部 tab 静态进入客户端图

**文件：** `src/app/page.tsx:1`、`:153`、`:591`
**证据：** 661 行根 page 是 `use client`，静态导入 dashboard、strategy、trading、onchain、macro 和 charts；本次构建产物观察到一个 947,231 字节的原始 JS chunk（约 925 KiB，非网络压缩后大小）。
**影响：** 非首屏研究/回测/链上代码也被下载解析；八个 tab 的数据生命周期继续集中到一个组件。
**建议：** server `page.tsx` 保留稳定结构，小型 client workspace 管理共享行情；按 tab dynamic import，并将各 tab 数据控制器下沉。SWR 本身无需替换。

### Medium — 重市场响应禁用压缩且缓存生命周期不匹配构建成本

**文件：** `src/app/api/market/route.ts:20`、`:42`、`src/lib/marketRouteCache.ts:53`
**证据：** 强制 `Content-Encoding: identity`；heavy memory cache 仅 5 秒，过期访问会启动全量重建，module state/inflight 只能单实例复用。
**影响：** 大 JSON 传输被放大，serverless 扩缩容时重复重建，30 秒轮询可能让上游长期高负载。
**建议：** 删除 identity header（先验证代理兼容原因）；按数据周期分层 TTL，使用共享快照和跨实例 build lock。

### Medium — 回测预检把网络异常表达成 `ok: true`

**文件：** `src/components/BacktestPanel.tsx:453`
**影响：** `validated` 与 `deferred` 无法区分，批量统计和 UI 会误解校验状态。
**建议：** 使用 `passed | failed | deferred` 判别联合，并在后续回测和 UI 中显式处理。

### Medium — 核心类型与服务边界持续膨胀

**文件：** `src/app/api/backtest/klines/route.ts:33`、`src/lib/types.ts:1`、`src/lib/onchain/service.ts:34`
**证据：** `KlineData` 由 route 定义却被多个 lib 反向导入；`TickerData` 聚合大量 optional 指标/策略字段并有 38 个 importers；onchain service 1564 行混合 provider、identity、eligibility、metrics 和 orchestration。
**建议：** 将领域契约移入 lib；拆分 BaseTicker/市场快照/指标/策略上下文/view model；把 onchain provider adapter 与纯领域判断分开。

### Medium — 环境配置和公共模块表面漂移

**文件：** `src/lib/onchain/service.ts:34`、`package.json:26`
**证据：** 生产代码约 55 处 `process.env`，无统一 typed validation；Knip 报告 52 个未用导出/类型、未用 `@vercel/blob`、重复导出。
**影响：** 配置在模块加载时冻结，错误配置不能启动时失败；公共 API 表面与真实使用不一致。
**建议：** 建立集中 env contract；把死导出作为一个清理任务复核。确认无部署侧隐式使用后，可移除 `@vercel/blob`，同时消除其 `undici` 高危传递依赖。

### Medium — 持久化与渐进请求的状态表达不完整

**文件：** `src/hooks/usePersistentSWR.ts:91`、`src/hooks/useWatchlists.ts:30`、`src/hooks/useProgressiveTimedPayload.ts:69`
**证据：** persisted value 在 effect 中恢复，首帧仍 loading；watchlist 先空渲染再恢复，可能把选中项重置为 all；渐进批次只保留单一 error，不能表达 failed symbols/partial/stale。
**建议：** 预水合或用 `fallbackData`；暴露 storageReady；用结构化 partial/failedSymbols 元数据，仅在补齐后清除错误。

### Medium — 测试门禁无法代表生产关键路径

**文件：** `package.json:14`、`:16`、`src/lib/marketEndpointFullCoverage.test.ts:8`、`src/lib/strategyMarketEndpoint.test.ts:8`
**证据：** 默认 verify 不包含 API smoke 和 Python；当前 smoke 10/11；两个关键 endpoint 套件主要读取源码后做 regex 匹配；没有 components/hooks 行为测试。
**建议：** 在受控 CI 中加入 Node 22、Python、API smoke；将 route/pipeline 改为可注入依赖的行为测试；补少量高风险 UI 测试（模态焦点、持久化水合、回测重跑/取消、partial failure）。

### Low — 缺少统一浏览器安全响应头

**文件：** `next.config.ts:5`、`src/app/layout.tsx:17`
**证据：** 未配置 CSP、`nosniff`、Referrer/Permissions Policy；应用使用 TradingView 外部来源。当前未发现明确 XSS sink。
**建议：** 增加与 TradingView 兼容的 CSP 和基础响应头，先在 preview 环境验证。

## 可访问性发现（Bonus）

### High — AlertSettings 不是可访问的模态框

**文件：** `src/components/AlertSettings.tsx:46`、`:67`、`:120`
**问题：** 无 dialog 语义、初始焦点、focus trap、Esc、焦点恢复；关闭按钮无可访问名称；级别卡是鼠标专用 div；switch 无名称/状态。
**WCAG：** 2.1.1、2.4.3、2.4.11、4.1.2。
**建议：** 使用原生 dialog/成熟可访问 primitive；级别卡改 button/checkbox，switch 使用 checkbox 或 `role=switch` + `aria-checked`。

### High — ChartDrawer 缺少 dialog 语义和焦点边界

**文件：** `src/components/ChartDrawer.tsx:51`
**问题：** 虽有 Esc 和关闭状态 inert，但打开时不聚焦、不 trap、不恢复触发器焦点，背景仍可被 Tab。
**WCAG：** 2.4.3、2.4.11、4.1.2。

### High — 多处核心点击目标仅鼠标可用

**文件：** `src/components/RiskConfigPanel.tsx:72`、`src/components/StrategyParameterPanel.tsx:115`、`src/components/SignalCard.tsx:74`
**问题：** 可点击标题/div 无键盘语义；键盘用户无法展开参数或打开币种图表。
**WCAG：** 2.1.1、4.1.2。

### Medium — 控件状态和减少动态效果缺失

**文件：** `src/components/ControlBar.tsx:95`、`src/components/TabNavigation.tsx:14`、`src/app/globals.css:136`
**问题：** 图标按钮依赖 title，当前 tab/view 仅视觉表达；全库无 `prefers-reduced-motion`，模态滑入、闪烁和 bounce 无法关闭。
**WCAG：** 1.3.1、2.3.3、3.3.2、4.1.2。

## 任务簇（按优先级）

## 2026-07-12 整改复核

代码侧 P0-P3 整改及架构拆分已完成，且未减少市场币种或增强字段：

- `/api/market` 继续返回完整 Binance U 本位合约基础行情；生产 smoke 中约 2.5 秒返回。
- Node 测试 377/377、Python 测试 11/11、ESLint、TypeScript、生产构建和 `git diff --check` 通过。
- 生产模式 API smoke 11/11 通过；验证 token 仅通过进程环境注入，没有写入 `.env*`。
- 原 1000+ 行文件已拆分：`BacktestPanel` 599 行、`AppWorkspace` 570 行、`onchain/service` 998 行、`backtestEngine` 999 行、`weiShenEngine` 969 行、`strategyParameters` 673 行。
- 第二轮继续拆分高耦合边界：`OnchainTracker` 818→542、`MacroView` 856→565、回测 K 线 route 726→440、`macro.ts` 914→580、宏观 route 919→781；资产池、ETF 解析、宏观类型、K 线辅助合并与展示叶子均有独立模块。
- 宏观资产池测试已由读取 route 源码做正则匹配改为直接验证导出的 typed 配置，降低了重构误报。
- Next.js 为 16.2.10，既有依赖审计结果为 0 high/critical；CSP、安全头、限流、CI、共享快照和分布式 lease 已落地。
- Knip 没有复跑：当前安装依赖中不存在 Knip 可执行文件；本轮没有为了单次检查新增依赖。
- 生产环境仍需配置 Redis REST 变量、`DATA_DOWNLOAD_TOKEN` 和外部监控；这些属于部署状态，不在本地代码中伪造。

按原 7 轴严格口径的当前保守评分为 **14/21 +2/3 Accessibility**：Security 3、Performance 2、Architecture 1、Code Quality 2、Test Health 2、Resilience 2、Operations 2。此前的 17/21 +3/3 属于乐观估计，不满足严格 rubric 对 600–999 行模块、真实浏览器/E2E、完整异步失败态以及生产监控/回滚证据的要求。

## 2026-07-13 运行态验证收尾

- 新增 `/api/health/market` readiness：区分 enriched ready、enrichment building/stuck、Redis 未配置和无市场数据，不暴露 Redis URL 或 token。
- 本地生产模式无 Redis 实测：`/api/market` HTTP 200，保留 660 个 symbol；health HTTP 503，明确报告 `redis-not-configured`、`lightweight`、`blocked`。
- 新增 `verify:market-enrichment`：等待增强快照 ready，比较轻量/增强 symbol 集合，验证必需字段、增强字段覆盖率和缓存命中耗时。凭据只由被测生产进程环境提供。
- API smoke 新增 market health 契约检查；设置 `API_SMOKE_REQUIRE_MARKET_READY=1` 时升级为严格生产 readiness 门禁。
- 两组 market/strategy endpoint 源码正则测试已替换为全市场 enrichment limit、策略 enrichment budget 和工作区请求策略的直接行为测试。
- 最新质量门禁：Node 385/385、Python 11/11、ESLint、Next typegen、TypeScript、Next.js 16.2.10 production build（16 routes）和 `git diff --check` 通过。
- 真实 Redis 全市场增强构建仍未现场完成；无凭据环境下严格 readiness smoke 和 enrichment verifier 均按预期失败，未伪造生产通过证据。

### 1. 市场快照与公共 API 负载治理

- `/api/market` 快照生产/消费分离。
- 共享缓存、跨实例 build lock、分层 TTL、AbortSignal。
- 昂贵 route 共享限流和并发预算。
- 恢复响应压缩并验证 payload/TTFB。

### 2. 依赖与生产安全

- 升级 Next.js 至无对应 high advisories 的补丁版本。
- 复核并移除未使用的 `@vercel/blob`/`undici` 路径。
- 增加 CSP 和基础安全头。

### 3. 回测边界与数据完整性

- 修复 dataCollector partial failure 语义。
- 将预检结果改为判别联合。
- 拆分 BacktestPanel 控制器/服务/UI，并增加取消、generation id 和行为测试。

### 4. 链上 provider 与数据质量

- provider adapter 返回结构化来源状态。
- 拆分 identity/eligibility/metrics/orchestration。
- 确保“无结果”和“来源失败”在 API/UI 中可区分。

### 5. 前端边界、bundle 与可访问性

- server page + 小型 client workspace，按 tab 动态加载。
- 用可访问 primitive 重做 AlertSettings/ChartDrawer 焦点模型。
- 修复非语义点击目标、控件名称/状态和 reduced-motion。

### 6. 统一验证与 CI

- Node 22 下运行 lint/typecheck/build/Node tests。
- 纳入 Python 11 tests 和 API smoke。
- 用行为测试替换关键源码正则测试，补少量 UI 高风险用例。

### 7. 类型、配置与死代码清理

- 下沉 KlineData，拆分 Ticker mega-DTO。
- 集中 typed env validation。
- 复核并清理 Knip 的未用文件、导出、类型和重复导出。

## 已排除/降级的扫描线索

| 线索 | 处理 |
|---|---|
| 两个 mapper 循环 | 全部由 `import type` 组成，运行时会擦除；不作为循环依赖 finding。 |
| `undici` high advisory | 来自未使用的 `@vercel/blob`，且仓库未使用 WebSocket；作为依赖清理项，不判为已确认可利用 high。 |
| `strategyParameters.ts` 1013 行 | 以配置数据为主，不能只凭行数认定 god module。 |
| `indicators.ts` 687 行 | 同类纯数学函数，未确认多职责，暂不单列。 |
| 客户端 SWR | 高频行情的既定需求，问题是边界和请求成本，不是 SWR 本身。 |
| script 中的 console 输出 | CLI/验证脚本的用户输出，不作为 debug-log 缺陷。 |
| raw image / unsafe HTML / eval | 扫描无命中。 |

## 建议执行顺序

1. 先处理 Next.js 高危补丁与 `/api/market` 冷启动/限流问题。
2. 修复数据下载和链上来源失败语义，避免研究结论建立在错误数据状态上。
3. 把 API smoke、Python 和行为测试接入 CI。
4. 再分阶段拆 BacktestPanel、根页面和 onchain service；不要一次性大重写。
5. 可访问性修复可以与前端边界拆分并行推进。
