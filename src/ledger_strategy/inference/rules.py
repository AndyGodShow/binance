from collections import Counter, defaultdict
from statistics import mean, median

from src.ledger_strategy.reconstruct.models import ReconstructedTrade


def quantile(values: list[float], q: float, default: float = 0.0) -> float:
    clean = sorted(value for value in values if value is not None)
    if not clean:
        return default
    index = min(len(clean) - 1, max(0, round((len(clean) - 1) * q)))
    return clean[index]


def bucket_holding(seconds: float | None) -> str:
    if seconds is None:
        return "open"
    hours = seconds / 3600
    if hours < 1:
        return "<1h"
    if hours < 6:
        return "1-6h"
    if hours < 24:
        return "6-24h"
    if hours < 72:
        return "1-3d"
    return ">3d"


def bucket_maker_ratio(value: float) -> str:
    if value >= 0.7:
        return "maker_70_plus"
    if value < 0.2:
        return "maker_below_20"
    return "maker_20_to_70"


def bucket_taker_ratio(value: float) -> str:
    if value >= 0.7:
        return "taker_70_plus"
    if value < 0.2:
        return "taker_below_20"
    return "taker_20_to_70"


def bucket_count(value: int, prefix: str) -> str:
    if value == 0:
        return f"{prefix}_0"
    if value <= 5:
        return f"{prefix}_1_to_5"
    if value <= 20:
        return f"{prefix}_6_to_20"
    return f"{prefix}_20_plus"


def group_quality(groups: dict[str, list[ReconstructedTrade]]) -> dict[str, dict[str, float]]:
    return {key: summarize_group(value) for key, value in sorted(groups.items())}


def order_type_quality(trades: list[ReconstructedTrade], attr: str) -> dict[str, dict[str, float]]:
    groups: dict[str, list[ReconstructedTrade]] = defaultdict(list)
    for trade in trades:
        raw = str(getattr(trade, attr) or "")
        values = [item for item in raw.split("|") if item]
        for item in values or ["Unknown"]:
            groups[item].append(trade)
    return group_quality(groups)


def summarize_group(trades: list[ReconstructedTrade]) -> dict[str, float]:
    if not trades:
        return {"count": 0, "win_rate": 0.0, "avg_net_pnl_xbt": 0.0, "profit_factor": 0.0}
    wins = [trade.net_pnl_xbt for trade in trades if trade.net_pnl_xbt > 0]
    losses = [abs(trade.net_pnl_xbt) for trade in trades if trade.net_pnl_xbt < 0]
    return {
        "count": len(trades),
        "win_rate": len(wins) / len(trades),
        "avg_net_pnl_xbt": mean(trade.net_pnl_xbt for trade in trades),
        "median_net_pnl_xbt": median(trade.net_pnl_xbt for trade in trades),
        "profit_factor": sum(wins) / sum(losses) if losses else float(sum(wins) > 0),
    }


