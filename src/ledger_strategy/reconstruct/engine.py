from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

from src.ledger_strategy.normalize.bitmex import order_counts_between
from src.ledger_strategy.reconstruct.models import ReconstructedTrade


@dataclass
class PositionBuilder:
    symbol: str
    direction: str
    entry_time: datetime
    signed_position: float
    entry_notional: float
    entry_qty: float
    max_position_size: float
    fee_xbt: float = 0.0
    pnl_xbt: float = 0.0
    funding_xbt: float = 0.0
    fill_ids: set[str] = field(default_factory=set)
    order_ids: set[str] = field(default_factory=set)
    maker_qty: float = 0.0
    taker_qty: float = 0.0
    add_count: int = 0
    reduce_count: int = 0
    exit_qty: float = 0.0
    exit_notional: float = 0.0
    entry_order_types: set[str] = field(default_factory=set)
    exit_order_types: set[str] = field(default_factory=set)
    stop_like_exit: bool = False

    @property
    def abs_position(self) -> float:
        return abs(self.signed_position)

    def add_fee_and_quality(self, fill: dict[str, object], qty: float) -> None:
        self.fee_xbt += float(fill.get("fee_xbt") or 0.0) * ratio(qty, float(fill.get("last_qty") or qty))
        self.pnl_xbt += float(fill.get("realised_pnl_xbt") or 0.0) * ratio(qty, float(fill.get("last_qty") or qty))
        exec_id = str(fill.get("exec_id") or "")
        order_id = str(fill.get("order_id") or "")
        if exec_id:
            self.fill_ids.add(exec_id)
        if order_id:
            self.order_ids.add(order_id)
        liquidity = str(fill.get("last_liquidity_ind") or "")
        if liquidity == "AddedLiquidity":
            self.maker_qty += qty
        elif liquidity == "RemovedLiquidity":
            self.taker_qty += qty
        order_type = str(fill.get("ord_type") or "")
        if order_type and qty:
            if same_direction(fill, self.direction):
                self.entry_order_types.add(order_type)
            else:
                self.exit_order_types.add(order_type)
        if "Stop" in order_type or fill.get("triggered"):
            self.stop_like_exit = True


def ratio(part: float, whole: float) -> float:
    if not whole:
        return 1.0
    return abs(part) / abs(whole)


def signed_qty(fill: dict[str, object]) -> float:
    qty = abs(float(fill.get("last_qty") or 0.0))
    return qty if fill.get("side") == "Buy" else -qty


def same_direction(fill: dict[str, object], direction: str) -> bool:
    return (direction == "long" and fill.get("side") == "Buy") or (direction == "short" and fill.get("side") == "Sell")


def direction_for_signed(qty: float) -> str:
    return "long" if qty > 0 else "short"


def weighted_average(notional: float, qty: float) -> float:
    if not qty:
        return 0.0
    return notional / qty


def funding_between(events: Iterable[dict[str, object]], start: datetime, end: datetime | None) -> float:
    total = 0.0
    for event in events:
        timestamp = event.get("timestamp")
        if timestamp is None or timestamp < start:
            continue
        if end is not None and timestamp > end:
            continue
        if event.get("type") == "Funding":
            total += float(event.get("amount_xbt") or 0.0)
    return total


def finalize_trade(
    builder: PositionBuilder,
    exit_time: datetime | None,
    orders: list[dict[str, object]],
    funding_events: list[dict[str, object]],
    sequence: int,
) -> ReconstructedTrade:
    funding_xbt = funding_between(funding_events, builder.entry_time, exit_time)
    net_pnl = builder.pnl_xbt - builder.fee_xbt + funding_xbt
    order_context = order_counts_between(orders, builder.symbol, builder.entry_time, exit_time)
    total_quality_qty = builder.maker_qty + builder.taker_qty
    maker_ratio = builder.maker_qty / total_quality_qty if total_quality_qty else 0.0
    taker_ratio = builder.taker_qty / total_quality_qty if total_quality_qty else 0.0
    exit_avg = weighted_average(builder.exit_notional, builder.exit_qty) if builder.exit_qty else None
    holding = (exit_time - builder.entry_time).total_seconds() if exit_time is not None else None
    trade_id = f"{builder.symbol}-{builder.entry_time.strftime('%Y%m%dT%H%M%S')}-{sequence:06d}"
    return ReconstructedTrade(
        trade_id=trade_id,
        symbol=builder.symbol,
        direction=builder.direction,
        entry_time=builder.entry_time,
        exit_time=exit_time,
        holding_seconds=holding,
        entry_avg_price=weighted_average(builder.entry_notional, builder.entry_qty),
        exit_avg_price=exit_avg,
        max_position_size=builder.max_position_size,
        pnl_xbt=builder.pnl_xbt,
        fee_xbt=builder.fee_xbt,
        funding_xbt=funding_xbt,
        net_pnl_xbt=net_pnl,
        order_count=max(len(builder.order_ids), order_context["order_count"]),
        fill_count=len(builder.fill_ids),
        maker_ratio=maker_ratio,
        taker_ratio=taker_ratio,
        add_count=builder.add_count,
        reduce_count=builder.reduce_count,
        cancel_count=order_context["cancel_count"],
        suspected_stop_loss=bool(net_pnl < 0 and builder.stop_like_exit),
        suspected_take_profit=bool(net_pnl > 0 and (builder.reduce_count > 0 or "Limit" in builder.exit_order_types)),
        entry_order_types="|".join(sorted(builder.entry_order_types)),
        exit_order_types="|".join(sorted(builder.exit_order_types)),
        notes="open_position" if exit_time is None else "",
    )


