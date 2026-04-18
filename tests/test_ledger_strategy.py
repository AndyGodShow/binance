from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from src.ledger_strategy.normalize.bitmex import (
    normalize_instrument_rows,
    normalize_margin_snapshot_rows,
    normalize_position_snapshot_rows,
    normalize_wallet_rows,
    normalize_wallet_snapshot_rows,
)
from src.ledger_strategy.backtest.engine import run_backtest
from src.ledger_strategy.inference.rules import infer_strategy_rules
from src.ledger_strategy.reconstruct.engine import reconstruct_trades
from src.ledger_strategy.reconstruct.models import ReconstructedTrade
from src.ledger_strategy.reports.attribution import build_attribution
from src.ledger_strategy.strategy.modules import LedgerDerivedStrategy


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def fill(
    time: str,
    side: str,
    qty: float,
    price: float,
    *,
    symbol: str = "XBTUSD",
    order_id: str = "o",
    exec_id: str = "e",
    liquidity: str = "AddedLiquidity",
    fee_xbt: float = 0.0,
    realised_pnl_xbt: float = 0.0,
    ord_type: str = "Limit",
):
    return {
        "timestamp": ts(time),
        "symbol": symbol,
        "side": side,
        "last_qty": qty,
        "last_px": price,
        "order_id": order_id,
        "exec_id": exec_id,
        "last_liquidity_ind": liquidity,
        "fee_xbt": fee_xbt,
        "realised_pnl_xbt": realised_pnl_xbt,
        "ord_type": ord_type,
    }


