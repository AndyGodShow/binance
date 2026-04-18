import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any

from src.ledger_strategy.config.defaults import REQUIRED_FILES
from src.ledger_strategy.data.schema import COMMON_LAYER_SCHEMA, SCHEMA_MAP


def infer_value_type(values: list[str]) -> str:
    clean = [value for value in values if value not in ("", None)]
    if not clean:
        return "empty"
    lowered = {value.lower() for value in clean}
    if lowered <= {"true", "false"}:
        return "boolean"
    numeric = 0
    for value in clean:
        try:
            float(value)
            numeric += 1
        except ValueError:
            pass
    if numeric == len(clean):
        return "number"
    if all("T" in value and (value.endswith("Z") or "+" in value) for value in clean[:20]):
        return "datetime"
    return "string"


def scan_csv(path: Path, sample_size: int = 500) -> dict[str, Any]:
    samples: dict[str, list[str]] = {}
    non_empty: Counter[str] = Counter()
    row_count = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = reader.fieldnames or []
        for column in columns:
            samples[column] = []
        for row in reader:
            row_count += 1
            if row_count <= sample_size:
                for column in columns:
                    value = row.get(column, "")
                    samples[column].append(value)
                    if value != "":
                        non_empty[column] += 1
    mapping = {spec.source: {"canonical": spec.canonical, "semantic_type": spec.semantic_type, "required": spec.required} for spec in SCHEMA_MAP.get(path.name, [])}
    return {
        "file": path.name,
        "exists": True,
        "rows": row_count,
        "columns": [
            {
                "name": column,
                "inferred_type": infer_value_type(samples[column]),
                "sample_non_empty": non_empty[column],
                "mapping": mapping.get(column),
            }
            for column in columns
        ],
        "missing_required_columns": [
            spec.source for spec in SCHEMA_MAP.get(path.name, []) if spec.required and spec.source not in columns
        ],
    }


def scan_dataset(data_dir: Path, required_files: list[str] | None = None) -> dict[str, Any]:
    files = required_files or REQUIRED_FILES
    results = []
    for filename in files:
        path = data_dir / filename
        if not path.exists():
            results.append({"file": filename, "exists": False, "rows": 0, "columns": [], "missing_required_columns": []})
            continue
        if filename.endswith(".csv"):
            results.append(scan_csv(path))
        elif filename.endswith(".json"):
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            results.append({"file": filename, "exists": True, "json_keys": sorted(payload.keys()), "rows": None, "columns": []})
    return {
        "data_dir": str(data_dir),
        "layers": COMMON_LAYER_SCHEMA,
        "files": results,
    }
