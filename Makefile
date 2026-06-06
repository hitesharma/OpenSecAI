UV     := uv
PKG    := opensecai

.PHONY: setup install run run-dep-scan api codegen lint format typecheck clean help build

## setup: run the system setup script (installs system libraries, Node, Rust, Trivy)
setup:
	chmod +x setup.sh
	./setup.sh

## install: create venv and install all dependencies from lockfile
install:
	$(UV) sync

## run: run the default (dep_scan) agent locally — requires PROJECT env var
run: run-dep-scan

## build: run the unified production build script (compile sidecar + build tauri package)
build:
	chmod +x build.sh
	./build.sh

run-dev:
	cd desktop && ENV=dev npm run tauri dev

## run-dep-scan: run the dep_scan agent via the root shim
run-dep-scan:
	$(UV) run main.py

## lint: lint with ruff
lint:
	$(UV) run ruff check main.py $(PKG)

## format: format with ruff
format:
	$(UV) run ruff format main.py $(PKG)

## typecheck: type-check with pyright
typecheck:
	$(UV) run pyright main.py $(PKG)

## api: run the FastAPI sidecar (localhost:8765 by default)
api:
	$(UV) run opensecai-api

## codegen: export Pydantic schemas → schemas-export/ and generate TS types
codegen:
	$(UV) run scripts/export_schemas.py
	cd desktop && npx json-schema-to-typescript schemas-export/ --out src/api/types

## clean: remove venv and cached files
clean:
	rm -rf .venv __pycache__ *.pyc

## help: list available targets
help:
	@grep -E '^## ' Makefile | sed 's/## /  /'
