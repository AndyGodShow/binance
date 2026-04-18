# 测试与稳定性验证指南

本项目采用分阶段验证，先跑本地质量门禁，再启动生产服务验证 API、回测和稳定性。

## 本地质量门禁

```bash
npm run verify
```

等价于：

```bash
npm run lint
npm run test
npm run typecheck
npm run build
```

`npm run test` 使用 Node 内置 `node:test`，覆盖 `src/lib/**/*.test.ts` 和 `scripts/**/*.test.mjs`。

## API 冒烟验证

先启动生产服务：

```bash
npm run build
npm run start -- -p 3001
```

再执行：

```bash
BASE_URL=http://127.0.0.1:3001 npm run verify:api
```

可选参数：

- `API_SMOKE_SYMBOL`：默认 `BTCUSDT`。
- `API_SMOKE_KEYWORD`：默认 `PEPE`。
- `API_SMOKE_TIMEOUT_MS`：单接口超时，默认 `25000`。
- `API_SMOKE_ENDPOINTS`：逗号分隔的端点名称，用于只跑部分端点。

默认覆盖：

- `market`
- `market-light`
- `market-multiframe`
- `oi-all`
- `oi-multiframe`
- `longshort`
- `macro`
- `rsrs`
- `onchain-dashboard`
- `backtest-klines`
- `data-download-coverage`

## 回测链路验证

低抽样：

```bash
BASE_URL=http://127.0.0.1:3001 SYMBOL_LIMIT=10 CONCURRENCY=3 npm run verify:backtest
```

默认窗口：

```bash
BASE_URL=http://127.0.0.1:3001 SYMBOL_LIMIT=30 CONCURRENCY=3 npm run verify:backtest
```

脚本会记录数据不足的 skipped symbols。只要至少一个样本完整通过，且失败项属于预检跳过，脚本会保留成功退出码。

## 稳定性验证

默认 30 分钟、每 60 秒一轮：

```bash
BASE_URL=http://127.0.0.1:3001 npm run verify:stability
```

短时自检示例：

```bash
BASE_URL=http://127.0.0.1:3001 STABILITY_DURATION_MS=90000 STABILITY_INTERVAL_MS=30000 npm run verify:stability
```

可选参数：

- `STABILITY_SYMBOL`：默认 `BTCUSDT`。
- `STABILITY_DURATION_MS`：默认 `1800000`。
- `STABILITY_INTERVAL_MS`：默认 `60000`。
- `STABILITY_TIMEOUT_MS`：默认 `25000`。
- `STABILITY_ENDPOINTS`：默认 `market-light,market-multiframe,oi-multiframe,longshort,backtest-klines`。

## 注意事项

- 外部行情接口可能返回 429、418、403、超时或连接重置；验证脚本会把这些记录为失败或 skipped，不应通过提高并发掩盖问题。
- 页面首次进入数据面板会触发较多批量行情请求，浏览器切 tab 时可能看到后台请求被挂起；只要页面可继续渲染、API smoke 与稳定性脚本通过，可视为降级路径可用。
- 缺少 `MORALIS_API_KEY` 或 `COINALYZE_API_KEY` 时，只验证降级展示，不把缺少凭据本身视为失败。
