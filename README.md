# Binance U 本位合约数据面板

一个面向行情观察、策略研究和回测验证的加密货币数据分析面板。

项目聚合 Binance U 本位合约行情、多周期指标、策略信号、历史数据、回测结果和模拟交易视角，目标是在一个界面内辅助完成：

- 发现市场机会
- 跟踪关键行情变化
- 扫描策略信号
- 验证历史表现
- 管理模拟交易与风险

> 本项目用于行情研究、策略辅助和模拟验证，不构成投资建议。

## 核心能力

- **市场监控**：查看合约行情、成交量、持仓量、资金费率和多周期涨跌幅。
- **指标分析**：支持多种技术指标与市场状态观察。
- **策略扫描**：基于预设策略识别潜在交易信号。
- **提醒系统**：支持信号提醒、定时提醒和自选列表追踪。
- **历史数据与回测**：支持历史 K 线获取、策略回测和结果可视化。
- **模拟交易与风控**：辅助进行模拟交易记录、仓位观察和风险管理。

## 技术栈

- Next.js
- React
- TypeScript
- SWR
- Recharts

## 快速开始

```bash
npm install
npm run dev
```

默认开发地址：

```text
http://localhost:3000
```

## 说明

该项目仍在持续迭代中，主要用于个人研究、数据观察和策略验证。

## 账本反推策略框架

本仓库新增了一个独立的 Python 研究管线，用于从 `bwjoke/BTC-Trading-Since-2020` 这类真实交易账本中反向提炼可解释、可回测、可扩展的策略规则。

运行方式：

```bash
python3 -m unittest tests.test_ledger_strategy
bash scripts/run_ledger_strategy.sh
```

默认输入目录：

```text
data/external/btc-trading-since-2020-raw
```

默认输出目录：

```text
data/ledger_strategy
```

主要输出：

- `schema_scan.json`：字段扫描与 schema 映射。
- `normalized/*.csv`：订单、成交、钱包流水、持仓快照、保证金快照、钱包快照和合约元数据的统一类型层。
- `trade_reconstruction/reconstructed_trades.csv`：开仓、加仓、减仓、平仓、反手后的交易生命周期。
- `strategy_inference/rules.json`：模块化策略规则与默认参数。
- `backtest/trades.csv` 与 `backtest/equity_curve.csv`：回测交易明细和收益曲线。
- `reports/ledger_strategy_report.md`：自动生成的分析报告。

前端策略专区中已注册 `魏神策略`。当前版本不再把历史 UTC 时间窗当成硬条件，而是把时间作为弱加分；核心判断改为多维市场状态评分，包括方向动量、趋势结构、持仓扩张、资金费率、流动性、波动过滤、价格位置、CVD、成交密集区和清算热力图等可扩展特征。

扩展市场数据时，实现或替换 `src/ledger_strategy/strategy/modules.py` 中的 `MarketContextProvider.features_at(symbol, timestamp)`，即可接入 K 线、波动率、资金费率、持仓量和基差等上下文。

当前限制：默认版本是账本行为策略，不把历史账户权益曲线当作策略证明；在接入完整 OHLCV 之前，止盈止损只能基于重建交易结果和账本路径推断。
