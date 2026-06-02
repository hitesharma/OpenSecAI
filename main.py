"""Local entrypoint shim — delegates to the dep_scan agent runner.

Kept at the repo root so existing workflows (`python main.py`, `make run`,
`uv run opensecai`) keep working while the codebase migrates into the
`opensecai/` package. New agents should be added under `opensecai/agents/`
and invoked through their own runners (or, later, the API/dispatcher).
"""
from opensecai.agents.dep_scan.runner import main

if __name__ == "__main__":
    main()
