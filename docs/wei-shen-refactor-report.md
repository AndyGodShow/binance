# 魏神策略重构实施报告

## 1. 项目背景

本次改造的目标，不是继续在旧版“魏神策略”上追加零散条件，而是把它从原先偏账本时段/多因子打分的实现，重构为一套更接近母体风格的、可执行、可解释、可回测的 BTC 主导趋势框架。

母体风格的核心不是高频择时，也不是单指标预测，而是：

- 先看 BTC 是否允许开启风险。
- 只做顺势，不做逆势抄底猜顶。
- 追求更少但更高质量的信号。
- 把仓位、回撤、连续亏损处理放在优先级更高的位置。

## 2. 本次实施的核心结论

本次已经完成以下重构：

1. 保留原策略 ID `wei-shen-ledger`，避免破坏现有策略中心、回测入口和参数系统。
2. 用新的规则化趋势引擎彻底替换旧的账本时段打分逻辑。
3. 固定交易宇宙为 `BTC / ETH / SOL / XRP / DOGE` 五个标的。
4. 建立 BTC 总开关、相对强弱、双入场、三段式出场、组合级风控的完整分层。
5. 将参数统一抽离到配置层，支持后续继续做参数化和优化。
6. 打通实时扫描、历史回测、组合回测、信号展示和 explain 日志链路。
7. 增补了针对 wei-shen 的行为测试、历史上下文测试、仓位 sizing 测试和组合风控测试。

## 3. 主要改动内容

### 3.1 策略本体重写

旧版 `src/strategies/weiShen.ts` 的核心是“时段偏置 + 条件打分”。这与本次要求的 BTC 主导、顺势、节奏和风控优先框架不一致，因此本次已整体替换。

新实现分为两层：

- 适配层：`src/strategies/weiShen.ts`
- 纯逻辑引擎：`src/lib/weiShenEngine.ts`

其中新引擎负责：

- 白名单过滤
- BTC 市场状态判断
- 相对强弱过滤
- `breakout / pullback` 两类入场
- A / B / C 分级
- `trade / observe` 执行模式
- 风险预算建议
- 组合级限制计算

### 3.2 新增策略上下文体系

为了让策略能在实时和回测中使用同一套判断基础，本次扩展了策略检测接口和信号结构。

新增能力包括：

- `detect(ticker, context?)`
- `ticker.strategyContexts?.weiShen`
- `StrategySignal.grade`
- `StrategySignal.executionMode`
- `StrategySignal.entryType`
- `StrategySignal.explain`

这使 wei-shen 不再依赖散落在 ticker 顶层的临时字段，而是使用专门的策略上下文。

### 3.3 BTC 主导的市场总开关

新增了明确的 BTC 市场过滤规则：

- `4h EMA20 > EMA60 > EMA120` 且价格站上 `4h EMA20` 时，开放顺势做多
- 空头逻辑做镜像处理
- `1d EMA20` 斜率不足则不放行
- BTC 高振幅弱收盘时直接进入 `risk-off`
- BTC 进入压缩震荡时只允许 A 级信号

这一步的作用，是把“什么时候允许承担风险”从模糊经验变成硬规则。

### 3.4 相对强弱过滤

非 BTC 标的新增了强制相对强弱过滤：

- 过去 `N` 根 K 的 `alt / BTC` 比值不能明显走弱
- 过去 `4h` 维度必须有超额收益
- 24h 成交额必须达到币种对应门槛

同时做了币种差异化：

- BTC 最宽松
- ETH 次核心
- SOL 允许波动更高但风控更紧
- XRP 只偏向高质量突破
- DOGE 只偏向最强动量突破

### 3.5 入场逻辑统一收敛为两类

本次没有继续堆指标，而是把入场模块严格限制为两类：

1. 趋势突破
2. 强势回踩

并且做了以下约束：

- 只做顺势
- 不允许“第一次反弹就抄底”
- DOGE 默认禁用回踩交易
- XRP 回踩必须极高质量，否则只给观察级

### 3.6 出场与风险规则工程化

出场不再是“有信号就进，出了事再说”，而是明确分为三段：

- 初始止损：基于 swing 结构位和 ATR
- 保护性止盈：达到 `1R` 保本，达到 `2R` 先止盈 `50%`
- 趋势跟踪：剩余仓位继续持有，配合时间止损退出

风险方面补齐了以下硬规则：

- A / B / C 级别对应不同风险预算
- C 级只展示，不成交
- 同时持仓上限
- 核心币簇风险上限
- BTC 持仓时 ETH/SOL 风险自动打折
- 连续亏损后 cooldown
- 单日最大回撤后停止开新仓

