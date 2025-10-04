#!/bin/bash
# Setup script for tree-sitter WASM language files

set -e

# Create wasm directory
WASM_DIR="./public/wasm"
mkdir -p "$WASM_DIR"

echo "📦 Setting up tree-sitter language WASM files..."

# Function to download WASM file
download_wasm() {
    local language=$1
    local url=$2
    local filename=$3

    if [ -f "$WASM_DIR/$filename" ]; then
        echo "✓ $language already installed"
    else
        echo "⬇️  Downloading $language..."
        curl -L -o "$WASM_DIR/$filename" "$url" || {
            echo "❌ Failed to download $language"
            return 1
        }
        echo "✅ $language installed"
    fi
}

# Download language WASM files from jsdelivr CDN
# These are pre-compiled WASM files from tree-sitter project

download_wasm "TypeScript" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-typescript@0.20.1/tree-sitter-typescript.wasm" \
    "tree-sitter-typescript.wasm"

download_wasm "JavaScript" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-javascript@0.20.1/tree-sitter-javascript.wasm" \
    "tree-sitter-javascript.wasm"

download_wasm "Python" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-python@0.20.1/tree-sitter-python.wasm" \
    "tree-sitter-python.wasm"

download_wasm "JSON" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-json@0.20.0/tree-sitter-json.wasm" \
    "tree-sitter-json.wasm"

download_wasm "Rust" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-rust@0.20.1/tree-sitter-rust.wasm" \
    "tree-sitter-rust.wasm"

download_wasm "Go" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-go@0.19.1/tree-sitter-go.wasm" \
    "tree-sitter-go.wasm"

download_wasm "Java" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-java@0.20.0/tree-sitter-java.wasm" \
    "tree-sitter-java.wasm"

download_wasm "C" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-c@0.20.2/tree-sitter-c.wasm" \
    "tree-sitter-c.wasm"

download_wasm "C++" \
    "https://cdn.jsdelivr.net/npm/tree-sitter-cpp@0.20.0/tree-sitter-cpp.wasm" \
    "tree-sitter-cpp.wasm"

echo ""
echo "🎉 Tree-sitter WASM setup complete!"
echo "📂 WASM files location: $WASM_DIR"
echo ""
echo "Note: For production use, consider hosting these files locally"
echo "or using a build process to bundle them with the application."