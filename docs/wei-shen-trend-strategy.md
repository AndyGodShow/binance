# 魏神策略重构说明

## 定位

`wei-shen-ledger` 已从旧版“账本时段 + 打分偏置”改成 BTC 主导的规则化趋势框架。它不是“凑几个指标就下单”的策略，而是把母体里的 4 个核心观念工程化：

- 先判断 BTC 是否允许开风险。
- 只做顺势，不做逆势猜底猜顶。
- 入场宁可少，也要集中在趋势延续和关键突破。
- 仓位、回撤、连亏处理优先于信号频率。

交易宇宙固定白名单：

- `BTCUSDT`
- `ETHUSDT`
- `SOLUSDT`
- `XRPUSDT`
- `DOGEUSDT`

## 架构

策略分成 5 层：

1. `Market Regime Filter`
   BTC `4h EMA20 > EMA60 > EMA120` 且价格站上 `4h EMA20`，同时 `1d EMA20` 斜率满足方向要求，才开放对应方向。
2. `Relative Strength Filter`
   非 BTC 标的必须相对 BTC 不弱，且满足 24h 成交额门槛。
3. `Entry Logic`
   只保留 `breakout` 与 `pullback` 两类入场。
4. `Exit Logic`
   初始止损 + 1R 保本 + 2R 部分止盈 + 剩余趋势跟踪 + 时间止损。
5. `Risk Engine`
   A/B/C 分级、单笔风险预算、相关币打折、连亏 cooldown、日内停手。

## 默认参数

### 周期

- 信号周期：`1h`
- 执行周期：`15m`
- 趋势确认：`4h`
- 大级别过滤：`1d`

### BTC 市场总开关

- `EMA`: `20 / 60 / 120`
- `dailyEMA`: `20`
- `dailySlopeLookback`: `3`
- `dailySlopeMinPct`: `0.15`
- `rangeAdxMax`: `18`
- `rangeCompressionPct`: `1.8`
- `shock24hPct`: `8.5`
- `weakCloseLocationMax`: `0.45`

### 相对强弱

- `rsWindow1h`: `8`
- `rsWindow4h`: `6`
- `relativeVolumeMa`: `20`
- `minVolume24hUsd`
  BTC `5B` / ETH `2B` / SOL `0.8B` / XRP `0.6B` / DOGE `0.9B`
- `excessReturn4hMin`
  BTC `0` / ETH `0.3` / SOL `0.5` / XRP `0.8` / DOGE `1.2`

### 入场

- `atrPeriod`: `14`
- `atrExpansionMin`: `1.05`
- `donchianLookback`
  BTC `20` / ETH `24` / SOL `20` / XRP `30` / DOGE `36`
- `overheatThresholdPct`
  BTC `3.0` / ETH `2.8` / SOL `3.5` / XRP `1.8` / DOGE `1.6`
- `breakoutVolumeRatioMin`
  BTC `1.15` / ETH `1.20` / SOL `1.35` / XRP `1.55` / DOGE `1.80`
- `pullbackEmaPeriods`: `EMA20 / EMA30`
- `trendLegLookback`: `8`
- `pullbackVolumeCompressionMax`: `0.85`
- `reclaimConfirmBars`: `1`

### 风控

- `baseRiskPct`
  A `0.75%` / B `0.50%` / C `0%`
- `symbolRiskMultiplier`
  BTC `1.0` / ETH `0.9` / SOL `0.75` / XRP `0.55` / DOGE `0.40`
- `maxConcurrentPositions`: `3`
- `coreClusterRiskCap`: `1.25`
- `specClusterRiskCap`: `0.60`
- `btcLeadAltRiskMultiplier`: `0.7`
- `maxConsecutiveLossesBeforeCooldown`: `3`
- `cooldownBars`: `24`
- `maxDailyDrawdownPct`: `1.8`
- `moveStopToEntryAtR`: `1`
- `partialTakeProfitAtR`: `2`
- `partialTakeProfitClosePct`: `50`
- `breakoutTimeStopBars`: `72`
- `pullbackTimeStopBars`: `96`

## 五个币的差异

- BTC：最宽容，允许 breakout / pullback，作为核心方向锚。
- ETH：和 BTC 同框架，但量比和超额收益略严格。
- SOL：允许更高波动，但仓位更轻，结构失效更严格。
- XRP：只偏向高质量突破，回踩默认只保留最完整的 A 级。
- DOGE：默认只接受最强动量突破，回踩只展示观察信号。

## 与其他策略的区别

### 对比 `strong-breakout`

- `strong-breakout` 更像单币强势突破筛选。
- `wei-shen` 先看 BTC 是否允许冒险，再看单币是否相对 BTC 不弱。

### 对比 `trend-confirmation`

- `trend-confirmation` 更偏趋势状态确认。
- `wei-shen` 把市场总开关、信号分级、出场三段式和组合风险约束绑在一起。

### 对比 `capital-inflow / rsrs-trend / volatility-squeeze`

- 这些策略更强调局部结构、量能、统计因子或压缩释放。
- `wei-shen` 强调“少出手、顺 BTC、重仓位与回撤处理”的交易框架。

## 哪些规则在提胜率

- BTC 市场总开关
- 相对 BTC 强弱过滤
- 突破必须放量
- 回踩必须缩量后反包确认
- XRP / DOGE 更严格阈值

## 哪些规则在压回撤

- 只做顺势
- 震荡期只放行 A 级
- 过热过滤
- 初始止损 + 1R 保本 + 2R 部分止盈
- 时间止损
- 相关币同时触发时打折
- 连亏 cooldown
- 单日回撤停手

## 为什么更接近魏神母体风格

- 核心不是“预测下一根涨跌”，而是先等 BTC 给方向许可。
- 核心不是“命中率最大化”，而是让仓位和回撤管理先于主观判断。
- 核心不是“看到异动就追”，而是只在趋势延续和结构完整时出手。
- 核心不是“固定止盈就走”，而是先锁风险，再让趋势尾段贡献利润。

## 后续可优化方向

1. 把 `EMA20/EMA60/EMA120` 过滤做成可按币种切换的 regime profile。
2. 给 `pullback` 增加更细的结构分型日志，区分前高回踩与均线回踩。
3. 在组合回测里把当前的 proxy risk 进一步升级为真实风险预算跟踪。
4. 给 explain 增加回测导出字段，便于直接做信号样本审计。
5. 为 BTC / ETH / SOL / XRP / DOGE 分别补更多真实历史场景测试样本。

