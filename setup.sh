#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "=========================================="
echo "OpenSecAI Installation Script for Linux"
echo "=========================================="

# 1. Check & Install System Libraries
DEPS=(
    "build-essential"
    "pkg-config"
    "git"
    "curl"
    "wget"
    "file"
    "libssl-dev"
    "libgtk-3-dev"
    "libayatana-appindicator3-dev"
    "librsvg2-dev"
    "libwebkit2gtk-4.1-dev"
    "libsoup-3.0-dev"
)

echo ""
echo "Step 1: Checking system library dependencies..."
MISSING_DEPS=()
for dep in "${DEPS[@]}"; do
    if dpkg -s "$dep" 2>/dev/null | grep -q "ok installed"; then
        echo "  [✓] $dep is already installed."
    else
        echo "  [✗] $dep is missing."
        MISSING_DEPS+=("$dep")
    fi
done

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
    echo "Installing missing system libraries..."
    sudo apt-get update
    sudo apt-get install -y "${MISSING_DEPS[@]}"
else
    echo "All system libraries are already installed."
fi

# 2. Check & Install Node.js
echo ""
echo "Step 2: Checking Node.js..."
if command -v node &> /dev/null; then
    echo "  [✓] Node.js is already installed ($(node -v))."
else
    NODE_VERSION="25.9.0"
    echo "  [✗] Node.js is missing. Installing Node.js v${NODE_VERSION}..."
    
    # Detect system architecture
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64) ARCH_SUFFIX="x64" ;;
        aarch64) ARCH_SUFFIX="arm64" ;;
        *) echo "Unsupported architecture for Node.js: $ARCH"; exit 1 ;;
    esac

    NODE_DIR="node-v${NODE_VERSION}-linux-${ARCH_SUFFIX}"
    NODE_TAR="${NODE_DIR}.tar.xz"
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}"

    echo "Downloading Node.js v${NODE_VERSION}..."
    curl -fsSL -O "$NODE_URL"
    
    echo "Extracting archive..."
    tar -xf "$NODE_TAR"
    
    echo "Installing to /usr/local..."
    sudo cp -r "$NODE_DIR"/{bin,include,lib,share} /usr/local/
    
    # Clean up downloaded files
    rm -rf "$NODE_DIR" "$NODE_TAR"
    
    echo "Node.js v${NODE_VERSION} installed successfully!"
fi

# 3. Check & Install Rust
echo ""
echo "Step 3: Checking Rust..."
if command -v rustc &> /dev/null; then
    echo "  [✓] Rust is already installed ($(rustc --version))."
else
    echo "  [✗] Rust is missing. Installing via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # Load rust environment
    source "$HOME/.cargo/env"
    echo "Rust successfully installed!"
fi

# 4. Check & Install Trivy
echo ""
echo "Step 4: Checking Trivy..."
if command -v trivy &> /dev/null; then
    echo "  [✓] Trivy is already installed ($(trivy --version | head -n 1))."
else
    echo "  [✗] Trivy is missing. Installing Trivy..."
    sudo apt-get install -y apt-transport-https gnupg lsb-release wget
    # Add Aquasecurity Trivy keyring and source list
    wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor | sudo tee /usr/share/keyrings/trivy.gpg > /dev/null
    echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | sudo tee /etc/apt/sources.list.d/trivy.list
    sudo apt-get update
    sudo apt-get install -y trivy
    echo "Trivy successfully installed!"
fi

# 5. Check & Install Astral uv
echo ""
echo "Step 5: Checking uv..."
if command -v uv &> /dev/null || [ -f "$HOME/.local/bin/uv" ]; then
    echo "  [✓] uv is already installed."
else
    echo "  [✗] uv is missing. Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    echo "uv successfully installed!"
fi

# Resolve uv path for sync step
UV_BIN="uv"
if [ -f "$HOME/.local/bin/uv" ]; then
    UV_BIN="$HOME/.local/bin/uv"
fi

# 6. Sync Python Virtual Environment via uv
echo ""
echo "Step 6: Syncing python environment..."
if [ -f "pyproject.toml" ]; then
    echo "Found pyproject.toml. Syncing python venv..."
    "$UV_BIN" sync
    echo "Python environment successfully synced!"
else
    echo "pyproject.toml not found. Skipping python sync."
fi

# 7. Check & Install Frontend Node Modules
echo ""
echo "Step 7: Checking frontend node modules..."
if [ -d "desktop" ]; then
    if [ ! -d "desktop/node_modules" ]; then
        echo "desktop/node_modules is missing. Running npm install in desktop/..."
        (cd desktop && npm install)
        echo "Frontend node modules successfully installed!"
    else
        echo "  [✓] desktop/node_modules is already installed."
    fi
else
    echo "desktop directory not found. Skipping frontend Node modules setup."
fi

echo ""
echo "=========================================="
echo " Verification completed successfully!     "
echo "=========================================="
