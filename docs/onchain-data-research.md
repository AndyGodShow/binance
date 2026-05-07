# 链上筹码结构观察台说明

更新时间：2026-05-07

## 当前定位

`OnchainTracker` 当前定位是“链上筹码结构观察台”，不是控筹结论工具，也不输出交易建议。

它的职责是把链上 token 身份、Top holders、地址分类、供应口径和数据可信度放在同一个观察台里，帮助研究者判断这组链上读数是否值得进一步人工复核。

## 当前不会输出什么

- 不输出控筹指数。
- 不输出高度/中度/低度控筹等级。
- 不输出一句话交易判断。
- 不用 Top10 高推导控盘。
- 不用 holder 增长推导利好。
- 不用 DEX 买卖笔数推导吸筹或出货。
- 不把 DEX Screener fallback 地址当成官方合约。
- 不把 FDV 当作 marketCap。
- 不把 raw TopN 当作 float TopN。

## 数据链路

当前链路：

```text
src/components/OnchainTracker.tsx
-> src/app/api/onchain/dashboard/route.ts
-> src/lib/onchain/service.ts
-> identity / addressClassifier / supplyNormalizer / analysis
-> Binance Alpha / Binance futures universe / DEX Screener / Moralis
```

主要字段来源：

- `identity`：由 `TokenIdentityResolver` 统一输出，来源可能是 Binance Alpha、DEX Screener、futures symbol 或 unknown。
- `eligibility`：由 `buildTokenEligibility` 根据身份、holder 数据、地址分类、供应口径和风险标记统一裁决。
- `topHolders`：来自 Moralis owners 或 Solana holder 明细。
- `holderConcentration`：由 `AddressClassifier` 分类后计算原始集中度和净化后集中度。
- `supplyBreakdown`：由 `SupplyNormalizer` 基于 Top holders balance/percentage 和地址分类估算供应口径。
- `analysis`：只有 `eligibility.level === "analysis_allowed"` 时才存在。

## 可信度边界

当前系统只能证明“这组数据是否可作为链上结构观察材料”，不能证明真实控制关系。

原因包括：

- Top holders 标签可能缺失或错误。
- CEX、LP、bridge、staking、vesting、treasury 地址可能未被完整识别。
- marketCap、FDV、total supply、circulating supply 的口径可能来自不同 provider。
- `totalSupply` 当前主要由 Top holders 的 `balance / percentage` 反推，属于估算。
- `circulatingSupply` 暂无独立可靠来源时保持为空。
- Solana supply 和标签质量在当前阶段不可完全验证。
- 多链 token、wrapped asset、bridge token 和迁移旧合约不能用单一 holder 结构代表整体筹码结构。

## Eligibility Gate

### `blocked`

禁止生成链上结构观察，且 `analysis` 为空、`floatTop1/5/10` 为空。

典型触发：

- 地址无法确认。
- 原生资产、稳定币、wrapped asset、bridge token。
- Top holders percentage 数学异常。
- TopN 或 holderSupply 越界。
- 全部 Top holders 都无法分类。
- holder percentage 无法计算。
- `estimatedFloatSupply <= 0`。
- `estimatedFloatSupply > totalSupply`。
- total supply 与 holder 百分比分母严重冲突。

### `raw_only`

只展示身份、原始 holder、地址分类、供应口径和风险提示，不生成净化后观察。

典型触发：

- 地址来自 fallback 或 unverified。
- Binance futures 只能证明交易标的存在，不能证明链上地址。
- Binance Alpha/DEX/Moralis 口径不一致。
- holder 数据不完整。
- unknown holder 占比过高。
- LP/CEX/burn/contract/treasury/vesting/staking/bridge 污染明显。
- `SupplyBreakdown.confidence = low`。
- marketCap 缺失但 FDV 存在。
- `circulatingSupply` 缺失。
- Solana 标签不足或 supply 不可独立验证。

### `analysis_allowed`

允许展示“链上筹码结构观察”，但仍然只是结构观察，不是控制关系结论。

必须同时满足：

- 地址身份可信。
- mappingStatus 为 confirmed。
- holder 数据质量高。
- Top holders 至少部分可分类。
- supply 分母可信。
- `estimatedFloatSupply` 可解释。
- 没有会导致误判的风险标记。

## 出口控制

当前出口控制集中在 `src/lib/onchain/service.ts`：

- `analysis` 只在 `eligibility.level === "analysis_allowed"` 时生成。
- `applyEligibilityToHolderConcentration` 会在 `blocked` 或 `raw_only` 时清空 `floatTop1/5/10`。
- `supplyBreakdown` 始终可展示，但只能作为供应口径审计材料；低可信时不会驱动净化后观察。
- 前端只展示中性模块：身份可信度、数据可信度、供应口径、原始 Holder 集中度、地址分类、剔除列表。

## 已知限制

- 还没有独立 token supply provider interface。
- 还没有官方地址白名单或项目公告校验层。
- 还没有可靠的 CEX/MM/treasury/vesting 地址库。
- 还没有 LP token lock、honeypot、tax/freeze/rebase 的独立检测。
- 还没有多池价格冲突和多链 canonical contract 的完整归一化。
- 还没有链上历史快照存储，当前更多是请求时观察。
- 还没有把 provider 限流、缓存和异步预计算完全抽象出来。

## 后续方向

下一阶段应继续沿着“可信度优先”的方向做基础设施，而不是恢复单一评分：

- Provider interface：统一 Binance Alpha、DEX Screener、Moralis、future metadata 的数据契约。
- Address registry：沉淀 CEX、LP、burn、router、bridge、treasury、vesting、staking、MM 地址标签。
- Supply provider：接入可靠 total/circulating/burned/locked supply 来源。
- Candidate audit：记录多候选、多链、同名 token、wrapped/bridge/fake token 的选择过程。
- Snapshot storage：保存身份、holder、supply 和 eligibility 的时间序列，供人工研究复盘。
