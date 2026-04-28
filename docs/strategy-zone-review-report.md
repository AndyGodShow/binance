# 策略专区审查报告

审查日期：2026-04-27

审查范围：本报告聚焦当前仓库里的“策略专区”真实实现，包括策略注册、实时扫描、信号池展示、策略参数、风控输出、回测链路、历史多周期上下文、可维护性和测试覆盖。主要参考文件包括：

- `src/components/StrategyCenter.tsx`
- `src/components/SignalCard.tsx`
- `src/hooks/useStrategyScanner.ts`
- `src/strategies/registry.ts`
- `src/strategies/*.ts`
- `src/lib/strategyTypes.ts`
- `src/lib/strategyInputs.ts`
- `src/lib/strategyParameters.ts`
- `src/lib/strategyScannerSnapshot.ts`
- `src/lib/backtestEngine.ts`
- `src/components/BacktestPanel.tsx`
- `src/lib/risk/*`
- 相关测试文件与策略说明文档

## 1. 总体结论

当前策略专区已经不是简单的“前端信号列表”。它具备较完整的策略研究闭环雏形：策略注册表统一管理策略，实时扫描器负责从增强后的行情数据生成信号，信号卡展示条件、置信度、叠加共振和风控计划，回测面板能复用策略检测逻辑，并且部分策略已经有参数候选、历史多周期上下文和风险仓位联动。

从工程成熟度看，策略专区目前处在“可用但仍偏研究型”的阶段。它的优势是扩展能力强、策略解释性较好、实时和回测正在逐步统一；主要问题是策略 ID、参数系统、输入契约和新增策略之间存在不完全同步，信号池当前每个 symbol 只保留一个主信号，策略启停状态不持久化，部分策略对缺失数据的兜底会导致实时扫描与回测口径不完全一致。

如果后续目标是高频盯盘和策略研究，当前基础值得继续沿用；如果目标接近真实交易辅助，则还需要补齐数据质量标记、信号生命周期、参数版本、回测可复现性和策略组合层面的风险约束。

## 2. 架构审查

### 2.1 策略注册与分层

`src/strategies/registry.ts` 使用单例 `StrategyRegistry` 注册策略，并提供 `getAll`、`getEnabled`、`getById`、`toggleStrategy` 和订阅能力。当前注册策略包括：

1. `strong-breakout`：强势突破。
2. `trend-confirmation`：趋势确认。
3. `capital-inflow`：资金流入。
4. `rsrs-trend`：RSRS 量化增强。
5. `volatility-squeeze`：波动率挤压。
6. `wei-shen-ledger`：魏神策略。
7. `sentiment-hotspot`：情绪热点。

整体分层方向是正确的：策略定义放在 `src/strategies/`，共享类型、参数、输入裁剪和扫描逻辑放在 `src/lib/`，UI 放在 `src/components/`，实时扫描放在 `src/hooks/`。

主要风险是注册表本身只维护内存态，策略启停不会写入 localStorage 或用户配置。页面刷新后策略默认启用状态会恢复到代码里的 `enabled` 值。对盯盘工具来说，这会让用户以为已经关闭的策略在刷新后重新参与扫描。

### 2.2 数据入口与策略输入契约

`src/lib/strategyInputs.ts` 为多数策略建立了输入字段白名单，例如强势突破只读取日线突破、5m EMA、多周期涨幅、成交额、OI、ATR 和 Keltner 等字段；魏神策略只读取 `strategyContexts.weiShen`。这是一个很好的边界设计，避免策略直接依赖完整 `TickerData` 的所有字段。

但当前存在一个明显不一致：`sentiment-hotspot` 已经在注册表中注册，并且 `useStrategyScanner`、`strategyScannerSnapshot` 已经消费 `strategyContexts.sentimentHotspot`，但是 `StrategyId`、`StrategyParameterConfigMap` 和 `STRATEGY_INPUT_CONTRACTS` 还没有包含 `sentiment-hotspot`。这意味着实时扫描可以跑，但参数面板、参数优化、输入契约测试和类型层面的策略枚举还没有完整接入该策略。

