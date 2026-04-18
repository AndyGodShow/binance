from collections import defaultdict
from typing import Iterable


def build_attribution(wallet_rows: Iterable[dict[str, object]], equity_rows: list[dict[str, object]] | None = None) -> dict[str, float]:
    totals: defaultdict[str, float] = defaultdict(float)
    for row in wallet_rows:
        event_type = str(row.get("type") or "")
        amount = float(row.get("amount_xbt") or 0.0)
        fee = float(row.get("fee_xbt") or 0.0)
        if event_type == "RealisedPNL":
            totals["realised_pnl_xbt"] += amount
        elif event_type == "Funding":
            totals["funding_xbt"] += amount
        elif event_type == "Deposit":
            totals["deposit_xbt"] += amount
        elif event_type == "Withdrawal":
            totals["withdrawal_xbt"] += amount
            totals["withdrawal_fee_xbt"] += fee
        elif event_type == "Transfer":
            totals["transfer_xbt"] += amount
        elif event_type == "UnrealisedPNL":
            totals["unrealised_pnl_xbt"] += amount
        elif event_type in {"Conversion", "SpotTrade"}:
            totals["internal_conversion_xbt"] += amount
        else:
            totals[f"other_{event_type}_xbt"] += amount
    totals["external_cashflow_xbt"] = totals["deposit_xbt"] + totals["withdrawal_xbt"]
    totals["ledger_strategy_pnl_xbt"] = totals["realised_pnl_xbt"] + totals["funding_xbt"]
    if equity_rows:
        ordered = sorted(equity_rows, key=lambda row: row.get("timestamp"))
        first = ordered[0]
        last = ordered[-1]
        first_value = equity_value(first)
        last_value = equity_value(last)
        totals["equity_curve_change_xbt"] = last_value - first_value
        totals["attribution_gap_xbt"] = totals["equity_curve_change_xbt"] - totals["ledger_strategy_pnl_xbt"]
    return dict(totals)


def equity_value(row: dict[str, object]) -> float:
    for key in (
        "adjusted_wealth_xbt",
        "adjustedWealthXBT",
        "adjusted_marked_wealth_xbt",
        "adjustedMarkedWealthXBT",
        "wealth_xbt",
        "walletBalanceXBTEquivalent",
        "marginBalanceXBTEquivalent",
        "equity_xbt",
        "wallet_balance_xbt",
    ):
        if key in row:
            return float(row.get(key) or 0.0)
    numeric = [float(value) for key, value in row.items() if key != "timestamp" and isinstance(value, (int, float))]
    return numeric[0] if numeric else 0.0
