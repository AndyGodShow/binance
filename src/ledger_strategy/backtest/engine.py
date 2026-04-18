from math import sqrt
from statistics import mean

from src.ledger_strategy.reconstruct.models import ReconstructedTrade
from src.ledger_strategy.strategy.modules import LedgerDerivedStrategy


def max_drawdown(equity: list[float]) -> float:
    peak = equity[0] if equity else 0.0
    worst = 0.0
    for value in equity:
        peak = max(peak, value)
        if peak:
            worst = min(worst, (value - peak) / peak)
    return abs(worst)


def run_backtest(
    trades: list[ReconstructedTrade],
    strategy: LedgerDerivedStrategy,
    initial_equity_xbt: float = 1.0,
) -> dict[str, object]:
    equity = initial_equity_xbt
    equity_floor = max(initial_equity_xbt * 0.05, 1e-8)
    halted = False
    halt_reason = ""
    curve = [{"timestamp": None, "equity_xbt": equity, "trade_id": "initial"}]
    simulated_trades = []
    returns = []
    for trade in sorted(trades, key=lambda item: item.entry_time):
        if halted:
            break
        decision = strategy.decide(trade)
        if not decision.accept:
            continue
        pnl = trade.net_pnl_xbt * decision.size_multiplier
        before = equity
        if equity + pnl <= equity_floor:
            pnl = equity_floor - equity
            halted = True
            halt_reason = "equity_floor_reached"
        equity += pnl
        returns.append(pnl / before if before else 0.0)
        strategy.observe_result(pnl)
        simulated_trades.append(
            {
                **trade.to_dict(),
                "sim_size_multiplier": decision.size_multiplier,
                "sim_net_pnl_xbt": pnl,
                "sim_reason": halt_reason or decision.reason,
            }
        )
        curve.append({"timestamp": trade.exit_time or trade.entry_time, "equity_xbt": equity, "trade_id": trade.trade_id})
    wins = [row for row in simulated_trades if row["sim_net_pnl_xbt"] > 0]
    losses = [row for row in simulated_trades if row["sim_net_pnl_xbt"] < 0]
    gross_profit = sum(row["sim_net_pnl_xbt"] for row in wins)
    gross_loss = abs(sum(row["sim_net_pnl_xbt"] for row in losses))
    avg_holding = mean(row["holding_seconds"] for row in simulated_trades if row["holding_seconds"] is not None) if simulated_trades else 0.0
    sharpe = 0.0
    if len(returns) > 1:
        avg = mean(returns)
        variance = sum((value - avg) ** 2 for value in returns) / (len(returns) - 1)
        sharpe = avg / sqrt(variance) * sqrt(365) if variance else 0.0
    mdd = max_drawdown([row["equity_xbt"] for row in curve])
    total_return = (equity - initial_equity_xbt) / initial_equity_xbt if initial_equity_xbt else 0.0
    metrics = {
        "initial_equity_xbt": initial_equity_xbt,
        "final_equity_xbt": equity,
        "total_return": total_return,
        "trade_count": len(simulated_trades),
        "win_rate": len(wins) / len(simulated_trades) if simulated_trades else 0.0,
        "profit_factor": gross_profit / gross_loss if gross_loss else float(gross_profit > 0),
        "max_drawdown": mdd,
        "sharpe": sharpe,
        "calmar": total_return / mdd if mdd else 0.0,
        "average_holding_seconds": avg_holding,
        "halted": halted,
        "halt_reason": halt_reason,
    }
    return {"metrics": metrics, "trades": simulated_trades, "equity_curve": curve}
