# Changelog

## 2026-05-07 - OnchainTracker trust gate refactor

### Phase 1: 止血

- 移除 `chipScore`、`controlLevel`、一句话判断和权威化结论入口。
- 将模块定位降级为原始 Holder 集中度快照、链上筹码结构观察、数据可信度评估。
- 新增 `eligibility`，低可信、地址未确认或数据异常时隐藏分析区。

### Phase 2: TokenIdentityResolver

- 抽出 token 身份解析逻辑，统一输出 `identityResolution` 与 `identity`。
- 区分 Binance Alpha、Binance futures symbol、DEX Screener candidate、fuzzy fallback。
- futures symbol 只作为交易标的存在证据，不再证明链上合约地址。

### Phase 3: AddressClassifier

- 新增 Top holders 地址分类，识别 burn、LP/pool、CEX、treasury、vesting、staking、bridge、router、contract、market maker、unknown。
- 新增原始集中度、疑似非流通/基础设施地址、未知地址占比和净化后集中度。
- unknown 或 excluded 占比过高时降级到 `raw_only`。

### Phase 4: SupplyNormalizer

- 新增供应口径审计，区分 `marketCap`、`fdv`、估算 `totalSupply`、`estimatedFloatSupply`。
- 不再把 FDV 当作 marketCap。
- 低供应可信度或异常供应口径时隐藏净化后 TopN。
- 新增供应口径 UI：total、circulating、estimated float、burned、infrastructure、CEX、unknown、confidence。

### Phase 5: E2E gate regression

- 新增离线 fixtures 与端到端 gate 回归测试。
- 覆盖 Alpha 官方地址、futures 无链上地址、1000 前缀合约、同名币、多链 token、wrapped/stable/native、Solana 无标签、Top holders 越界、FDV fallback、LP/CEX/burn 污染、unknown 过高、estimatedFloatSupply <= 0、DEX pair address mismatch。
- 修复 `raw_only` / `blocked` 仍可能暴露 `floatTop1/5/10` 的出口问题。

### Final positioning

- 当前模块正式定位为“链上筹码结构观察台”。
- 模块输出的是可信度分层后的链上结构观察，不是控制关系结论，也不是交易建议。