### 2.3 策略检测接口

`TradingStrategy.detect(ticker, context)` 的接口比较简洁，`StrategyDetectionContext` 支持：

- `now`
- `portfolioState`
- `parameterOverrides`
- `runtimeState`

这使实时扫描、单币回测、组合回测和参数优化有机会复用同一套策略逻辑。尤其是 `runtimeState` 把 cooldown、趋势状态等运行态从策略实现里抽出，是后续可测试和可复现的关键。

当前不足是实时扫描调用策略时只传了 `now` 和 `singletonStrategyRuntimeState`，没有传入 `parameterOverrides` 或真实 `portfolioState`。因此实时策略中心显示的信号未必与回测面板中手动参数、风险覆盖后的信号完全一致。

## 3. 实时扫描链路审查

### 3.1 扫描节流与数据摘要

`useStrategyScanner` 使用 `buildStrategyScannerTickerDigest` 对关键字段生成摘要，只有摘要变化或策略版本变化时才重新扫描对应 symbol；同时用 1 秒节流避免每次数据刷新都跑完整策略。这对高频行情面板是必要的，可以降低 CPU 和 React 状态更新压力。

摘要覆盖了价格、涨幅、突破、EMA、GMMA、成交额、OI、资金费率、RSRS、ATR、VP、布林带、Keltner、Squeeze、ADX、魏神上下文和情绪热点上下文，覆盖面较广。

风险点：

- 摘要使用 `JSON.stringify` 包含完整 `strategyContexts`，如果上下文对象较大或字段顺序不稳定，可能带来性能抖动。
- 摘要与 `STRATEGY_INPUT_CONTRACTS` 是两套手工维护清单，新增字段时容易漏一边。
- 当前扫描结果按 symbol 聚合，最终只保留每个 symbol 的一个主信号。

### 3.2 信号选择与叠加逻辑

`selectScannerSignalForSymbol` 会优先选择可交易信号，多个可交易策略同一 symbol 触发时取置信度最高的信号作为主信号，并添加：

- `stackCount`
- `stackedStrategies`
- `comboBonus`

两个策略共振加 10 分，三个及以上加 20 分。

这让信号池更简洁，适合盯盘，但对研究有信息损失：用户看不到同一 symbol 上被压掉的次级策略的完整条件、风险计划和入场理由。当前 UI 只显示触发策略名称列表，没有展开每个策略的独立解释。

另外，combo 加分后没有统一 clamp 到 100。部分策略本身最高可到 95 或 100，叠加后理论上可以超过 100。UI 直接显示 `signal.confidence`，这会让“100 分制”的语义变得不稳定。

### 3.3 信号生命周期

信号状态设计包括：

- `active`：实时触发。
- `snapshot`：页面打开时已经满足。
- `cooling`：条件回落但保留展示。

这个设计很实用，能避免开页时把历史成立条件误判为新信号，也能保留用户还没处理的回落信号。`dismissedSignals` 和 `strategySignals` 使用 localStorage 保存，体验上比纯内存更稳定。

当前风险：

- `dismissedSignals` 按 symbol 记录 timestamp，不区分 strategyId。一个 symbol 的某个策略被关闭后，另一个策略如果复用同一 timestamp 或主信号切换，存在误伤可能。
- existingSignalsMap 也是以 symbol 为 key，因此同一 symbol 同时出现多策略信号时，状态管理天然会合并为一个。
- `clearAll` 会清空信号、dismissed 和 stored，但不会清空策略运行态里的 cooldown 或 trend state；清空后策略是否马上重新触发取决于 runtimeState 内部状态。

## 4. 策略本体审查

### 4.1 强势突破

强势突破的条件相对明确：21 根已完成日线高点突破、多周期动量、24h 成交额、4h OI 正增长、5m EMA 多头排列、EMA 距离不过热。它是典型的追强策略，适合发现已经启动并有资金参与的标的。

优点：

- 突破基于已完成日线高点，避免直接使用当前未完成日线导致前视。
- 同时要求动量、量、OI 和 EMA 结构，减少单纯价格突破的噪音。
- 风控接入 `calculateBreakoutRisk`，信号卡可以展示止损、止盈和仓位。