def infer_strategy_rules(trades: list[ReconstructedTrade]) -> dict[str, object]:
    closed = [trade for trade in trades if trade.exit_time is not None]
    profitable = [trade for trade in closed if trade.net_pnl_xbt > 0]
    losing = [trade for trade in closed if trade.net_pnl_xbt < 0]
    by_direction = defaultdict(list)
    by_hour = defaultdict(list)
    by_hour_direction = defaultdict(list)
    by_holding = defaultdict(list)
    by_add_pattern = defaultdict(list)
    by_maker_ratio = defaultdict(list)
    by_taker_ratio = defaultdict(list)
    by_cancel_count = defaultdict(list)
    by_reduce_count = defaultdict(list)
    by_symbol = defaultdict(list)
    for trade in closed:
        by_direction[trade.direction].append(trade)
        by_hour[trade.entry_time.hour].append(trade)
        by_hour_direction[(trade.entry_time.hour, trade.direction)].append(trade)
        by_holding[bucket_holding(trade.holding_seconds)].append(trade)
        by_add_pattern["with_adds" if trade.add_count else "no_adds"].append(trade)
        by_maker_ratio[bucket_maker_ratio(trade.maker_ratio)].append(trade)
        by_taker_ratio[bucket_taker_ratio(trade.taker_ratio)].append(trade)
        by_cancel_count[bucket_count(trade.cancel_count, "cancel")].append(trade)
        by_reduce_count[bucket_count(trade.reduce_count, "reduce")].append(trade)
        by_symbol[trade.symbol].append(trade)

    hour_scores = {hour: summarize_group(group) for hour, group in sorted(by_hour.items())}
    best_hours = [
        hour
        for hour, stats in hour_scores.items()
        if stats["count"] >= max(5, len(closed) * 0.01) and stats["avg_net_pnl_xbt"] >= 0
    ]
    direction_stats = {key: summarize_group(value) for key, value in by_direction.items()}
    min_directional_count = max(5, len(closed) * 0.005)
    directional_entry_windows = {"long": [], "short": []}
    for (hour, direction), group in sorted(by_hour_direction.items()):
        stats = summarize_group(group)
        if stats["count"] >= min_directional_count and (stats["avg_net_pnl_xbt"] >= 0 or stats["profit_factor"] >= 1):
            directional_entry_windows[direction].append(hour)
    symbol_stats = {key: summarize_group(value) for key, value in by_symbol.items()}
    holding_stats = {key: summarize_group(value) for key, value in by_holding.items()}
    add_stats = {key: summarize_group(value) for key, value in by_add_pattern.items()}
    maker_quality = group_quality(by_maker_ratio)
    taker_quality = group_quality(by_taker_ratio)
    cancel_quality = group_quality(by_cancel_count)
    reduce_quality = group_quality(by_reduce_count)
    entry_order_quality = order_type_quality(closed, "entry_order_types")
    exit_order_quality = order_type_quality(closed, "exit_order_types")
    maker_values = [trade.maker_ratio for trade in closed]
    holding_values = [trade.holding_seconds or 0.0 for trade in profitable]
    loss_values = [abs(trade.net_pnl_xbt) for trade in losing]
    profit_values = [trade.net_pnl_xbt for trade in profitable]
    size_values = [trade.max_position_size for trade in closed]
    order_type_counter = Counter()
    exit_type_counter = Counter()
    for trade in closed:
        for item in trade.entry_order_types.split("|"):
            if item:
                order_type_counter[item] += 1
        for item in trade.exit_order_types.split("|"):
            if item:
                exit_type_counter[item] += 1
    maker_edge = maker_quality.get("maker_70_plus", {}).get("avg_net_pnl_xbt", 0.0) > maker_quality.get(
        "maker_below_20", {}
    ).get("avg_net_pnl_xbt", 0.0)
    market_entry_underperforms = entry_order_quality.get("Market", {}).get("avg_net_pnl_xbt", 0.0) < entry_order_quality.get(
        "Limit", {}
    ).get("avg_net_pnl_xbt", 0.0)

    return {
        "strategy_name": "Ledger-Derived BTC Execution Regime Strategy",
        "sample": {
            "trade_count": len(trades),
            "closed_trade_count": len(closed),
            "open_trade_count": len(trades) - len(closed),
        },
        "entry_rules": {
            "preferred_symbols": [
                symbol
                for symbol, stats in symbol_stats.items()
                if stats["count"] >= 5 and (stats["avg_net_pnl_xbt"] >= 0 or stats["profit_factor"] >= 1)
            ],
            "allowed_entry_hours_utc": best_hours or sorted(by_hour.keys()),
            "directional_entry_windows": directional_entry_windows,
            "time_filter_mode": "weak_bonus",
            "time_bias_weight": 0.04,
            "allowed_directions": [
                direction for direction, hours in directional_entry_windows.items() if hours
            ],
            "direction_bias": direction_stats,
            "entry_order_type_preference": order_type_counter.most_common(),
            "entry_order_type_quality": entry_order_quality,
            "hypothesis": "Use ledger-observed side, execution quality and path regimes as primary filters; time is retained only as a weak bias, not as market alpha.",
        },
        "exit_rules": {
            "median_profitable_holding_seconds": median(holding_values) if holding_values else 0.0,
            "holding_bucket_quality": holding_stats,
            "stop_loss_xbt": quantile(loss_values, 0.65, 0.0),
            "take_profit_xbt": quantile(profit_values, 0.55, 0.0),
            "exit_order_type_preference": exit_type_counter.most_common(),
        },
        "sizing_rules": {
            "median_position_size": median(size_values) if size_values else 0.0,
            "p75_position_size": quantile(size_values, 0.75, 0.0),
            "add_pattern_quality": add_stats,
            "reduce_after_losses": True,
            "increase_after_wins": False,
        },
        "execution_rules": {
            "median_maker_ratio": median(maker_values) if maker_values else 0.0,
            "prefer_maker": maker_edge or (median(maker_values) if maker_values else 0.0) >= 0.5,
            "cancel_sensitive": mean(trade.cancel_count for trade in closed) if closed else 0.0,
            "maker_ratio_quality": maker_quality,
            "taker_ratio_quality": taker_quality,
            "entry_order_type_quality": entry_order_quality,
            "exit_order_type_quality": exit_order_quality,
            "cancel_count_quality": cancel_quality,
            "reduce_count_quality": reduce_quality,
            "execution_filter_mode": "prefer_maker_limit_not_market_chase",
        },
        "risk_rules": {
            "max_consecutive_losses": 3,
            "risk_per_trade": 0.01,
            "block_adds_if_add_pattern_underperforms": add_stats.get("with_adds", {}).get("avg_net_pnl_xbt", 0.0)
            < add_stats.get("no_adds", {}).get("avg_net_pnl_xbt", 0.0),
            "block_taker_chasing": maker_edge and market_entry_underperforms,
        },
        "filter_rules": {
            "market_context_required": False,
            "future_market_context_fields": ["ohlcv", "realized_volatility", "funding_rate", "open_interest", "basis"],
        },
    }
