#!/bin/bash
# Build script for Private Chat
# Copies web files and compiles for all platforms

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"

echo "Syncing web files..."
rm -rf "$SERVER_DIR/web"
cp -r "$SCRIPT_DIR/web" "$SERVER_DIR/web"
rm -rf "$SERVER_DIR/web/assets" 2>/dev/null  # Remove empty dirs

cd "$SERVER_DIR"

echo "Building macOS (arm64)..."
go build -ldflags="-s -w" -o "$SCRIPT_DIR/PrivateChat-macOS" main.go

echo "Building Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "$SCRIPT_DIR/PrivateChat-Windows.exe" main.go

echo "Building Linux (amd64)..."
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "$SCRIPT_DIR/PrivateChat-Linux" main.go

echo ""
echo "Build complete!"
ls -lh "$SCRIPT_DIR"/PrivateChat-*
