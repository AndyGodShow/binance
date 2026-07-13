# 2026-07-13 工作区全量改动审计

## 结论

当前整改在安全、可维护性、自动化门禁和故障语义上有明显进步，机械检查全部通过；但仍存在 4 项与生产行情正确性有关的高风险问题。因此当前保守评分维持 **14/21（Solid）**，部署判断为 **暂不建议直接上线**，应先修复行情轻量快照刷新、共享健康状态、构建 deadline/lease 和陈旧增强快照 readiness。

本轮为只读代码审计；除本报告外没有修改业务代码，没有编辑 `.env*`，没有 commit、push、PR 或部署。

## 范围与现场状态

- 分支：`codex/audit-remediation`
- `git status --short`：123 条记录
- tracked diff：81 个文件
- untracked：45 个文件
- 审阅范围：当前全部 tracked diff、相关新增文件、关键调用链及现有审计/整改计划
- 专项复核：安全/性能、架构/代码质量、测试/韧性

## 质量门禁

| 检查 | 结果 |
| --- | --- |
| Next.js production build | 通过；16 routes |
| `next typegen` + `tsc --noEmit --incremental false` | 通过 |
| ESLint `src scripts --max-warnings=0` | 通过 |
| Node/TypeScript tests | 385/385 通过 |
| Python tests | 11/11 通过 |
| `git diff --check` | 通过 |
| 敏感信息模式扫描（排除 `.env*`、lockfile） | 无命中 |
| `npm audit` | 跳过：当前 shell 无普通 npm runtime |
| Knip/dead-code scanner | 跳过：当前依赖未安装 Knip；未擅自新增依赖 |

## 评分对照

| 维度 | 整改前 | 当前 | 说明 |
| --- | ---: | ---: | --- |
| Security | 1/3 | 3/3 | token、输入校验、安全头和限流均有改善；CSP 仍可继续收紧 |
| Performance | 1/3 | 2/3 | 两阶段全市场加载和缓存有效，但 lease/deadline 仍有请求放大风险 |
| Architecture | 1/3 | 1/3 | 已拆掉多个 god file，但仍有跨域 env 耦合、反向依赖和浅拆分 |
| Code Quality | 1/3 | 2/3 | strict TS、lint 和模块化改善；仍有无效参数、重复类型和高耦合 props |
| Test Health | 1/3 | 2/3 | 测试数量与门禁明显增强；缺真实浏览器行为与部分 wiring 测试 |
| Resilience | 1/3 | 2/3 | 缓存、failover、错误语义改善；行情刷新及 lease 仍有关键缺口 |
| Operations | 0/3 | 2/3 | CI、smoke、health 已建立；监控真实性、告警和回滚证据不足 |
| **总分** | **6/21** | **14/21** | 严格 rubric 下维持 Solid |

可访问性沿用上一轮证据为 **+2/3**；本轮未重新执行完整浏览器可访问性专项。

## 必须修复（高）

### 1. 无 Redis/轻量模式的行情会永久冻结

`src/app/api/market/route.ts:122-132` 在存在 `lastFallbackMarketData` 后直接复用；`src/lib/marketRouteCache.ts:47-55` 只记录时间，没有 TTL 或重新抓取分支。生产无 Redis 时虽然保留约 660 个 symbol，但价格、成交量、资金费率等轻量字段可能一直停留在首次快照。

建议：为轻量快照增加较短 TTL 和请求合并刷新；继续保留全币种，且不得在无 lease 时启动完整增强构建。

### 2. market health 使用进程内状态，多 route function 部署下可能失真

`src/app/api/market/route.ts` 与 `src/app/api/health/market/route.ts:4,12` 通过 `src/lib/marketRuntime.ts` 的模块单例共享状态。本地 `next start` 同进程可工作，但 serverless/独立 route function 拓扑不保证二者共享内存，health 可能持续报告 `no-market-data`，或与实际 market 实例状态不一致。

建议：将健康摘要所需的 snapshot metadata（质量、symbol 数、构建状态、时间、owner/lease）写入 Redis/共享存储；health 不依赖另一个 route 的进程内内存。

### 3. 构建 deadline 未贯穿网络请求，可能越过 lease TTL

`src/app/api/market/route.ts:29-32` 使用 240 秒 deadline 和 260 秒 lease；但 `src/lib/marketBuildConfig.ts:89-105` 只在 batch 边界检查，`src/lib/marketDataPipeline.ts:253-271,303-370` 的 OI、Wei、Kline 和 sentiment 网络调用没有接收/响应统一 AbortSignal。旧构建可能在 lease 过期后继续运行，新实例再次取得 lease，形成两次全市场增强构建和 Binance 请求放大。

建议：从 deadline 派生 AbortSignal 并贯穿所有 provider；增加 lease 续租或 fencing/owner 校验，提交快照前再次确认 owner；补 lease 竞争、超时和恢复集成测试。

### 4. 任意年龄的增强快照都被 health 判为 ready

