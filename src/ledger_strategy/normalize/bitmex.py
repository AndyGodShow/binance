from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable

from src.ledger_strategy.utils.csv_io import stream_csv
from src.ledger_strategy.utils.time import parse_time

XBT_SATOSHI = Decimal("100000000")


def to_float(value: object, default: float = 0.0) -> float:
    if value is None:
        return default
    text = str(value).strip()
    if not text:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def to_bool(value: object) -> bool:
    return str(value or "").strip().lower() == "true"


def native_money_to_xbt(value: object, currency: str) -> float:
    return sats_to_xbt(value) if currency == "XBt" else 0.0


def sats_to_xbt(value: object) -> float:
    if value is None:
        return 0.0
    text = str(value).strip()
    if not text:
        return 0.0
    try:
        return float(Decimal(text) / XBT_SATOSHI)
    except (InvalidOperation, ValueError):
        return 0.0


def normalize_execution_rows(path: Path) -> list[dict[str, object]]:
    rows = []
    for row in stream_csv(path):
        if row.get("execType") != "Trade":
            continue
        rows.append(
            {
                "timestamp": parse_time(row.get("timestamp")),
                "transact_time": parse_time(row.get("transactTime")),
                "symbol": row.get("symbol", ""),
                "side": row.get("side", ""),
                "last_qty": abs(to_float(row.get("lastQty"))),
                "last_px": to_float(row.get("lastPx") or row.get("avgPx") or row.get("price")),
                "order_qty": to_float(row.get("orderQty")),
                "order_id": row.get("orderID", ""),
                "exec_id": row.get("execID", ""),
                "ord_status": row.get("ordStatus", ""),
                "ord_type": row.get("ordType", ""),
                "exec_inst": row.get("execInst", ""),
                "time_in_force": row.get("timeInForce", ""),
                "last_liquidity_ind": row.get("lastLiquidityInd", ""),
                "fee_xbt": sats_to_xbt(row.get("execComm")),
                "realised_pnl_xbt": sats_to_xbt(row.get("realisedPnl")),
                "commission_rate": to_float(row.get("commission")),
                "triggered": row.get("triggered", "").lower() == "true",
                "text": row.get("text", ""),
            }
        )
    return [row for row in rows if row["timestamp"] is not None and row["last_qty"]]


def normalize_order_rows(path: Path) -> list[dict[str, object]]:
    rows = []
    for row in stream_csv(path):
        rows.append(
            {
                "timestamp": parse_time(row.get("timestamp")),
                "transact_time": parse_time(row.get("transactTime")),
                "symbol": row.get("symbol", ""),
                "side": row.get("side", ""),
                "order_id": row.get("orderID", ""),
                "ord_status": row.get("ordStatus", ""),
                "ord_type": row.get("ordType", ""),
                "order_qty": abs(to_float(row.get("orderQty"))),
                "cum_qty": abs(to_float(row.get("cumQty"))),
                "leaves_qty": abs(to_float(row.get("leavesQty"))),
                "price": to_float(row.get("price")),
                "avg_px": to_float(row.get("avgPx")),
                "stop_px": to_float(row.get("stopPx")),
                "time_in_force": row.get("timeInForce", ""),
                "exec_inst": row.get("execInst", ""),
                "triggered": row.get("triggered", "").lower() == "true",
            }
        )
    return [row for row in rows if row["timestamp"] is not None]