风险：

- 只做多，没有对大盘风险状态做显式过滤。
- 对 breakout、EMA、OI 数据质量依赖强，缺失时多数条件会直接失败，但 UI 没有明确显示“数据缺失导致未触发”的统计。
- 触发后 cooldown 立即记录，若随后被 `isStrategySignalVisible` 或主信号选择压掉，策略内部仍可能进入冷却。

### 4.2 趋势确认

趋势确认策略使用 `trendStateManager` 的运行态评估趋势阶段，并结合多周期变化、流动性、GMMA、EMA 框架、OI 扩张、EMA 拉伸和 BTC beta/correlation。它比强势突破更像趋势跟随框架。

优点：

- 支持 long 和 short。
- 使用运行态区分 start、active、resume、reversal，信号语义比单根条件更丰富。
- 引入基础流动性与参与度门槛，避免低流动性标的误触发。

风险：

- `betaFilter.enabled` 默认是 false，BTC 跟随关系在默认策略里更像加分项而非硬过滤。
- 对 `runtimeState.trend.evaluate` 的行为依赖较大，实时扫描和回测必须确保运行态初始化一致，否则结果难以复现。
- 当前实时扫描没有传入组合持仓状态，趋势策略无法在信号层感知已有仓位拥挤。

### 4.3 资金流入

资金流入策略要求 1h、4h、15m 价格增长，CVD 质量验证，Volume Profile 或价格 fallback 突破。它定位为资金推动型做多策略。

优点：

- 明确要求 CVD 数据，避免把被动拉升当主动买盘。
- Volume Profile 支持 VAH/POC 判断，也允许在缺失 VP 数据时使用价格 fallback。
- 风险模型独立走 `calculateInflowRisk`。

风险：

- `allowPriceOnlyFallback` 默认 true，且 `requireVolumeProfile` 默认 false；在 VP 数据缺失时策略仍可能用 24h 涨幅 fallback，通过率会受价格动量强烈影响。
- 只做多，且价格增长阈值较激进，容易在已过热阶段给出信号。
- CVD 来源和口径在信号卡里没有数据质量标识，用户无法判断是可靠主动买盘还是采样近似。

### 4.4 RSRS 量化增强

RSRS 策略使用 `rsrsFinal`、动态阈值、R2、ROC、Acceleration、多周期趋势分、成交量共振和布林带位置过滤。它支持 long/short。

优点：

- 使用动态阈值，比固定 Z-score 更适合不同市场状态。
- 有减速预警，极端信号出现衰减时可以降分或拒绝。
- 适合作为统计因子与趋势/量能策略形成共振。

风险：

- baseline 参数中 `r2Floor` 和 `rocFloor` 为 0，而候选参数里给了更高的 R2/ROC 阈值。这说明默认实时策略相对宽松，优化候选更严格，实时与研究口径可能不一致。
- 风控调用使用 `calculateRiskManagement('rsrs', ...)`，而策略 ID 是 `rsrs-trend`。当前 `riskConfig` 有 alias 处理，但这里仍属于命名不统一，后续扩展时容易误接。
- RSRS 指标本身对历史窗口和计算口径非常敏感，需要在 UI 或报告里暴露样本窗口和数据质量。

### 4.5 波动率挤压

波动率挤压策略要求 squeeze 背景、释放窗口、动能方向、价格突破压缩区、放量实体和 ADX/DI 趋势过滤。它适合捕捉低波动后的首段释放。

优点：

- 条件结构完整，覆盖压缩质量、释放时点、方向、结构、量能和趋势。
- 对 `ohlc.length < 6` 直接拒绝，避免在缺少 K 线结构时误判。
- 风控接入 Keltner、ADX、squeezeDuration 和 bandwidthPercentile，较贴合策略特征。

风险：

- `releaseBarsAgo` 和 `prevSqueezeStatus` 的实时计算必须稳定，否则会错过首段释放。
- 当前 `reason` 固定显示 `conditionsMet/6`，但代码已经要求全部条件满足；这更像结果确认，不利于解释失败原因。
- 该策略对 `ohlc`、bandwidth、momentumColor、ADX 等字段依赖多，建议配套数据缺失诊断。