`src/lib/marketHealth.ts:28-40` 只要 `lastSuccessfulMarketData` 非空就返回 `ready`，虽然计算了 `snapshotAgeSeconds`，却没有最大年龄预算。数小时甚至数天未更新的增强快照仍可能通过 readiness 和严格 verifier。

建议：定义 enriched snapshot 最大可接受年龄；超过阈值应为 degraded/not-ready，并保留“仍可服务陈旧数据”和“可接收新流量”两个不同信号。

## 应尽快完善（中）

1. **typed env 跨域耦合**：`src/lib/env.ts:50-65` 每次 `readServerEnv()` 都校验 Solana 和 Binance。无关的 `SOLANA_NETWORK` 拼错可能让 market/archive/download 模块启动失败。建议拆成按域读取/校验。
2. **增强验证门槛过低**：`scripts/verify-market-enrichment.mjs:11-14,68-86` 默认覆盖率仅 10%，只查少数字段，未严格校验有限数值和重复 symbol。应做逐字段覆盖率、数值合法性和唯一性检查。
3. **CI health smoke 可在零数据时通过**：`scripts/verify-api-smoke.mjs:64-75` 与 CI 允许非严格 503，`symbolCount=0` 也可能被接受。应明确允许的降级原因并设 symbol 基线。
4. **部分测试只验证配置常量，不验证 wiring**：`marketEndpointFullCoverage.test.ts`、`strategyMarketEndpoint.test.ts`、部分 macro 测试无法证明 route 真正调用 builder、pipeline 真正合并数据。建议注入依赖后测试 handler 行为。
5. **缺真实组件/浏览器回归**：`src/lib/onchain/onchainTracker.e2e.test.ts:537-555` 仍以源码 regex 收尾。tab、全市场展示、modal focus、回测控制和失败态缺浏览器级保护。
6. **onchain 搜索失败与空结果混淆**：`src/lib/onchain/service.ts:555,599,832` 捕获 provider 失败后返回 `[]`，上层可能误报“无结果”。建议返回结构化 provider 状态。
7. **lib 反向依赖 route 类型**：`src/lib/services/klineArchive.ts:4`、`src/lib/klineRangeUtils.ts:1` 从 API route 导入 `KlineData`。虽为 type-only，不是运行时循环，但依赖方向不合理，应移至领域 contract。
8. **BacktestPanel 属于浅拆分**：`BacktestControls` 约 40 个 props，父组件逐项透传。建议以 selection/range/execution/risk/status view model + actions 或 reducer 收拢边界。
9. **进程内 limiter 不具备全局语义**：多实例下配额会按实例放大，并依赖代理头边界。若要改为 Redis 全局限流，需先明确生产代理与部署策略。

## 冗余与既存债务（低）

- `src/lib/marketRouteCache.ts:85-95` 的 `buildDeadlineMs` 被立即 `void`，是无效 API；应删除或真正实现。
- `BacktestSymbolSource` 在 `backtestPanelSupport.ts` 和 `BacktestControls.tsx` 重复定义，存在漂移风险。
- `.env.example` 与 README 仍记录已移除 `@vercel/blob` 对应的 `BLOB_READ_WRITE_TOKEN`；`CRON_SECRET` 也未发现代码引用。清理前应确认外部部署约定，且环境示例变更需用户授权。
- `/api/oi/all` 在生产 symbol limit 为 0，UI 也不再消费其结果，但 CI 仍 smoke 此空对象接口。需确认是否保留兼容契约，否则是遗留死入口。
- CSP 仍有 `script-src 'unsafe-inline'` 和较宽的 `connect-src`；当前未发现可利用 XSS sink，因此属于纵深防御，不是已确认漏洞。应先以 Report-Only 验证 TradingView 等第三方集成。

## 已排除的误报

- 两个 mapper 依赖环均由 `import type` 形成，没有确认运行时循环。
- `daily freshness` 表示美股、港股、A 股观察数据按交易日判断是否新鲜，不表示每 24 小时才请求一次，也不是本轮可确认回归。
- 未发现硬编码密钥、危险 `eval`/HTML 注入或数据下载 token 绕过。
- provider adapter 文件较长，但职责相对内聚，不仅凭行数认定为缺陷。

## 建议整改顺序

1. 修复轻量快照 TTL/合并刷新，以及陈旧增强快照 health 判定。
2. 将 health metadata 共享化，消除 route function 进程内状态假设。
3. 贯穿构建 AbortSignal，补 lease 续租/fencing 与真实 Redis 集成验证。
4. 提高 verifier/CI smoke 的真实性，补关键浏览器行为测试。
5. 拆分按域 env 校验，修复 onchain 失败语义和 route/lib 类型边界。
6. 最后再做 Backtest 状态边界深化及确认后的死入口/文档清理。

每一批都应运行相关单测、lint、typecheck、build；行情批次还必须复核全 symbol 数量、字段覆盖、缓存命中、失败恢复和外部请求放大。
