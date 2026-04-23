# Market Archive V2 规划

## 目标

- 建立一套干净、统一、可审计的本地历史库。
- 新库承担后续下载和维护，旧库 `data/historical` 仅作为只读兼容层保留，直到新库验证完成后再删除。
- 第一阶段覆盖 `Top 150` U 本位合约。

## 数据范围

每个币种的“全量数据”定义为：

- `klines`
  - 周期：`15m`、`1h`、`4h`、`1d`
- `fundingRate`
  - 资金费率，时间级别 `8h`
- `metrics`
  - 时间级别 `5m`
  - 当前至少包含：
    - `sum_open_interest`
    - `sum_open_interest_value`
    - `count_toptrader_long_short_ratio`
    - `sum_toptrader_long_short_ratio`
    - `count_long_short_ratio`
    - `sum_taker_long_short_vol_ratio`

## 目录规范

```text
data/
  market-archive-v2/
    BTCUSDT/
      klines/
        15m/
          merged.csv
          audit.json
          sources/
            monthly/
            daily/
        1h/
        4h/
        1d/
      fundingRate/
        BTCUSDT-fundingRate-YYYY-MM-DD.csv
      metrics/
        BTCUSDT-metrics-YYYY-MM-DD.csv
    _reports/
```

说明：

- 当前阶段先保持与现有代码兼容的 `fundingRate/metrics` 日文件格式，优先完成迁移。
- `klines` 继续保留 `merged.csv + audit.json`，确保回测和覆盖率校验逻辑不需要重写。
- `_reports/` 仅存放同步报告，不和币种目录混放。

## 读写规则

- 默认写入根目录：`data/market-archive-v2`
- 环境变量：`MARKET_ARCHIVE_ROOT`
  - 可覆盖新库根目录
- 读取顺序：
  1. 新库根目录
  2. 旧库 `data/historical`

这意味着：

- 新下载的数据会进入新库
- 未迁移的数据仍可从旧库读取
- 迁移期内功能不断档

## Top 150 容量预估

基于当前本地样本估算：

- 单个完整币种平均约 `41MB`
- `Top 150` 全量预计约 `6.2GB`

建议按 `7GB - 9GB` 预留磁盘空间，给后续补齐、报告和审计文件留余量。

## 迁移步骤

1. 完成代码层的“新库优先、旧库兜底”兼容。
2. 先下载一批核心币种验证：
   - 建议 `BTCUSDT`、`ETHUSDT`、`SOLUSDT`、`BNBUSDT`、`XRPUSDT`
3. 检查：
   - 回测接口可正常读取新库 K 线
   - 资金费率和 OI 覆盖率统计正常
   - `_reports` 输出进入新库
4. 扩大到 `Top 150`
5. 新库覆盖完成后，再清理旧库

## 当前实现状态

- 已支持新库写入根目录
- 已支持读取时回退旧库
- 下一步需要补：
  - Top 150 币种清单生成
  - 批量下载入口
  - 新库完成度审计脚本