def open_builder(fill: dict[str, object], quantity: float) -> PositionBuilder:
    signed = quantity if fill.get("side") == "Buy" else -quantity
    price = float(fill.get("last_px") or 0.0)
    builder = PositionBuilder(
        symbol=str(fill.get("symbol") or ""),
        direction=direction_for_signed(signed),
        entry_time=fill["timestamp"],
        signed_position=signed,
        entry_notional=abs(quantity) * price,
        entry_qty=abs(quantity),
        max_position_size=abs(quantity),
    )
    builder.add_fee_and_quality(fill, abs(quantity))
    order_type = str(fill.get("ord_type") or "")
    if order_type:
        builder.entry_order_types.add(order_type)
    return builder


def apply_fill_to_builder(builder: PositionBuilder, fill: dict[str, object]) -> tuple[bool, float]:
    fill_signed = signed_qty(fill)
    fill_abs = abs(fill_signed)
    price = float(fill.get("last_px") or 0.0)
    if fill_abs == 0:
        return False, 0.0

    if builder.signed_position == 0 or (builder.signed_position > 0) == (fill_signed > 0):
        previous_abs = builder.abs_position
        builder.signed_position += fill_signed
        builder.entry_notional += fill_abs * price
        builder.entry_qty += fill_abs
        builder.max_position_size = max(builder.max_position_size, builder.abs_position)
        if previous_abs > 0:
            builder.add_count += 1
        builder.add_fee_and_quality(fill, fill_abs)
        return False, 0.0

    closing_qty = min(builder.abs_position, fill_abs)
    remaining = fill_abs - closing_qty
    previous_abs = builder.abs_position
    builder.signed_position += closing_qty if builder.signed_position < 0 else -closing_qty
    builder.exit_qty += closing_qty
    builder.exit_notional += closing_qty * price
    if closing_qty < previous_abs:
        builder.reduce_count += 1
    builder.add_fee_and_quality(fill, closing_qty)
    return builder.abs_position == 0, remaining


def reconstruct_trades(
    fills: list[dict[str, object]],
    orders: list[dict[str, object]],
    funding_events: list[dict[str, object]],
) -> list[ReconstructedTrade]:
    active: dict[str, PositionBuilder] = {}
    trades: list[ReconstructedTrade] = []
    sequence_by_symbol: defaultdict[str, int] = defaultdict(int)
    sorted_fills = sorted((fill for fill in fills if fill.get("timestamp") is not None), key=lambda row: row["timestamp"])

    for fill in sorted_fills:
        symbol = str(fill.get("symbol") or "")
        qty = abs(float(fill.get("last_qty") or 0.0))
        if not symbol or qty == 0:
            continue
        builder = active.get(symbol)
        if builder is None:
            active[symbol] = open_builder(fill, qty)
            continue

        closed, remaining = apply_fill_to_builder(builder, fill)
        if closed:
            sequence_by_symbol[symbol] += 1
            trades.append(finalize_trade(builder, fill["timestamp"], orders, funding_events, sequence_by_symbol[symbol]))
            active.pop(symbol, None)
            if remaining > 0:
                active[symbol] = open_builder(fill, remaining)

    for symbol, builder in active.items():
        sequence_by_symbol[symbol] += 1
        trades.append(finalize_trade(builder, None, orders, funding_events, sequence_by_symbol[symbol]))
    return trades
