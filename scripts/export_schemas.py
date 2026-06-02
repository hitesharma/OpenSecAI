#!/usr/bin/env python3
"""Export Pydantic models in opensecai/schemas/ to JSON Schema files in schemas-export/.

Run via:  uv run scripts/export_schemas.py
          make codegen
"""

import importlib
import inspect
import json
import pkgutil
from pathlib import Path

import opensecai.schemas as schemas_pkg
from pydantic import BaseModel

SCHEMAS_EXPORT = Path(__file__).parent.parent / "schemas-export"
SCHEMAS_EXPORT.mkdir(exist_ok=True)


def _iter_models():
    for mod_info in pkgutil.iter_modules(schemas_pkg.__path__, prefix="opensecai.schemas."):
        mod = importlib.import_module(mod_info.name)
        for _name, obj in inspect.getmembers(mod, inspect.isclass):
            if issubclass(obj, BaseModel) and obj is not BaseModel and obj.__module__ == mod_info.name:
                yield obj


def main():
    exported = []
    for model in _iter_models():
        schema = model.model_json_schema()
        filename = f"{_to_snake(model.__name__)}.json"
        out = SCHEMAS_EXPORT / filename
        out.write_text(json.dumps(schema, indent=2) + "\n")
        print(f"  wrote {out.relative_to(Path.cwd())}")
        exported.append(filename)

    print(f"\n✅ Exported {len(exported)} schema(s) to {SCHEMAS_EXPORT.relative_to(Path.cwd())}/")


def _to_snake(name: str) -> str:
    import re
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


if __name__ == "__main__":
    main()
