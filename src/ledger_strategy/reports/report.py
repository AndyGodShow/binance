from collections import Counter
from pathlib import Path

from src.ledger_strategy.reconstruct.models import ReconstructedTrade
from src.ledger_strategy.utils.time import isoformat


def trade_rows(trades: list[ReconstructedTrade]) -> list[dict[str, object]]:
    return [
        {
            **trade.to_dict(),
            "entry_time": isoformat(trade.entry_time),
            "exit_time": isoformat(trade.exit_time),
        }
        for trade in trades
    ]


def build_markdown_report(
    path: Path,
    schema_scan: dict[str, object],
    attribution: dict[str, float],
    rules: dict[str, object],
    backtest: dict[str, object],
    trades: list[ReconstructedTrade],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    closed = [trade for trade in trades if trade.exit_time is not None]
    symbols = Counter(trade.symbol for trade in trades)
    directions = Counter(trade.direction for trade in trades)
    metrics = backtest["metrics"]
    entry_rules = rules.get("entry_rules", {})
    exit_rules = rules.get("exit_rules", {})
    sizing_rules = rules.get("sizing_rules", {})
    execution_rules = rules.get("execution_rules", {})
    risk_rules = rules.get("risk_rules", {})
    lines = [
        "# Ledger-Derived Strategy Reverse Engineering Report",
        "",
        "## Data Layers",
    ]
    for layer, description in schema_scan["layers"].items():
        lines.append(f"- **{layer}**: {description}")
    lines.extend(
        [
            "",
            "## Field Scan",
            "| file | exists | rows | mapped columns | missing required |",
            "|---|---:|---:|---:|---|",
        ]
    )
    for item in schema_scan["files"]:
        columns = item.get("columns", [])
        mapped = sum(1 for column in columns if column.get("mapping"))
        missing = ", ".join(item.get("missing_required_columns", []))
        lines.append(f"| {item['file']} | {item['exists']} | {item.get('rows', '')} | {mapped}/{len(columns)} | {missing} |")
    lines.extend(
        [
            "",
            "## Reconstruction Summary",
            f"- Reconstructed trades: {len(trades)}",
            f"- Closed trades: {len(closed)}",
            f"- Open positions at export: {len(trades) - len(closed)}",
            f"- Symbols: {dict(symbols.most_common(10))}",
            f"- Directions: {dict(directions)}",
            "",
            "## Account Attribution",
        ]
    )
    for key in sorted(attribution):
        lines.append(f"- {key}: {attribution[key]:.8f}")
    lines.extend(
        [
            "",
            "## Strategy Ruleset",
            f"- Strategy name: {rules.get('strategy_name')}",
            "- Signal module: rank direction/regime evidence first; UTC windows are weak confidence bias only, not hard filters.",
            "- Sizing module: use median historical size as reference, cut exposure after loss streaks, and penalize add-heavy paths when they underperform.",
            "- Execution module: prefer maker/limit execution when the reconstructed ledger shows it outperforms taker/market chasing.",
            "- Exit module: use inferred XBT stop/take-profit thresholds plus learned holding-time buckets.",
            "- Risk module: cap consecutive losses and reserve a market-context volatility gate for future OHLCV/OI/funding input.",
            "- Filter module: ledger-only mode now, market-context adapter already exposed for future extension.",
            "",
            "### Default Parameters",
            f"- Time filter mode: {entry_rules.get('time_filter_mode', 'weak_bonus')}",
            f"- Directional time-bias windows UTC: {entry_rules.get('directional_entry_windows', {})}",
            f"- Stop loss XBT: {exit_rules.get('stop_loss_xbt', 0.0)}",
            f"- Take profit XBT: {exit_rules.get('take_profit_xbt', 0.0)}",
            f"- Median position size: {sizing_rules.get('median_position_size', 0.0)}",
            f"- Prefer maker: {execution_rules.get('prefer_maker', False)}",
            f"- Block taker/market chasing: {risk_rules.get('block_taker_chasing', False)}",
            "",
            "## Cross-Section Evidence",
            f"- Direction quality: {entry_rules.get('direction_bias', {})}",
            f"- Maker ratio quality: {execution_rules.get('maker_ratio_quality', {})}",
            f"- Taker ratio quality: {execution_rules.get('taker_ratio_quality', {})}",
            f"- Entry order type quality: {execution_rules.get('entry_order_type_quality', {})}",
            f"- Holding bucket quality: {exit_rules.get('holding_bucket_quality', {})}",
            f"- Add pattern quality: {sizing_rules.get('add_pattern_quality', {})}",
            f"- Cancel count quality: {execution_rules.get('cancel_count_quality', {})}",
            "",
            "## Backtest Metrics",
        ]
    )
    for key in sorted(metrics):
        value = metrics[key]
        if isinstance(value, float):
            lines.append(f"- {key}: {value:.8f}")
        else:
            lines.append(f"- {key}: {value}")
    lines.extend(
        [
            "",
            "## Known Limits",
            "- This is a ledger-behavior strategy, not proof of market alpha.",
            "- Intrabar stop/take-profit timing cannot be verified until OHLCV path data is connected.",
            "- Funding is assigned by holding window when symbol-level funding attribution is unavailable.",
            "- Deposit, withdrawal, transfer, conversion and spot swap rows are excluded from strategy PnL attribution.",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
