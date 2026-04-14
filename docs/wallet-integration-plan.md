# 钱包整合方案

更新时间：2026-04-13

## 总目标

在现有“币安链上雷达”基础上，增加一个长期可扩展的钱包能力层，分 3 个阶段推进：

1. 先做 `钱包观察`
2. 再做 `钱包连接`
3. 最后做 `交易与地址行为联动`

## 选型结论

### P0：OKX Wallet

定位：

- 第一优先级
- 最适合做多链钱包连接、资产读取、交易能力扩展

原因：

- OKX Onchain OS 提供 Wallet API / Trade API / 钱包连接能力
- 比单一注入钱包更接近“平台能力”
- 更适合当前项目继续往“链上雷达 + 钱包观察 + 后续交易”延伸

### P1：MetaMask

定位：

- 通用 EVM 基础层
- 作为标准钱包连接方案

### P1：Phantom

定位：

- Solana 钱包重点集成
- 适合热点币、链上 Meme 方向

### P2：Rabby / Coinbase Wallet

定位：

- Rabby：借鉴风险提示与多链交互
- Coinbase Wallet：偏国际化和标准化补充

## 三阶段执行

### Phase 1：钱包观察

目标：

- 支持添加观察地址
- 记录标签、链、钱包来源、备注
- 沉淀长期盯盘对象

当前仓库已落地：

- `src/lib/wallet/`
- `src/hooks/useWalletObservation.ts`
- `币安链上雷达` 内的钱包观察区

### Phase 2：钱包连接

目标：

- 接入 OKX Wallet
- 预留 MetaMask / Phantom 连接入口
- 支持读取当前连接地址
- 允许“一键加入观察名单”

实施建议：

- `src/lib/wallet/providers/okx.ts`
- `src/lib/wallet/providers/metamask.ts`
- `src/lib/wallet/providers/phantom.ts`
- `src/hooks/useWalletConnector.ts`

### Phase 3：资产与行为联动

目标：

- 展示地址资产分布
- 展示最近交易/交互
- 将观察地址与链上雷达联动
- 后续接 Swap 或 Trade API

## 推荐开发顺序

1. 先接 OKX Wallet Connect
2. 再做“当前钱包地址 -> 一键加入观察名单”
3. 再读钱包资产和交易历史
4. 最后把钱包地址与币种观察联动

## 项目内建议模块

- `WalletObserver`
  - 观察地址管理
- `WalletConnector`
  - 连接和切换钱包
- `WalletPortfolio`
  - 钱包资产分布
- `WalletActivity`
  - 最近行为

## 当前状态

已完成：

- 钱包整合方案文档
- Provider 优先级规划
- 观察名单数据结构与本地持久化
- UI 入口已接入链上雷达

下一步建议直接做：

- OKX Wallet 连接入口
- 从当前连接地址快速加入观察名单