## 4. 系统级接线改造

本次不是只改一个策略文件，而是把整条链路都接通了。

### 4.1 实时扫描链路

在 `src/app/api/market/route.ts` 中，新增了 wei-shen 需要的 `1h / 4h / 1d` 多周期上下文构建，但只对 5 个白名单标的执行，避免把计算压力扩散到全市场。

### 4.2 历史回测链路

在 `src/lib/historicalMultiTimeframe.ts` 中，为 `wei-shen-ledger` 单独补了：

- 当前标的 `1h / 4h / 1d`
- `BTCUSDT` 的 `1h / 4h / 1d`
- 历史样本点上的 `strategyContexts.weiShen`

这保证回测里的 BTC 市场状态判断与实时扫描逻辑一致。

### 4.3 扫描器、回测器、优化器

以下入口已全部适配新结构：

- `src/hooks/useStrategyScanner.ts`
- `src/components/BacktestPanel.tsx`
- `src/lib/strategyOptimizationRunner.ts`

主要变化：

- 统一传入 `context`
- `observe` 信号不参与成交
- A / B 级信号才进入真实回测成交链路

### 4.4 UI 展示与 explain

`src/components/SignalCard.tsx` 已新增展示：

- 信号等级
- 入场类型
- “观察，不交易”标识
- 市场状态
- 建议风险
- 止损价
- 失效价

这样信号不再只是“有/没有”，而是能看出为什么触发、为什么不下单、风险应该多大。

## 5. 测试与验证

本次补充或更新了以下测试：

- `src/lib/strategyOptimizationBehavior.test.ts`
- `src/lib/historicalMultiTimeframe.test.ts`
- `src/lib/backtestEngineRiskSizing.test.ts`
- `src/lib/portfolioBacktestEngine.test.ts`

覆盖重点包括：

- 白名单限制
- BTC `risk-off` 时禁止开仓
- BTC A 级 breakout 可交易
- DOGE pullback 降级为 C 级观察
- 回测上下文能拿到 BTC 多周期数据
- 单币回测尊重策略风险仓位
- 组合回测触发核心簇上限、连亏 cooldown、日内停手

### 实际执行的验证命令

已执行并通过：

```bash
node --experimental-specifier-resolution=node --test src/lib/strategyOptimizationBehavior.test.ts src/lib/historicalMultiTimeframe.test.ts src/lib/backtestEngineRiskSizing.test.ts src/lib/portfolioBacktestEngine.test.ts
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

未执行：

```bash
npm run verify:backtest
```

原因：

- 该命令依赖本地 dev server 正在运行。
- 本次没有额外启动一个持续运行的本地服务进程去做接口抽样验证。

## 6. 与现有策略的差异

### 相比 `strong-breakout`

- `strong-breakout` 更偏单币突破筛选
- `wei-shen` 强制先经过 BTC 风险环境过滤

### 相比 `trend-confirmation`

- `trend-confirmation` 更像趋势状态确认器
- `wei-shen` 是完整交易框架，包含入场、出场、分级、仓位和组合风险

### 相比其他模块型策略

- `capital-inflow / rsrs-trend / volatility-squeeze` 更强调局部因子
- `wei-shen` 更强调 BTC 主导、趋势延续、节奏控制和风险预算

## 7. 这次设计为什么更接近母体风格

更接近母体风格的关键不在于“像不像原始话术”，而在于是否保留了原策略真正有辨识度的交易哲学：

- 不是全市场任何时候都能开仓
- 不是看到异动就追
- 不是把 XRP / DOGE 跟 BTC 同权处理
- 不是只给入场、不管出场
- 不是只追求信号数量

本次重构后，策略的主导逻辑已经从“模糊的打分拼接”转为“BTC 总开关 + 顺势入场 + 分级风险 + 回撤约束”，这更符合母体风格的本质。

## 8. 当前边界与后续建议

本次已经把主体框架落地，但仍有 4 个后续优化方向值得继续推进：

1. 把组合回测中的风险估算从当前 proxy risk 进一步提升为真实风险预算跟踪。
2. 为五个币分别补更多真实历史场景样本，尤其是 XRP / DOGE 的极端行情。
3. 对 pullback 结构做更细粒度分类，例如前高回踩、EMA 回踩、平台内回踩。
4. 增加可导出的 explain 数据，用于专门做信号审计和回撤分析。

## 9. 交付物清单

本次已交付：

- 新版魏神策略代码
- 默认参数配置
- explain 信号输出
- 实时与回测上下文接入
- 组合回测风控约束
- 相关测试
- 策略说明文档
- 本实施报告

