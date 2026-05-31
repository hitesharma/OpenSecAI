UV     := uv

.PHONY: install run lint format typecheck clean help

## install: create venv and install all dependencies from lockfile
install:
	$(UV) sync

## run: run the agent against TARGET_DIR (default: set in main.py)
run:
	$(UV) run main.py

## lint: lint with ruff
lint:
	$(UV) run ruff check main.py

## format: format with ruff
format:
	$(UV) run ruff format main.py

## typecheck: type-check with pyright
typecheck:
	$(UV) run pyright main.py

## clean: remove venv and cached files
clean:
	rm -rf .venv __pycache__ *.pyc

## help: list available targets
help:
	@grep -E '^## ' Makefile | sed 's/## /  /'