### 4.6 魏神策略

魏神策略已经重构为 BTC 主导的规则化趋势框架，依赖 `strategyContexts.weiShen`，并通过 `selectWeiShenCandidate`、`buildWeiShenRiskManagement`、`buildWeiShenExplain` 生成结构化信号。

优点：

- 不再直接散读 ticker 顶层字段，而是消费专属上下文。
- 输出 `grade`、`executionMode`、`entryType` 和 `explain`，信号解释质量明显高于普通复合策略。
- 有默认交易宇宙限制，避免把策略套到不适配的全市场标的上。
- 风控包含止损价、失效价、建议风险和动态退出思路，更接近可执行计划。

风险：

- 目前实时扫描层额外过滤 `isWeiShenUniverseSymbol`，策略本体内部也过滤 universe，存在重复逻辑。
- `executionMode === 'observe'` 的信号会被主信号选择逻辑放到可交易信号之后。如果同一 symbol 同时有其他可交易策略，魏神观察信号会被隐藏。
- 魏神策略强依赖多周期历史上下文构建，实时链路与回测链路需要持续校验同一时点的上下文一致性。

### 4.7 情绪热点

情绪热点策略基于 `strategyContexts.sentimentHotspot`，检查多来源热度、广场/放量质量、成交额、OI、负资金费率和温和上涨，并额外在扫描器里有退出监控。

优点：

- 策略定位清晰：先选币，再等待结构确认。
- 结合热度来源、OI 和资金费率，比单纯涨幅榜更有研究价值。
- `applySentimentHotspotExitMonitor` 能在信号回落后继续提示风险预警或退出监控。

风险：

- 当前是新增策略痕迹，类型、参数和输入契约尚未完全接入。
- `executionMode` 固定为 `trade`，但 reason 写着“信号只负责选币”。这在 UI 上会与“可交易信号”的语义冲突。
- 没有独立风控对象，信号卡不会展示止损、止盈和仓位计划。

## 5. UI 与交互审查

### 5.1 策略库

策略库左侧展示所有策略，支持勾选启停。实现简单直接，订阅注册表变化后可以响应更新。

不足：

- 没有按 category 分组。
- 没有显示策略所需数据是否齐全。
- 没有显示每个策略最近扫描数量、触发率、冷却中数量或失败主因。
- 启停状态不持久化。

### 5.2 信号池

信号池展示总数、实时/快照/回落保留数量、多空数量，并支持全部清除。`SignalCard` 展示方向、置信度、状态、策略名、原因、复合条件、风控、叠加策略和时间。

这是当前策略专区最成熟的部分之一。尤其是 `snapshot` 和 `cooling` 的区分，对真实盯盘很重要。

不足：

- 信号卡信息密度很高，但没有筛选和排序控件，例如按策略、方向、等级、状态、symbol、置信度过滤。
- 条件列表只展示当前主信号，不能查看被共振合并的策略详情。
- 置信度可能因 comboBonus 超过 100，UI 没有说明。
- 情绪热点这类“选币信号”与可执行交易信号在视觉上没有足够区分。

## 6. 风控链路审查

策略信号支持 `risk?: RiskManagement`，多数交易型策略会调用 `calculateRiskManagement`。风险卡展示止损、止盈、盈亏比和建议仓位。

优点：

- 风控输出已经进入信号层，不是回测后才计算。
- 不同策略有不同风控模块：breakout、trend、inflow、rsrs、squeeze。
- 魏神策略有更专属的风险计划。

风险：

- 策略代码里仍多处使用 `APP_CONFIG.RISK.DEFAULT_ACCOUNT_BALANCE` 和 `DEFAULT_RISK_PER_TRADE`，TODO 表示尚未接入用户账户设置。
- 组合层面的风险约束主要存在于 `portfolioState` 类型和魏神逻辑里，实时扫描没有实际传入 portfolioState。
- 信号池只展示单信号风险，不展示全局风险占用、同向拥挤、同一板块聚集或日内回撤限制。

