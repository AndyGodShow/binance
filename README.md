# 币安数据面板

基于 Next.js 16、React 19 和 SWR 的 U 本位合约数据分析与策略回测面板。项目聚合币安合约行情、多周期指标、策略扫描、信号提醒、历史数据下载与回测能力，面向高频盯盘和策略研究场景。

## 主要能力

- 实时市场面板：展示合约行情、成交量、持仓量、多周期涨跌幅等信息
- 指标增强：支持 RSRS、布林带、肯特纳通道、Volatility Squeeze、ADX、Volume Profile 等
- 策略中心：内置强突破、趋势确认、资金流入、RSRS、波动率挤压等策略
- 预警系统：支持实时提醒、定时提醒、浏览器通知与信号池管理
- 历史数据与回测：支持 K 线拉取、覆盖率检查、批量回测和结果图表展示

## 开发命令

```bash
npm install
npm run dev
```

默认开发地址：

```text
http://localhost:3000
```

可用脚本：

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
```

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- SWR
- Recharts

## 说明

- 行情与指标数据主要通过项目内的 Binance API 封装统一获取
- 多周期行情当前采用接口轮询和缓存策略，不依赖独立前端 WebSocket Hook
- 回测与历史数据功能已经整合到主界面，不再依赖单独的数据管理页面

## 文档

- `docs/project_summary.md`：项目整体能力和架构说明
- `docs/历史数据获取指南.md`：历史数据与回测数据获取说明
