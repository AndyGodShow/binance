# 2026-07-13 审计整改收尾复审

## 结论

本轮已关闭上一份工作区审计确认的全部代码级高风险项：轻量行情不再永久冻结，健康状态可跨实例共享，增强快照有统一 deadline、lease 续租与提交前 fencing，陈旧增强快照不再误报 ready；同时补强了全局限流、环境配置隔离、链上失败语义、验证脚本真实性和全市场 UI 保留行为。

当前没有发现新的 Critical/High 代码缺陷。无 Redis 的生产路径已验证可安全返回全部约 660 个合约的轻量行情；但真实 Redis 下的完整增强构建仍缺外部凭据和生产级证据，因此本复审结论是：**轻量降级模式可验证，Redis 增强模式在完成真实集成演练前不应视为生产验收完成。**

按原始严格 rubric，评分仍为 **14/21（Solid）**。分数没有随修复数量机械上涨，是因为 Architecture、Test Health、Operations 和 Resilience 的下一档要求真实浏览器自动化、生产 Redis 演练、监控告警/回滚证据以及进一步领域化拆分；这些不能用单元测试或代码数量替代。

本轮没有编辑 `.env*`，没有 commit、push、PR、部署或删除市场币种/字段。

## 现场范围

- 分支：`codex/audit-remediation`
- `git status --short`：132 条记录
- tracked diff：86 个文件，约 `+2018/-6066`
- untracked：51 个文件
- 审阅对象：全部 tracked diff、相关新增文件、原审计报告、收尾实施计划、行情/健康/Redis/限流/回测/链上/宏观/UI 关键调用链
- 约束：保留全部市场币种与数据；保留缓存、超时、重试和 failover；不触碰 `.env*` 和部署

## 评分对照

| 维度 | 整改前 | 上轮审计 | 本轮复审 | 复审依据 |
| --- | ---: | ---: | ---: | --- |
| Security | 1/3 | 3/3 | 3/3 | token、校验、安全头、进程内兜底及 Redis 全局限流均已落地；CSP 仍待分阶段收紧 |
| Performance | 1/3 | 2/3 | 2/3 | 两阶段全市场加载、轻量 TTL/单飞、共享缓存、deadline/abort 已完善；缺真实 Redis 全量耗时与请求放大数据 |
| Architecture | 1/3 | 1/3 | 1/3 | env、回测 props、route 类型依赖得到改善；仍有多个 600–999 行生产模块和较宽领域边界 |
| Code Quality | 1/3 | 2/3 | 2/3 | dead API、重复类型和歧义错误语义已清理；大模块仍限制可维护性上限 |
| Test Health | 1/3 | 2/3 | 2/3 | 399 个 Node/TS 测试、11 个 Python 测试及真实手动浏览器验证通过；尚无可重复浏览器 E2E 套件 |
| Resilience | 1/3 | 2/3 | 2/3 | freshness、fencing、超时、共享 health、失败语义已补齐；真实 Redis 竞争/TTL/恢复尚未现场验证 |
| Operations | 0/3 | 2/3 | 2/3 | CI、health、smoke、runbook 已增强；缺生产告警、回滚和故障演练记录 |
| **总分** | **6/21** | **14/21** | **14/21** | 风险显著下降，但严格档位证据尚未跨过下一档门槛 |

可访问性为 **+2/3**：modal Escape、focus restore、ARIA、键盘 tab 与 reduced-motion 已有实现和手动浏览器证据；缺自动化屏幕阅读器/浏览器回归，暂不评 3/3。

## 已关闭的问题

### 行情正确性与性能

1. 轻量行情增加 10 秒 TTL 和 single-flight 刷新；刷新失败保留上一份可服务快照，不截断 symbol。
2. 冷启动轻量行情仍合并 ticker、premium index 和 exchange info，保留所有有效 USDT 永续合约及轻量字段。
3. UI 不再按成交额或短期 freshness 永久过滤低成交/暂时陈旧合约；浏览器实际显示 660/660。
4. 完整增强构建使用统一 240 秒 AbortSignal，并贯穿 Binance Kline、OI、Coinalyze、CoinGecko 等调用。
5. lease 支持 owner-safe renew、ownership check 和 release；fencing 校验位于 `unstable_cache` 回调内部，失去所有权的结果不能写入 Next Data Cache。
6. Redis metadata 写入使用单调/质量保护，近期 enriched 状态不会被并发 lightweight 请求降级覆盖。

### 安全、韧性与运维真实性

1. market 限流在 Redis 可用时采用共享固定窗口；Redis 故障时回退进程内限流，不放大上游请求。
2. market health 优先读取共享 Redis metadata，并区分 serving 与 ready；超过 10 分钟的增强快照报告 `enriched-snapshot-stale`。
3. 无 Redis 生产环境明确报告 `redis-not-configured`，同时继续服务全币种轻量行情。
4. 链上 provider 失败不再伪装为“搜索无结果”，而是由顶层返回上游失败语义。
5. typed env 拆成 Binance、Redis、Onchain、Macro、Archive、Download 等域读取器，无关域的错误配置不再阻断当前入口。

### 验证与冗余