## 7. 回测与研究闭环审查

`BacktestPanel` 能选择策略、symbol 来源、时间范围、执行周期、风险配置、策略参数，并调用历史数据、preflight、数据质量、单币回测和组合回测相关逻辑。`BacktestEngine` 支持信号周期和执行周期拆分，能使用策略自带风险参数，且有滑点和手续费。

优点：

- 回测不是简单 close-to-close，而是有 execution interval 概念。
- `runWithMockedNow` 可以让策略在历史时间点生成 timestamp，减少 Date.now 对回测的污染。
- 多周期历史上下文通过 `historicalMultiTimeframe` 接入，尤其服务于强势突破、趋势结构和魏神策略。
- 有 preflight 和 validation planner，说明项目已经意识到历史数据覆盖不足会污染回测。

风险：

- 实时扫描与回测参数可能不一致。回测面板支持 `strategyParameterOverrides`，实时扫描没有接收这些覆盖。
- 新增 `sentiment-hotspot` 尚未接入参数类型和候选系统，回测/优化链路可能无法像其他策略一样工作。
- 单 symbol 实时信号合并逻辑和回测策略检测逻辑不完全等价，回测评估的是单策略，而实时信号池显示的是主信号加共振。
- 回测结果仍依赖本地/接口历史数据完整性。虽然有数据质量模块，但策略信号卡没有把同样的数据质量反馈前置到实时扫描。

## 8. 性能与稳定性审查

当前性能设计有几个正向点：

- 使用 digest 避免无变化重复扫描。
- 使用 1 秒节流降低扫描频率。
- 使用 `MAX_ACTIVE_SIGNALS` 限制信号数量。
- localStorage 持久化信号，页面恢复体验较好。

潜在风险：

- 每轮扫描对变动 symbol 遍历所有 enabled 策略，策略越来越多后会线性增加成本。
- `JSON.stringify` 大对象摘要可能成为热路径成本，尤其是 `strategyContexts` 扩大后。
- localStorage 保存完整信号，包括 conditions、risk、explain，信号数量较多时可能接近浏览器配额。
- 策略运行态是单例，长时间运行后的状态清理、内存增长和跨页面一致性需要继续观察。

## 9. 测试覆盖审查

仓库已经有不少策略相关测试：

- `strategyInputs.test.ts`
- `strategyParameters.test.ts`
- `strategyScannerSnapshot.test.ts`
- `strategyOptimizationBehavior.test.ts`
- `strategyOptimizationRunnerWeiShen.test.ts`
- `weiShenStrategy.test.ts`
- `weiShenEngineGate.test.ts`
- `weiShenUniverse.test.ts`
- `backtestEngineRiskSizing.test.ts`
- `portfolioBacktestEngine.test.ts`
- `historicalMultiTimeframe.test.ts`
- `sentimentHotspot.test.ts`

这说明策略专区不是无测试状态。测试重点覆盖了输入契约、参数、信号选择、魏神策略、回测风控和情绪热点核心逻辑。

仍建议补充：

- 策略注册表与 `StrategyId`、`STRATEGY_INPUT_CONTRACTS` 的一致性测试。
- `useStrategyScanner` 对 dismiss、cooling、snapshot、strategy toggle、comboBonus clamp 的 hook 级测试。
- 情绪热点接入参数系统后的类型和候选测试。
- 实时扫描与回测在同一历史样本上的信号一致性测试。

## 10. 主要问题清单

### P1：新增策略接入不完整

`sentiment-hotspot` 已注册并参与实时扫描，但尚未加入 `StrategyId`、`StrategyParameterConfigMap` 和 `STRATEGY_INPUT_CONTRACTS`。这会造成类型系统、参数面板、参数优化和输入契约测试与真实注册表不一致。

建议：为 `sentiment-hotspot` 补齐参数类型、baseline 参数、输入字段契约、候选参数或显式声明“不参与参数优化”。

### P1：实时信号与回测参数口径可能不一致

回测面板有 `strategyParameterOverrides`，实时扫描没有参数覆盖入口。用户在回测里调出的参数组合，不会自动影响策略专区实时信号。

