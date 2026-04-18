from pathlib import Path


REQUIRED_FILES = [
    "api-v1-order.csv",
    "api-v1-execution-tradeHistory.csv",
    "api-v1-user-walletHistory.csv",
    "api-v1-position.snapshot.csv",
    "api-v1-user-margin.snapshot-all.csv",
    "api-v1-user-wallet.snapshot-all.csv",
    "api-v1-instrument.all.csv",
    "derived-equity-curve.csv",
    "manifest.json",
]


DEFAULT_CONFIG = {
    "data_dir": "data/external/btc-trading-since-2020-raw",
    "output_dir": "data/ledger_strategy",
    "primary_symbol": "XBTUSD",
    "min_trade_qty": 1.0,
    "stop_loss_loss_quantile": 0.25,
    "take_profit_profit_quantile": 0.65,
    "preferred_symbols": ["XBTUSD", "XBTUSDT", "ETHUSD", "ETHUSDT"],
    "risk": {
        "initial_equity_xbt": 1.0,
        "risk_per_trade": 0.01,
        "max_position_units": 100000.0,
        "max_daily_loss_xbt": 0.05,
        "max_consecutive_losses": 3,
    },
    "backtest": {
        "fee_buffer_xbt": 0.0,
        "use_reconstructed_exit": True,
        "require_rule_match": True,
    },
}


def resolve_path(path: str | Path, base: Path | None = None) -> Path:
    candidate = Path(path).expanduser()
    if candidate.is_absolute():
        return candidate
    return (base or Path.cwd()) / candidate