def normalize_wallet_rows(path: Path) -> list[dict[str, object]]:
    rows = []
    for row in stream_csv(path):
        currency = row.get("currency", "")
        amount_native = row.get("amount")
        fee_native = row.get("fee")
        balance_native = row.get("walletBalance")
        is_xbt = currency == "XBt"
        rows.append(
            {
                "timestamp": parse_time(row.get("timestamp")),
                "transact_time": parse_time(row.get("transactTime")),
                "type": row.get("transactType", ""),
                "status": row.get("transactStatus", ""),
                "currency": currency,
                "amount_native": sats_to_xbt(amount_native) if is_xbt else to_float(amount_native),
                "fee_native": sats_to_xbt(fee_native) if is_xbt else to_float(fee_native),
                "wallet_balance_native": sats_to_xbt(balance_native) if is_xbt else to_float(balance_native),
                "amount_xbt": sats_to_xbt(amount_native) if is_xbt else 0.0,
                "fee_xbt": sats_to_xbt(fee_native) if is_xbt else 0.0,
                "wallet_balance_xbt": sats_to_xbt(balance_native) if is_xbt else 0.0,
                "order_id": row.get("orderID", ""),
                "transaction_id": row.get("transactID", ""),
            }
        )
    return [row for row in rows if row["timestamp"] is not None]


