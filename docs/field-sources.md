# 关键字段来源说明

本文件用于说明主研究链路中关键字段的来源，帮助后续重构时判断：

- 哪些字段属于基础行情真源
- 哪些字段属于实时增强结果
- 哪些字段在回测中需要重建
- 哪些字段只对特定策略有效

## 1. `TickerData` 字段分层

### 1.1 基础行情字段

主要来自：

- `src/app/api/market/light/route.ts`
- `src/app/api/market/route.ts` 中的 `fetchBaseMarketData()`

代表字段：

- `symbol`
- `lastPrice`
- `priceChange`
- `priceChangePercent`
- `weightedAvgPrice`
- `prevClosePrice`
- `highPrice`
- `lowPrice`
- `volume`
- `quoteVolume`
- `openTime`
- `closeTime`
- `markPrice`
- `fundingRate`

这些字段是实时页面和扫描链路的基础输入。若变更来源或默认值，会影响整个系统。

### 1.2 实时市场增强字段

主要来自：

- `src/app/api/market/route.ts`
- `src/lib/indicatorEnhancer.ts`
- `src/lib/openInterest.ts`
- `src/lib/historicalTracker.ts`

代表字段：

- `openInterest`
- `openInterestValue`
- `oiChangePercent`
- `volumeChangePercent`
- `fundingRateVelocity`
- `fundingRateTrend`
- `atr`
- `volumeMA`
- `volumeRatio`
- `cvd`
- `cvdSlope`
- `vah`
- `val`
- `poc`
- `squeezeStatus`
- `releaseBarsAgo`
- `keltnerUpper`
- `keltnerMid`
- `keltnerLower`
- `momentumValue`
- `momentumColor`
- `adx`
- `plusDI`
- `minusDI`
- `bandwidthPercentile`
- `ohlc`

这些字段是实时扫描的重要输入，但不一定天然存在于历史数据里。

### 1.3 延迟补齐字段

主要来自：

- `src/app/api/market/multiframe/route.ts`
- `src/app/api/rsrs/route.ts`
- `src/app/page.tsx` 中的 deferred merge

代表字段：

- `change15m`
- `change1h`
- `change4h`
- `rsrs`
- `rsrsZScore`
- `rsrsFinal`
- `rsrsR2`
- `rsrsDynamicLongThreshold`
- `rsrsDynamicShortThreshold`
- `rsrsROC`
- `rsrsAcceleration`
- `rsrsAdaptiveWindow`
- `rsrsMethod`
- `bollingerUpper`
- `bollingerMid`
- `bollingerLower`

这部分字段在页面首屏不是必须同步就绪，因此会延迟补齐。

### 1.4 趋势结构字段

主要来自：

- `src/lib/indicatorEnhancer.ts`
- `src/lib/historicalMultiTimeframe.ts`

代表字段：

- `ema5m20`
- `ema5m60`
- `ema5m100`
- `ema5mDistancePercent`
- `gmmaTrend`
- `gmmaShortScore`
- `gmmaLongScore`
- `gmmaSeparationPercent`
- `multiEmaTrend`
- `multiEmaAlignmentScore`
- `breakout21dHigh`
- `breakout21dPercent`

这些字段同时影响实时扫描和历史回测，是当前最需要保持口径一致的一组。

### 1.5 策略专属上下文字段

主要来自：

- `src/lib/weiShenEngine.ts`
- `src/app/api/market/route.ts`
- `src/lib/historicalMultiTimeframe.ts`

代表字段：

- `strategyContexts`
- `strategyContexts.weiShen`

这类字段不是所有策略都需要。当前仅魏神策略会直接消费。

## 2. 回测中的字段重建

回测主链不会直接依赖实时 `/api/market` 返回值，而是通过：

- `src/lib/historicalDataFetcher.ts`
- `src/app/api/backtest/klines/route.ts`
- `src/lib/historicalMultiTimeframe.ts`
- `src/lib/technicalIndicators.ts`

来重建历史版输入。

重点说明：

- `openInterest` / `fundingRate` 在历史链中来自 `/api/backtest/klines`
- `change15m` / `change1h` / `change4h` 和趋势结构字段由 `historicalMultiTimeframe` 重建
- 回测中的 RSRS 当前由 `technicalIndicators` 重新计算，不直接复用实时 `/api/rsrs`

## 3. 当前最需要谨慎维护的一致性点

### 3.1 实时与回测双实现

当前存在重复实现的重点区域：

- RSRS
- 多周期变化
- 趋势结构字段

这些区域如需统一真源，必须先做结果对账。

### 3.2 不要把“看起来没用”的字段当成死字段

以下字段虽然不是所有页面都显示，但会参与研究逻辑：

- `openInterestValue`
- `change15m` / `change1h` / `change4h`
- `ema5mDistancePercent`
- `breakout21dPercent`
- `strategyContexts`

删除前必须确认：

- 实时扫描是否使用
- 回测重建是否使用
- 参数优化是否隐式依赖

## 4. 后续重构建议

如果后续要继续治理，建议优先做：

1. 给每个策略建立最小输入 contract
2. 给实时增强字段和历史重建字段建立明确映射表
3. 统一 RSRS 与多周期结构的核心计算入口