1. 增强验证器检查 symbol 唯一性、必需数值有限性、可选增强数值合法性及 80% 默认覆盖阈值。
2. CI smoke 先请求 market 再检查 health；health 必须有至少 500 个 symbol，且只接受显式允许的降级原因。
3. 不再把生产中固定为空的 `/api/oi/all` 当作有效 smoke 证据；路由暂保留兼容性。
4. 删除了两个仅匹配源码文本的伪 E2E 断言，保留并补强公开行为测试。
5. `KlineData` 不再从 API route 反向导入；重复 `BacktestSymbolSource` 已统一，BacktestControls props 收拢为领域 view model。
6. README 和普通文档中的 Blob/cron 过期说明已清理；遵守约束未修改 `.env.example`。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| Node/TypeScript tests | **399/399 通过** |
| Python tests | **11/11 通过** |
| ESLint `src scripts --max-warnings=0` | 通过 |
| `next typegen` + `tsc --noEmit --incremental false` | 通过 |
| Next.js 16.2.10 production build | 通过；16 routes |
| `git diff --check` | 通过 |
| 敏感信息模式扫描（排除 `.env*`、lockfile） | 无命中 |
| production API smoke | **11/11 通过**；平均约 820ms |
| 实际 market API | 660 条、660 个唯一 symbol、全量轻量响应 |
| 实际 health API（无 Redis） | 503；`serving=true`、`redis-not-configured`、`symbolCount=660`，符合 fail-closed 设计 |
| 浏览器主表 | DOM 行数 660，界面显示“可见合约 660 / 总监控范围 660” |
| 浏览器交互 | tab 切换、提醒 modal Escape 关闭与焦点恢复、宏观/链上页面安全加载通过 |

实际执行使用 Codex bundled Node，因为当前 shell 找不到普通 `npm`。核心命令等价于：

```bash
node --test src/lib/**/*.test.ts scripts/**/*.test.mjs
python3 -m unittest tests.test_ledger_strategy
node node_modules/eslint/bin/eslint.js src scripts --max-warnings=0
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build
node scripts/verify-api-smoke.mjs
git diff --check
```

生产服务器只为 smoke 和浏览器检查临时启动，完成后已停止；测试 token 只注入进程环境，未落盘。

## 未完成但不能伪装为代码已修复的事项

### 1. 真实 Redis 增强行情验收

当前没有提供 Redis REST 测试凭据，因此没有执行真实多实例 lease 竞争、TTL、续租、owner 丢失、失败恢复、完整增强字段覆盖和构建耗时验收。代码及模拟测试已通过，但这仍是增强模式上线前的硬门槛。

验收至少应证明：

- 全部 symbol 保留且唯一；
- 必需字段 100% 合法，增强字段达到约定覆盖率；
- 并发实例只有一个 builder；
- lease 续租/过期/owner 丢失时不会提交旧结果；
- 缓存命中不重复放大 Binance/第三方调用；
- 构建失败后能回退旧快照并在下一窗口恢复。

### 2. 可重复浏览器 E2E

本轮进行了真实浏览器手动回归，但仓库没有可直接复用的 Playwright/组件测试依赖，因此没有仅为提高分数而新增依赖。下一步应在用户认可测试依赖策略后，把 660 行保留、tab、modal focus、回测控制、宏观/链上失败态固化为 CI E2E。

### 3. 架构规模上限

最大生产模块仍包括：`backtestEngine.ts` 999 行、`onchain/service.ts` 990 行、`weiShenEngine.ts` 969 行、`macro/route.ts` 800 行。它们并非仅凭行数就是 bug，但严格 Architecture 3/3 要求更清晰的领域边界、可独立测试接口和更少跨层协调；应逐个领域拆分，不能再次做 80 文件级纯行数重构。

### 4. 生产观测、告警和回滚演练

health 与 smoke 已能暴露长期 lightweight/stale 状态，但尚无真实生产告警接收、故障注入、回滚或 Redis 降级演练记录。Operations 因此维持 2/3。

### 5. CSP 分阶段收紧

当前 CSP 仍允许 `script-src/style-src 'unsafe-inline'`，`connect-src` 也较宽。未发现已确认 XSS sink，但要移除这些配置需先用 Report-Only 收集 Next.js 与 TradingView 的 nonce/hash/connect 需求，再灰度切换；本轮不冒险破坏图表集成。

### 6. 受规则约束的配置漂移

`.env.example` 中仍可能存在已移除 Blob/cron 变量，但用户明确禁止本轮编辑 `.env*`。README 和普通文档已清理；环境示例需单独授权后处理。

## 最终部署判断

- **本地质量门禁：通过。**
- **无 Redis 全币种轻量模式：行为已验证，能服务但 readiness 明确降级。**
- **Redis 完整增强模式：等待真实凭据集成验收。**
- **直接全面生产发布：暂不建议。** 应先完成真实 Redis、告警/回滚和可重复浏览器安全网，再按相同 rubric 复评。

`npm audit` 跳过：普通 npm runtime 不在当前 shell PATH；未为此擅自安装依赖。Knip 跳过：当前依赖未安装 Knip；没有仅为审计增加依赖。