建议：将策略参数状态提升到共享层，或在 UI 上明确“实时策略使用 baseline 参数，回测参数仅用于回测”。

### P2：每个 symbol 只保留一个主信号导致研究信息损失

当前信号池会把同一 symbol 的多策略结果合并为主信号，次级信号只保留策略名称。对盯盘是好事，对策略审查和复盘不够。

建议：主列表保持简洁，但卡片内提供“共振详情”，展示每个触发策略的方向、置信度、核心条件、风险对象和触发时间。

### P2：置信度加成可能超过 100

`selectScannerSignalForSymbol` 直接 `mainSignal.confidence + comboBonus`。如果主策略已经 95 或 100，共振后会超过 100。

建议：统一 clamp 到 100，或把原始置信度与共振加分分开展示，例如 `策略分 95，共振 +10，综合等级 A+`。

### P2：策略启停不持久化

用户关闭策略后刷新页面会恢复默认启用。

建议：将 enabledStrategyIds 写入 localStorage，并提供“恢复默认策略”操作。

### P2：dismiss 维度过粗

关闭信号按 symbol + timestamp 记录，未纳入 strategyId。当前主信号切换和多策略共振场景下，可能产生误伤或语义不清。

建议：dismiss key 使用 `symbol:strategyId:timestamp`，共振主信号另存 composite key。

### P3：数据质量没有进入实时策略解释

策略本体对缺失字段有不同处理：有些直接 return null，有些 fallback，有些默认通过。用户只看到“暂无信号”，看不到是无机会还是无数据。

建议：为每个策略输出 data readiness 诊断，例如“VP 缺失，使用价格 fallback”“RSRS 样本不足”“魏神上下文未生成”。

### P3：策略说明和 UI 元信息不足

策略库只显示名称和描述，没有展示适用周期、做多/做空、所需字段、风险模型、回测支持状态、是否可参数优化。

建议：扩展 `TradingStrategy` metadata，例如 `supportedDirections`、`requiredData`、`timeframes`、`riskModel`、`backtestSupported`、`optimizationSupported`。

## 11. 改进路线建议

### 第一阶段：一致性修复

1. 补齐 `sentiment-hotspot` 在策略 ID、参数系统、输入契约和测试中的注册。
2. 对 comboBonus 后的 confidence 做 clamp 或拆分展示。
3. 持久化策略启停状态。
4. 将 dismiss key 从 symbol 级改为 strategyId 级。

### 第二阶段：研究可解释性

1. 增加策略数据 readiness 面板。
2. 在信号卡里展开共振策略详情。
3. 为每个策略显示最近触发次数、冷却数量、失败最多的条件。
4. 统一所有策略的 `reason`、`conditions`、`risk` 和 `executionMode` 语义。

### 第三阶段：实时与回测统一

1. 让实时策略中心可以选择 baseline 参数或回测调参后的参数。
2. 建立“同一历史时间点实时扫描 vs 回测检测”的一致性测试。
3. 给策略参数加版本号，回测结果记录参数快照。
4. 将 portfolioState 接入实时扫描，用于全局风控和同向拥挤控制。

### 第四阶段：策略组合和风险控制

1. 建立组合层信号视图，区分选币、观察、可交易、退出预警。
2. 增加全局风险预算、板块聚集、同向敞口和日内回撤约束。
3. 对不同策略输出统一的风险对象，情绪热点至少给出观察止损线或失效条件。
4. 将模拟交易或纸面仓位状态反馈给策略专区。

## 12. 最终评价

策略专区当前的核心方向是对的：它不是把策略硬塞进 UI，而是已经形成了“行情增强数据 -> 策略输入契约 -> 策略检测 -> 信号生命周期 -> 风控计划 -> 回测验证”的主链路。

真正需要优先处理的不是再加更多策略，而是把现有策略体系的边界补齐：注册表、类型、输入契约、参数系统、实时扫描、回测和 UI 展示必须对同一组策略有一致认识。完成这些之后，策略专区会更像一个可靠的研究工作台，而不是一组正在并行生长的信号模块。