def normalize_equity_rows(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    rows = []
    for row in stream_csv(path):
        timestamp = parse_time(row.get("timestamp") or row.get("time") or row.get("date"))
        if timestamp is None:
            continue
        normalized = {"timestamp": timestamp}
        for key, value in row.items():
            if key != "timestamp":
                normalized[key] = to_float(value)
        rows.append(normalized)
    return rows


def normalize_position_snapshot_rows(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    rows = []
    for row in stream_csv(path):
        timestamp = parse_time(row.get("timestamp"))
        if timestamp is None:
            continue
        currency = row.get("currency", "")
        rows.append(
            {
                "timestamp": timestamp,
                "symbol": row.get("symbol", ""),
                "currency": currency,
                "underlying": row.get("underlying", ""),
                "quote_currency": row.get("quoteCurrency", ""),
                "current_qty": to_float(row.get("currentQty")),
                "avg_entry_price": to_float(row.get("avgEntryPrice")),
                "break_even_price": to_float(row.get("breakEvenPrice")),
                "mark_price": to_float(row.get("markPrice")),
                "liquidation_price": to_float(row.get("liquidationPrice")),
                "realised_pnl_xbt": native_money_to_xbt(row.get("realisedPnl"), currency),
                "unrealised_pnl_xbt": native_money_to_xbt(row.get("unrealisedPnl"), currency),
                "home_notional": to_float(row.get("homeNotional")),
                "foreign_notional": to_float(row.get("foreignNotional")),
                "is_open": to_bool(row.get("isOpen")),
                "leverage": to_float(row.get("leverage")),
                "init_margin_xbt": native_money_to_xbt(row.get("initMargin"), currency),
                "maint_margin_xbt": native_money_to_xbt(row.get("maintMargin"), currency),
                "position_margin_xbt": native_money_to_xbt(row.get("posMargin"), currency),
                "risk_limit_xbt": native_money_to_xbt(row.get("riskLimit"), currency),
                "risk_value_xbt": native_money_to_xbt(row.get("riskValue"), currency),
                "strategy": row.get("strategy", ""),
            }
        )
    return rows


def normalize_margin_snapshot_rows(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    rows = []
    for row in stream_csv(path):
        timestamp = parse_time(row.get("timestamp"))
        if timestamp is None:
            continue
        currency = row.get("currency", "")
        rows.append(
            {
                "timestamp": timestamp,
                "currency": currency,
                "wallet_balance_xbt": native_money_to_xbt(row.get("walletBalance"), currency),
                "margin_balance_xbt": native_money_to_xbt(row.get("marginBalance"), currency),
                "available_margin_xbt": native_money_to_xbt(row.get("availableMargin"), currency),
                "withdrawable_margin_xbt": native_money_to_xbt(row.get("withdrawableMargin"), currency),
                "realised_pnl_xbt": native_money_to_xbt(row.get("realisedPnl"), currency),
                "unrealised_pnl_xbt": native_money_to_xbt(row.get("unrealisedPnl"), currency),
                "margin_leverage": to_float(row.get("marginLeverage")),
                "margin_used_percent": to_float(row.get("marginUsedPcnt")),
                "risk_limit_xbt": native_money_to_xbt(row.get("riskLimit"), currency),
                "risk_value_xbt": native_money_to_xbt(row.get("riskValue"), currency),
                "init_margin_xbt": native_money_to_xbt(row.get("initMargin"), currency),
                "maint_margin_xbt": native_money_to_xbt(row.get("maintMargin"), currency),
            }
        )
    return rows


def normalize_wallet_snapshot_rows(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    rows = []
    for row in stream_csv(path):
        timestamp = parse_time(row.get("timestamp"))
        if timestamp is None:
            continue
        currency = row.get("currency", "")
        rows.append(
            {
                "timestamp": timestamp,
                "currency": currency,
                "amount_xbt": native_money_to_xbt(row.get("amount"), currency),
                "deposited_xbt": native_money_to_xbt(row.get("deposited"), currency),
                "withdrawn_xbt": native_money_to_xbt(row.get("withdrawn"), currency),
                "transfer_in_xbt": native_money_to_xbt(row.get("transferIn"), currency),
                "transfer_out_xbt": native_money_to_xbt(row.get("transferOut"), currency),
                "pending_credit_xbt": native_money_to_xbt(row.get("pendingCredit"), currency),
                "pending_debit_xbt": native_money_to_xbt(row.get("pendingDebit"), currency),
                "confirmed_debit_xbt": native_money_to_xbt(row.get("confirmedDebit"), currency),
            }
        )
    return rows


def normalize_instrument_rows(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    rows = []
    for row in stream_csv(path):
        rows.append(
            {
                "timestamp": parse_time(row.get("timestamp")),
                "symbol": row.get("symbol", ""),
                "state": row.get("state", ""),
                "instrument_type": row.get("typ", ""),
                "listing_time": parse_time(row.get("listing")),
                "expiry_time": parse_time(row.get("expiry")),
                "settlement_time": parse_time(row.get("settle")),
                "underlying": row.get("underlying", ""),
                "quote_currency": row.get("quoteCurrency", ""),
                "settlement_currency": row.get("settlCurrency", ""),
                "is_inverse": to_bool(row.get("isInverse")),
                "is_quanto": to_bool(row.get("isQuanto")),
                "multiplier": to_float(row.get("multiplier")),
                "lot_size": to_float(row.get("lotSize")),
                "tick_size": to_float(row.get("tickSize")),
                "maker_fee": to_float(row.get("makerFee")),
                "taker_fee": to_float(row.get("takerFee")),
                "funding_rate": to_float(row.get("fundingRate")),
                "indicative_funding_rate": to_float(row.get("indicativeFundingRate")),
                "mark_price": to_float(row.get("markPrice")),
                "last_price": to_float(row.get("lastPrice")),
                "bid_price": to_float(row.get("bidPrice")),
                "ask_price": to_float(row.get("askPrice")),
                "open_interest": to_float(row.get("openInterest")),
                "open_value_xbt": sats_to_xbt(row.get("openValue")),
                "volume_24h": to_float(row.get("volume24h")),
                "turnover_24h_xbt": sats_to_xbt(row.get("turnover24h")),
                "risk_limit_xbt": sats_to_xbt(row.get("riskLimit")),
                "risk_step_xbt": sats_to_xbt(row.get("riskStep")),
            }
        )
    return [row for row in rows if row["symbol"]]


def order_counts_between(orders: Iterable[dict[str, object]], symbol: str, start, end) -> dict[str, int]:
    counts = {"order_count": 0, "cancel_count": 0, "trigger_order_count": 0, "market_order_count": 0, "limit_order_count": 0}
    for order in orders:
        timestamp = order.get("timestamp")
        if order.get("symbol") != symbol or timestamp is None:
            continue
        if timestamp < start or (end is not None and timestamp > end):
            continue
        counts["order_count"] += 1
        status = str(order.get("ord_status", ""))
        order_type = str(order.get("ord_type", ""))
        if status == "Canceled":
            counts["cancel_count"] += 1
        if "Stop" in order_type or order.get("stop_px"):
            counts["trigger_order_count"] += 1
        if order_type == "Market":
            counts["market_order_count"] += 1
        if order_type == "Limit":
            counts["limit_order_count"] += 1
    return counts
