#!/usr/bin/env bash
set -euo pipefail

python3 -m src.ledger_strategy.cli --config config/ledger_strategy.yaml "$@"
