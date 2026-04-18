# Ledger Strategy Reverse Engineering

This module turns the public BitMEX/BTC account mirror from `bwjoke/BTC-Trading-Since-2020` into an explainable strategy research pipeline.

## Install

The code runs with Python 3.11+ and the standard library:

```bash
python3 -m unittest tests.test_ledger_strategy
```

Optional packages enable parquet exports:

```bash
pip install -r requirements.txt
```

## Run

Place or download the public dataset files into:

```text
data/external/btc-trading-since-2020-raw
```

Then run:

```bash
bash scripts/run_ledger_strategy.sh
```

Outputs are written to:

```text
data/ledger_strategy
```

Important outputs:

- `schema_scan.json`: raw file field scan and canonical schema mapping.
- `normalized/*.csv`: typed normalized order, execution, wallet, position snapshot, margin snapshot, wallet snapshot and instrument rows.
- `trade_reconstruction/reconstructed_trades.csv`: reconstructed open/add/reduce/close/reversal lifecycle trades.
- `strategy_inference/rules.json`: explainable strategy module parameters.
- `backtest/trades.csv`: rule-filtered simulated trades.
- `backtest/equity_curve.csv`: simulated equity curve.
- `reports/account_attribution.json`: realised PnL, funding, deposits, withdrawals and attribution gap.
- `reports/ledger_strategy_report.md`: generated human-readable report.

## Data Layers

- Raw layer: stable upstream CSV/JSON files are preserved as input.
- Normalized layer: timestamps, quantities, fees and XBt satoshi values are converted into typed canonical rows.
- Event layer: order, execution and wallet rows are reduced to lifecycle events.
- Trade reconstruction layer: fills are replayed into position paths with open, add, reduce, close and reverse handling.
- Strategy inference layer: grouped statistics, path patterns and rule extraction create module parameters.
- Backtest layer: the inferred rule set is replayed as a ledger-context strategy, with market-context hooks reserved.

## Strategy

Default strategy name: `Ledger-Derived BTC Execution Regime Strategy`.

Hypothesis:

The historical ledger contains stable behavioral regimes around timing, side selection, execution style, add/reduce paths, holding time and risk response. The first version extracts these regimes without pretending to have missing OHLCV context. It is a behavior-derived, explainable strategy skeleton that can be upgraded when market data is connected.

Modules:

- Signal module: score side/regime evidence first; inferred UTC windows are a weak confidence bias, not hard filters.
- Sizing module: use median position size, cut risk after loss streaks, penalize add-heavy paths if they underperform.
- Execution module: prefer maker/limit execution when reconstructed maker buckets outperform taker/market-chasing paths.
- Exit module: infer stop-loss and take-profit thresholds from losing/profitable trade distributions.
- Risk module: cap consecutive losses and reserve volatility/funding/open-interest gates for future market context.
- Filter module: allow ledger-only operation now; accept future OHLCV, volatility, funding and open interest providers.

## Extending Market Data

Implement `MarketContextProvider.features_at(symbol, timestamp)` in `src/ledger_strategy/strategy/modules.py` or subclass it in a separate module. The strategy already checks returned feature keys such as:

- `realized_volatility`
- `max_allowed_volatility`
- `funding_rate`
- `open_interest`
- `basis`

This keeps the current pipeline honest: it does not invent unavailable market context, but it is ready to consume it.

## Current Limits

- This is not black-box imitation learning and does not predict the next historical order.
- The ledger-only backtest uses reconstructed trade opportunities; it is not yet a full OHLCV path simulator.
- Time windows are intentionally weak priors. A strong market-regime setup may still pass outside the inferred historical hours.
- Symbol-level funding assignment is limited when wallet funding rows do not carry full position context.
- Deposits, withdrawals, transfers, conversions and spot swaps are explicitly separated from strategy PnL.
