from dataclasses import dataclass

from src.ledger_strategy.reconstruct.models import ReconstructedTrade


class MarketContextProvider:
    def features_at(self, symbol: str, timestamp) -> dict[str, float]:
        return {}


@dataclass
class StrategyDecision:
    accept: bool
    size_multiplier: float
    reason: str


class LedgerDerivedStrategy:
    def __init__(self, rules: dict[str, object], market_context: MarketContextProvider | None = None):
        self.rules = rules
        self.market_context = market_context or MarketContextProvider()
        self.loss_streak = 0

    def signal(self, trade: ReconstructedTrade) -> bool:
        entry_rules = self.rules.get("entry_rules", {})
        symbols = set(entry_rules.get("preferred_symbols", []))
        directions = set(entry_rules.get("allowed_directions", []))
        symbol_ok = not symbols or trade.symbol in symbols
        direction_ok = not directions or trade.direction in directions
        return symbol_ok and direction_ok

    def time_bias_multiplier(self, trade: ReconstructedTrade) -> float:
        entry_rules = self.rules.get("entry_rules", {})
        if entry_rules.get("time_filter_mode") != "weak_bonus":
            hours = set(entry_rules.get("allowed_entry_hours_utc", []))
            return 1.0 if not hours or trade.entry_time.hour in hours else 0.0

        directional_windows = entry_rules.get("directional_entry_windows", {})
        if isinstance(directional_windows, dict) and directional_windows:
            direction_hours = set(directional_windows.get(trade.direction, []))
            if direction_hours and trade.entry_time.hour not in direction_hours:
                return 0.9
        return 1.0

    def size(self, trade: ReconstructedTrade) -> float:
        risk_rules = self.rules.get("risk_rules", {})
        multiplier = self.time_bias_multiplier(trade)
        if multiplier <= 0:
            return 0.0
        if self.loss_streak >= int(risk_rules.get("max_consecutive_losses", 3)):
            multiplier *= 0.35
        if trade.add_count and risk_rules.get("block_adds_if_add_pattern_underperforms"):
            multiplier *= 0.7
        return multiplier

    def execution(self, trade: ReconstructedTrade) -> bool:
        execution_rules = self.rules.get("execution_rules", {})
        if execution_rules.get("prefer_maker") and trade.maker_ratio < 0.2:
            return False
        risk_rules = self.rules.get("risk_rules", {})
        if (
            risk_rules.get("block_taker_chasing")
            and trade.taker_ratio >= 0.7
            and "Market" in trade.entry_order_types.split("|")
        ):
            return False
        return True

    def exit(self, trade: ReconstructedTrade) -> bool:
        exit_rules = self.rules.get("exit_rules", {})
        stop_loss = float(exit_rules.get("stop_loss_xbt") or 0.0)
        take_profit = float(exit_rules.get("take_profit_xbt") or 0.0)
        if stop_loss and trade.net_pnl_xbt <= -stop_loss:
            return True
        if take_profit and trade.net_pnl_xbt >= take_profit:
            return True
        return trade.exit_time is not None

    def risk(self, trade: ReconstructedTrade) -> bool:
        context = self.market_context.features_at(trade.symbol, trade.entry_time)
        if context.get("realized_volatility", 0.0) > context.get("max_allowed_volatility", float("inf")):
            return False
        return True

    def decide(self, trade: ReconstructedTrade) -> StrategyDecision:
        if not self.signal(trade):
            return StrategyDecision(False, 0.0, "filtered_by_signal_module")
        if not self.execution(trade):
            return StrategyDecision(False, 0.0, "filtered_by_execution_module")
        if not self.risk(trade):
            return StrategyDecision(False, 0.0, "filtered_by_risk_module")
        size_multiplier = self.size(trade)
        if size_multiplier <= 0:
            return StrategyDecision(False, 0.0, "blocked_by_sizing_module")
        return StrategyDecision(self.exit(trade), size_multiplier, "accepted")

    def observe_result(self, pnl_xbt: float) -> None:
        if pnl_xbt < 0:
            self.loss_streak += 1
        elif pnl_xbt > 0:
            self.loss_streak = 0
