# 链上追踪数据源调研

更新时间：2026-04-13

## 目标

为“链上追踪”板块建立一个分层的数据获取体系，优先满足：

- 查询单币控筹情况
- 查看 holder 分布与筹码集中度
- 识别交易所净流入/净流出
- 接入聪明钱与地址标签
- 为后续榜单、预警、策略联动提供扩展空间

## 数据源分层结论

### 1. 基础 holder / Top holders / 地址分布

优先候选：

- Etherscan
  - 官方文档：<https://docs.etherscan.io/>
  - 用途：EVM 的 holder count、holder list、top holders、基础 name tag
  - 适合：Ethereum / BSC / Base / Arbitrum / Optimism / Polygon
  - 优点：接入门槛低，适合 MVP
  - 限制：更偏基础链上浏览器能力，标签和资金流解释层较弱

- Birdeye
  - 官方文档：<https://docs.birdeye.so/>
  - 用途：热点币 overview、holder distribution、多链 token 数据
  - 适合：Solana 以及热点 token 画像
  - 优点：更适合 Meme 币和链上热点追踪
  - 限制：更偏 token 画像，不是强标签平台

- Moralis / Chainbase / Helius
  - Moralis：<https://docs.moralis.com/>
  - Chainbase：<https://docs.chainbase.com/>
  - Helius：<https://www.helius.dev/docs>
  - 用途：补足多链 holder 明细、Solana 原生账户与转账
  - 定位：作为统一 provider 层的候补或增强源

### 2. 标签体系 / 聪明钱 / 交易所行为

优先候选：

- Nansen
  - 官方文档：<https://docs.nansen.ai/>
  - 用途：地址标签、聪明钱、交易所/基金行为、资金流解释
  - 优点：如果你想让“链上追踪”有交易决策价值，Nansen 是最强增强层
  - 限制：门槛和成本较高

### 3. 宏观链上流量 / 历史分布 / 自定义研究

优先候选：

- Glassnode
  - 官方文档：<https://docs.glassnode.com/>
  - 用途：主流币宏观链上指标、交易所净流量、历史分布
  - 优点：适合 BTC / ETH 这类大币的中观和宏观分析
  - 限制：不适合作为长尾 token 的唯一来源

- Dune
  - 官方文档：<https://docs.dune.com/api-reference/api-overview>
  - 用途：自定义 SQL 查询、榜单、预警、历史快照沉淀
  - 优点：最灵活，适合后续策略联动和内部指标
  - 限制：不是即插即用型产品 API，需要自己建设 query 资产

## 推荐接入策略

### Phase 1：先做“控筹面板”

推荐组合：

- Etherscan：EVM holder 数据
- Birdeye：Solana / 热点 token 分布

目标：

- Top10 / Top50 / Top100 持仓占比
- 持币地址数与 7d 变化
- 交易所占比 / 巨鲸占比
- 控筹指数和风险标签

### Phase 2：把“解释层”做出来

推荐组合：

- Nansen：标签、聪明钱、交易所行为
- Glassnode：宏观净流量

目标：

- 聪明钱净流入
- 转所压力
- 交易所净流入/净流出
- 风险标签自动化

### Phase 3：做成策略底座

推荐组合：

- Dune：历史分布、自定义榜单、预警 SQL

目标：

- 链上异常榜
- 持续控筹榜
- 大额派发预警
- 链上因子接入策略中心

## 当前仓库落地情况

已新增基础骨架：

- `src/lib/onchain/`
  - provider registry
  - provider-neutral types
  - concentration analysis
  - mock bootstrap data
- `src/app/api/onchain/dashboard/route.ts`
  - 输出链上板块初始化 payload
- `src/components/OnchainTracker.tsx`
  - 新一级板块“链上追踪”

## 建议的真实环境变量

- `ETHERSCAN_API_KEY`
- `BIRDEYE_API_KEY`
- `NANSEN_API_KEY`
- `GLASSNODE_API_KEY`
- `DUNE_API_KEY`
- `HELIUS_API_KEY`
- `CHAINBASE_API_KEY`
- `MORALIS_API_KEY`