class LedgerStrategyTests(unittest.TestCase):
    def test_reconstructs_add_reduce_lifecycle_with_execution_quality(self):
        trades = reconstruct_trades(
            [
                fill("2024-01-01T00:00:00Z", "Buy", 10, 100, order_id="o1", exec_id="e1"),
                fill("2024-01-01T00:01:00Z", "Buy", 5, 110, order_id="o2", exec_id="e2"),
                fill(
                    "2024-01-01T00:02:00Z",
                    "Sell",
                    8,
                    120,
                    order_id="o3",
                    exec_id="e3",
                    liquidity="RemovedLiquidity",
                    realised_pnl_xbt=0.01,
                ),
                fill(
                    "2024-01-01T00:03:00Z",
                    "Sell",
                    7,
                    130,
                    order_id="o4",
                    exec_id="e4",
                    realised_pnl_xbt=0.02,
                ),
            ],
            orders=[],
            funding_events=[],
        )

        self.assertEqual(len(trades), 1)
        trade = trades[0]
        self.assertEqual(trade.direction, "long")
        self.assertAlmostEqual(trade.entry_avg_price, 103.33333333333333)
        self.assertAlmostEqual(trade.exit_avg_price, 124.66666666666667)
        self.assertEqual(trade.max_position_size, 15)
        self.assertEqual(trade.add_count, 1)
        self.assertEqual(trade.reduce_count, 1)
        self.assertEqual(trade.order_count, 4)
        self.assertEqual(trade.fill_count, 4)
        self.assertAlmostEqual(trade.maker_ratio, 22 / 30)
        self.assertAlmostEqual(trade.taker_ratio, 8 / 30)
        self.assertAlmostEqual(trade.net_pnl_xbt, 0.03)

    def test_reconstructs_reversal_as_closed_trade_and_new_position(self):
        trades = reconstruct_trades(
            [
                fill("2024-01-01T00:00:00Z", "Buy", 10, 100, order_id="o1", exec_id="e1"),
                fill("2024-01-01T00:01:00Z", "Sell", 15, 95, order_id="o2", exec_id="e2"),
            ],
            orders=[],
            funding_events=[],
        )

        self.assertEqual(len(trades), 2)
        self.assertEqual(trades[0].direction, "long")
        self.assertEqual(trades[0].exit_avg_price, 95)
        self.assertEqual(trades[0].reduce_count, 0)
        self.assertEqual(trades[1].direction, "short")
        self.assertEqual(trades[1].entry_avg_price, 95)
        self.assertIsNone(trades[1].exit_time)

    def test_wallet_attribution_keeps_cashflows_out_of_strategy_pnl(self):
        table = build_attribution(
            [
                {"timestamp": ts("2024-01-01T00:00:00Z"), "type": "Deposit", "amount_xbt": 1.0, "fee_xbt": 0.0},
                {"timestamp": ts("2024-01-02T00:00:00Z"), "type": "RealisedPNL", "amount_xbt": 0.2, "fee_xbt": 0.0},
                {"timestamp": ts("2024-01-03T00:00:00Z"), "type": "Funding", "amount_xbt": -0.01, "fee_xbt": 0.0},
                {"timestamp": ts("2024-01-04T00:00:00Z"), "type": "Withdrawal", "amount_xbt": -0.5, "fee_xbt": -0.001},
            ],
            equity_rows=[
                {"timestamp": ts("2024-01-01T00:00:00Z"), "adjusted_wealth_xbt": 1.0},
                {"timestamp": ts("2024-01-04T00:00:00Z"), "adjusted_wealth_xbt": 1.19},
            ],
        )

        self.assertAlmostEqual(table["realised_pnl_xbt"], 0.2)
        self.assertAlmostEqual(table["funding_xbt"], -0.01)
        self.assertAlmostEqual(table["deposit_xbt"], 1.0)
        self.assertAlmostEqual(table["withdrawal_xbt"], -0.5)
        self.assertAlmostEqual(table["external_cashflow_xbt"], 0.5)
        self.assertAlmostEqual(table["ledger_strategy_pnl_xbt"], 0.19)

    def test_wallet_normalization_does_not_treat_non_xbt_native_amounts_as_xbt(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "wallet.csv"
            path.write_text(
                "timestamp,transactTime,transactType,transactStatus,currency,network,amount,fee,walletBalance,orderID,transactID,address,marginBalance\n"
                "2024-01-01T00:00:00Z,2024-01-01T00:00:00Z,Transfer,Completed,USDt,,1000000,,1000000,,t1,,\n"
                "2024-01-02T00:00:00Z,2024-01-02T00:00:00Z,RealisedPNL,Completed,XBt,,100000000,,100000000,,t2,,\n",
                encoding="utf-8",
            )

            rows = normalize_wallet_rows(path)

        self.assertEqual(rows[0]["amount_xbt"], 0.0)
        self.assertEqual(rows[0]["amount_native"], 1000000.0)
        self.assertEqual(rows[1]["amount_xbt"], 1.0)

    def test_snapshot_and_instrument_normalizers_parse_core_files(self):
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            position_path = base / "position.csv"
            position_path.write_text(
                "timestamp,symbol,currency,currentQty,avgEntryPrice,markPrice,realisedPnl,unrealisedPnl,isOpen,leverage,riskValue\n"
                "2024-01-01T00:00:00Z,XBTUSD,XBt,100,20000,20100,100000000,-50000000,true,3,250000000\n",
                encoding="utf-8",
            )
            margin_path = base / "margin.csv"
            margin_path.write_text(
                "timestamp,currency,walletBalance,marginBalance,availableMargin,realisedPnl,unrealisedPnl,marginUsedPcnt\n"
                "2024-01-01T00:00:00Z,XBt,200000000,150000000,100000000,10000000,-5000000,0.25\n",
                encoding="utf-8",
            )
            wallet_snapshot_path = base / "wallet_snapshot.csv"
            wallet_snapshot_path.write_text(
                "timestamp,currency,amount,deposited,withdrawn,transferIn,transferOut,pendingCredit,pendingDebit,confirmedDebit\n"
                "2024-01-01T00:00:00Z,XBt,200000000,300000000,-100000000,50000000,-25000000,0,0,0\n",
                encoding="utf-8",
            )
            instrument_path = base / "instrument.csv"
            instrument_path.write_text(
                "symbol,state,typ,timestamp,underlying,quoteCurrency,settlCurrency,isInverse,makerFee,takerFee,fundingRate,markPrice,lastPrice,openInterest,volume24h,turnover24h\n"
                "XBTUSD,Open,FFWCSX,2024-01-01T00:00:00Z,XBT,USD,XBt,true,-0.00025,0.00075,0.0001,20100,20090,1000,2000,300000000\n",
                encoding="utf-8",
            )

            positions = normalize_position_snapshot_rows(position_path)
            margins = normalize_margin_snapshot_rows(margin_path)
            wallets = normalize_wallet_snapshot_rows(wallet_snapshot_path)
            instruments = normalize_instrument_rows(instrument_path)

        self.assertEqual(positions[0]["symbol"], "XBTUSD")
        self.assertAlmostEqual(positions[0]["realised_pnl_xbt"], 1.0)
        self.assertAlmostEqual(positions[0]["unrealised_pnl_xbt"], -0.5)
        self.assertAlmostEqual(margins[0]["wallet_balance_xbt"], 2.0)
        self.assertAlmostEqual(wallets[0]["deposited_xbt"], 3.0)
        self.assertEqual(instruments[0]["symbol"], "XBTUSD")
        self.assertAlmostEqual(instruments[0]["funding_rate"], 0.0001)

    def test_attribution_reads_camel_case_derived_equity_columns(self):
        table = build_attribution(
            [{"timestamp": ts("2024-01-02T00:00:00Z"), "type": "RealisedPNL", "amount_xbt": 0.2, "fee_xbt": 0.0}],
            equity_rows=[
                {"timestamp": ts("2024-01-01T00:00:00Z"), "transactTime": 0.0, "adjustedWealthXBT": 1.0},
                {"timestamp": ts("2024-01-02T00:00:00Z"), "transactTime": 0.0, "adjustedWealthXBT": 1.2},
            ],
        )

        self.assertAlmostEqual(table["equity_curve_change_xbt"], 0.2)

    def test_backtest_halts_before_negative_equity_recovery(self):
        trade = ReconstructedTrade(
            trade_id="t1",
            symbol="XBTUSD",
            direction="long",
            entry_time=ts("2024-01-01T00:00:00Z"),
            exit_time=ts("2024-01-01T01:00:00Z"),
            holding_seconds=3600,
            entry_avg_price=100,
            exit_avg_price=90,
            max_position_size=1,
            pnl_xbt=-2.0,
            fee_xbt=0.0,
            funding_xbt=0.0,
            net_pnl_xbt=-2.0,
            order_count=1,
            fill_count=2,
            maker_ratio=1.0,
            taker_ratio=0.0,
            add_count=0,
            reduce_count=0,
            cancel_count=0,
            suspected_stop_loss=True,
            suspected_take_profit=False,
            entry_order_types="Limit",
            exit_order_types="Market",
        )
        rules = {
            "entry_rules": {"preferred_symbols": ["XBTUSD"], "allowed_entry_hours_utc": [0]},
            "execution_rules": {"prefer_maker": False},
            "exit_rules": {},
            "risk_rules": {"max_consecutive_losses": 3},
        }

        result = run_backtest([trade], LedgerDerivedStrategy(rules), initial_equity_xbt=1.0)

        self.assertTrue(result["metrics"]["halted"])
        self.assertGreaterEqual(result["metrics"]["final_equity_xbt"], 0.05)

    def test_strategy_signal_respects_inferred_direction_filter(self):
        trade = ReconstructedTrade(
            trade_id="t1",
            symbol="XBTUSD",
            direction="long",
            entry_time=ts("2024-01-01T00:00:00Z"),
            exit_time=ts("2024-01-01T01:00:00Z"),
            holding_seconds=3600,
            entry_avg_price=100,
            exit_avg_price=101,
            max_position_size=1,
            pnl_xbt=0.1,
            fee_xbt=0.0,
            funding_xbt=0.0,
            net_pnl_xbt=0.1,
            order_count=1,
            fill_count=2,
            maker_ratio=1.0,
            taker_ratio=0.0,
            add_count=0,
            reduce_count=0,
            cancel_count=0,
            suspected_stop_loss=False,
            suspected_take_profit=True,
            entry_order_types="Limit",
            exit_order_types="Limit",
        )
        rules = {
            "entry_rules": {
                "preferred_symbols": ["XBTUSD"],
                "allowed_entry_hours_utc": [0],
                "allowed_directions": ["short"],
            },
            "execution_rules": {"prefer_maker": False},
            "exit_rules": {},
            "risk_rules": {},
        }

        self.assertFalse(LedgerDerivedStrategy(rules).signal(trade))

    def test_strategy_signal_treats_direction_specific_entry_windows_as_weak_bias(self):
        trade = ReconstructedTrade(
            trade_id="t1",
            symbol="XBTUSD",
            direction="long",
            entry_time=ts("2024-01-01T01:00:00Z"),
            exit_time=ts("2024-01-01T02:00:00Z"),
            holding_seconds=3600,
            entry_avg_price=100,
            exit_avg_price=101,
            max_position_size=1,
            pnl_xbt=0.1,
            fee_xbt=0.0,
            funding_xbt=0.0,
            net_pnl_xbt=0.1,
            order_count=1,
            fill_count=2,
            maker_ratio=1.0,
            taker_ratio=0.0,
            add_count=0,
            reduce_count=0,
            cancel_count=0,
            suspected_stop_loss=False,
            suspected_take_profit=True,
            entry_order_types="Limit",
            exit_order_types="Limit",
        )
        rules = {
            "entry_rules": {
                "preferred_symbols": ["XBTUSD"],
                "allowed_entry_hours_utc": [1, 22],
                "allowed_directions": ["long", "short"],
                "directional_entry_windows": {"short": [1], "long": [22]},
            },
            "execution_rules": {"prefer_maker": False},
            "exit_rules": {},
            "risk_rules": {},
        }

        self.assertTrue(LedgerDerivedStrategy(rules).signal(trade))

    def test_inference_extracts_direction_specific_entry_windows(self):
        def trade(trade_id: str, direction: str, hour: int, pnl: float) -> ReconstructedTrade:
            return ReconstructedTrade(
                trade_id=trade_id,
                symbol="XBTUSD",
                direction=direction,
                entry_time=ts(f"2024-01-01T{hour:02d}:00:00Z"),
                exit_time=ts(f"2024-01-01T{hour:02d}:30:00Z"),
                holding_seconds=1800,
                entry_avg_price=100,
                exit_avg_price=101,
                max_position_size=1,
                pnl_xbt=pnl,
                fee_xbt=0.0,
                funding_xbt=0.0,
                net_pnl_xbt=pnl,
                order_count=1,
                fill_count=2,
                maker_ratio=1.0,
                taker_ratio=0.0,
                add_count=0,
                reduce_count=0,
                cancel_count=0,
                suspected_stop_loss=pnl < 0,
                suspected_take_profit=pnl > 0,
                entry_order_types="Limit",
                exit_order_types="Limit",
            )

        sample = (
            [trade(f"s{i}", "short", 1, 0.01) for i in range(8)] +
            [trade(f"l{i}", "long", 22, 0.01) for i in range(8)] +
            [trade(f"bad{i}", "short", 22, -0.01) for i in range(8)]
        )

        rules = infer_strategy_rules(sample)

        windows = rules["entry_rules"]["directional_entry_windows"]
        self.assertEqual(windows["short"], [1])
        self.assertEqual(windows["long"], [22])
        self.assertEqual(rules["entry_rules"]["time_filter_mode"], "weak_bonus")

    def test_inference_extracts_execution_path_quality_beyond_time_windows(self):
        def trade(trade_id: str, maker_ratio: float, order_types: str, add_count: int, pnl: float) -> ReconstructedTrade:
            return ReconstructedTrade(
                trade_id=trade_id,
                symbol="XBTUSD",
                direction="short",
                entry_time=ts("2024-01-01T09:00:00Z"),
                exit_time=ts("2024-01-01T10:00:00Z"),
                holding_seconds=3600,
                entry_avg_price=100,
                exit_avg_price=99,
                max_position_size=1,
                pnl_xbt=pnl,
                fee_xbt=0.0,
                funding_xbt=0.0,
                net_pnl_xbt=pnl,
                order_count=2,
                fill_count=2,
                maker_ratio=maker_ratio,
                taker_ratio=1 - maker_ratio,
                add_count=add_count,
                reduce_count=0,
                cancel_count=0,
                suspected_stop_loss=pnl < 0,
                suspected_take_profit=pnl > 0,
                entry_order_types=order_types,
                exit_order_types="Limit",
            )

        sample = (
            [trade(f"maker{i}", 0.85, "Limit", 0, 0.02) for i in range(8)] +
            [trade(f"taker{i}", 0.0, "Market", 1, -0.01) for i in range(8)]
        )

        rules = infer_strategy_rules(sample)

        self.assertGreater(
            rules["execution_rules"]["maker_ratio_quality"]["maker_70_plus"]["profit_factor"],
            rules["execution_rules"]["maker_ratio_quality"]["maker_below_20"]["profit_factor"],
        )
        self.assertEqual(rules["execution_rules"]["entry_order_type_quality"]["Limit"]["count"], 8)
        self.assertTrue(rules["risk_rules"]["block_taker_chasing"])


if __name__ == "__main__":
    unittest.main()
