#!/bin/bash
# OpenSecAI Production Build Script
# Combines Python sidecar compilation (PyInstaller) and Tauri desktop application packaging.

set -e

# Resolve script directory to allow running from any CWD
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Force ENV to prod for production packaging
export ENV=prod

echo "=================================================="
echo " Starting OpenSecAI Production Build Pipeline"
echo "=================================================="

# 1. Sync Python dependencies
echo ""
echo "--- Step 1: Syncing Python dependencies via uv ---"
if command -v uv &> /dev/null; then
    uv sync
else
    echo "Error: 'uv' is not installed or not in PATH. Please run setup.sh first."
    exit 1
fi

# 2. Compile Python FastAPI Sidecar using PyInstaller
echo ""
echo "--- Step 2: Compiling Python FastAPI sidecar ---"
uv run pyinstaller --clean --onefile --name opensecai-api \
  --collect-all opensecai \
  --collect-all uvicorn \
  --collect-all fastapi \
  --collect-all langgraph \
  --collect-all langchain \
  opensecai/api/__main__.py

# 3. Copy compiled sidecar to Tauri source directory
echo ""
echo "--- Step 3: Copying sidecar executable to Tauri folder ---"
mkdir -p desktop/src-tauri
cp dist/opensecai-api desktop/src-tauri/opensecai-api
echo "Successfully copied sidecar to desktop/src-tauri/opensecai-api"

# 4. Install Frontend Dependencies
echo ""
echo "--- Step 4: Installing frontend Node modules ---"
cd desktop
npm install

# 5. Build Tauri Desktop Application Bundle
echo ""
echo "--- Step 5: Packaging Tauri production build ---"
npm run tauri build

echo ""
echo "=================================================="
echo " OpenSecAI Production Build Completed Successfully!"
echo "=================================================="
echo "Bundled packages are available in:"
echo "  $REPO_ROOT/desktop/src-tauri/target/release/bundle/"
echo "=================================================="
