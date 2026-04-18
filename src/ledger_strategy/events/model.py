from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class TradingEvent:
    event_id: str
    event_type: str
    timestamp: datetime
    symbol: str = ""
    side: str = ""
    quantity: float = 0.0
    price: float = 0.0
    order_id: str = ""
    exec_id: str = ""
    amount_xbt: float = 0.0
    metadata: dict[str, object] | None = None
