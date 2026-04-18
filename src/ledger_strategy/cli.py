import argparse
from pathlib import Path

from src.ledger_strategy.backtest.engine import run_backtest
from src.ledger_strategy.config.defaults import DEFAULT_CONFIG, REQUIRED_FILES, resolve_path
from src.ledger_strategy.inference.rules import infer_strategy_rules
from src.ledger_strategy.ingest.scanner import scan_dataset
from src.ledger_strategy.normalize.bitmex import (
    normalize_equity_rows,
    normalize_execution_rows,
    normalize_instrument_rows,
    normalize_margin_snapshot_rows,
    normalize_order_rows,
    normalize_position_snapshot_rows,
    normalize_wallet_rows,
    normalize_wallet_snapshot_rows,
)
from src.ledger_strategy.reconstruct.engine import reconstruct_trades
from src.ledger_strategy.reports.attribution import build_attribution
from src.ledger_strategy.reports.report import build_markdown_report, trade_rows
from src.ledger_strategy.strategy.modules import LedgerDerivedStrategy
from src.ledger_strategy.utils.csv_io import write_csv, write_json, write_optional_parquet


def parse_scalar(value: str):
    clean = value.strip().strip('"').strip("'")
    if clean.lower() in {"true", "false"}:
        return clean.lower() == "true"
    try:
        if "." in clean:
            return float(clean)
        return int(clean)
    except ValueError:
        return clean


def load_simple_yaml(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    result: dict[str, object] = {}
    stack: list[tuple[int, dict[str, object]]] = [(-1, result)]
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        key, _, value = line.strip().partition(":")
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if not value.strip():
            child: dict[str, object] = {}
            parent[key] = child
            stack.append((indent, child))
        else:
            text = value.strip()
            if text.startswith("[") and text.endswith("]"):
                parent[key] = [parse_scalar(item) for item in text[1:-1].split(",") if item.strip()]
            else:
                parent[key] = parse_scalar(text)
    return result


def deep_merge(base: dict[str, object], override: dict[str, object]) -> dict[str, object]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)  # type: ignore[arg-type]
        else:
            merged[key] = value
    return merged


def load_config(path: Path | None) -> dict[str, object]:
    if path is None:
        return dict(DEFAULT_CONFIG)
    return deep_merge(DEFAULT_CONFIG, load_simple_yaml(path))


def run_pipeline(config: dict[str, object]) -> dict[str, object]:
    cwd = Path.cwd()
    data_dir = resolve_path(str(config["data_dir"]), cwd)
    output_dir = resolve_path(str(config["output_dir"]), cwd)
    output_dir.mkdir(parents=True, exist_ok=True)

    schema_scan = scan_dataset(data_dir, REQUIRED_FILES)
    write_json(output_dir / "schema_scan.json", schema_scan)

    orders = normalize_order_rows(data_dir / "api-v1-order.csv") if (data_dir / "api-v1-order.csv").exists() else []
    fills = normalize_execution_rows(data_dir / "api-v1-execution-tradeHistory.csv") if (data_dir / "api-v1-execution-tradeHistory.csv").exists() else []
    wallet = normalize_wallet_rows(data_dir / "api-v1-user-walletHistory.csv") if (data_dir / "api-v1-user-walletHistory.csv").exists() else []
    equity = normalize_equity_rows(data_dir / "derived-equity-curve.csv")
    positions = normalize_position_snapshot_rows(data_dir / "api-v1-position.snapshot.csv")
    margin_snapshots = normalize_margin_snapshot_rows(data_dir / "api-v1-user-margin.snapshot-all.csv")
    wallet_snapshots = normalize_wallet_snapshot_rows(data_dir / "api-v1-user-wallet.snapshot-all.csv")
    instruments = normalize_instrument_rows(data_dir / "api-v1-instrument.all.csv")

    normalized_dir = output_dir / "normalized"
    write_csv(normalized_dir / "orders.csv", orders)
    write_csv(normalized_dir / "executions.csv", fills)
    write_csv(normalized_dir / "wallet_history.csv", wallet)
    write_csv(normalized_dir / "position_snapshot.csv", positions)
    write_csv(normalized_dir / "margin_snapshot_all.csv", margin_snapshots)
    write_csv(normalized_dir / "wallet_snapshot_all.csv", wallet_snapshots)
    write_csv(normalized_dir / "instruments.csv", instruments)
    write_optional_parquet(normalized_dir / "orders.parquet", orders)
    write_optional_parquet(normalized_dir / "executions.parquet", fills)
    write_optional_parquet(normalized_dir / "wallet_history.parquet", wallet)
    write_optional_parquet(normalized_dir / "position_snapshot.parquet", positions)
    write_optional_parquet(normalized_dir / "margin_snapshot_all.parquet", margin_snapshots)
    write_optional_parquet(normalized_dir / "wallet_snapshot_all.parquet", wallet_snapshots)
    write_optional_parquet(normalized_dir / "instruments.parquet", instruments)

    trades = reconstruct_trades(fills, orders, wallet)
    reconstructed_rows = trade_rows(trades)
    write_csv(output_dir / "trade_reconstruction" / "reconstructed_trades.csv", reconstructed_rows)
    write_optional_parquet(output_dir / "trade_reconstruction" / "reconstructed_trades.parquet", reconstructed_rows)

    attribution = build_attribution(wallet, equity)
    write_json(output_dir / "reports" / "account_attribution.json", attribution)

    rules = infer_strategy_rules(trades)
    write_json(output_dir / "strategy_inference" / "rules.json", rules)

    initial_equity = float(config.get("risk", {}).get("initial_equity_xbt", 1.0)) if isinstance(config.get("risk"), dict) else 1.0
    backtest = run_backtest(trades, LedgerDerivedStrategy(rules), initial_equity)
    write_json(output_dir / "backtest" / "metrics.json", backtest["metrics"])
    write_csv(output_dir / "backtest" / "trades.csv", backtest["trades"])
    write_csv(output_dir / "backtest" / "equity_curve.csv", backtest["equity_curve"])

    report_path = output_dir / "reports" / "ledger_strategy_report.md"
    build_markdown_report(report_path, schema_scan, attribution, rules, backtest, trades)

    return {
        "schema_scan": schema_scan,
        "trade_count": len(trades),
        "attribution": attribution,
        "rules": rules,
        "backtest_metrics": backtest["metrics"],
        "report": str(report_path),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reverse-engineer an explainable strategy from public trading ledgers.")
    parser.add_argument("--config", default="config/ledger_strategy.yaml", help="Path to YAML config.")
    parser.add_argument("--data-dir", help="Override input data directory.")
    parser.add_argument("--output-dir", help="Override output directory.")
    args = parser.parse_args(argv)

    config = load_config(Path(args.config) if args.config else None)
    if args.data_dir:
        config["data_dir"] = args.data_dir
    if args.output_dir:
        config["output_dir"] = args.output_dir
    result = run_pipeline(config)
    print(f"schema files: {len(result['schema_scan']['files'])}")
    print(f"reconstructed trades: {result['trade_count']}")
    print(f"report: {result['report']}")
    print(f"backtest metrics: {result['backtest_metrics']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
