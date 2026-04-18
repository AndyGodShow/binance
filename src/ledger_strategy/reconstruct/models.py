from dataclasses import asdict, dataclass
from datetime import datetime


@dataclass
class ReconstructedTrade:
    trade_id: str
    symbol: str
    direction: str
    entry_time: datetime
    exit_time: datetime | None
    holding_seconds: float | None
    entry_avg_price: float
    exit_avg_price: float | None
    max_position_size: float
    pnl_xbt: float
    fee_xbt: float
    funding_xbt: float
    net_pnl_xbt: float
    order_count: int
    fill_count: int
    maker_ratio: float
    taker_ratio: float
    add_count: int
    reduce_count: int
    cancel_count: int
    suspected_stop_loss: bool
    suspected_take_profit: bool
    entry_order_types: str
    exit_order_types: str
    notes: str = ""

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
