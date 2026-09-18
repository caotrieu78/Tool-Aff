#!/usr/bin/env bash
# =============================================================
# build_mac.sh — 1-click build cho Video Studio (macOS)
# Output: frontend/out/make/zip/darwin/  → VideoStudio-x.y.z-darwin-*.zip
# =============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo "================================================"
echo "  🎬 Video Studio — macOS Build"
echo "  Root: $ROOT_DIR"
echo "================================================"

# ── Step 1: Install Python deps if venv missing ──────────────
if [ ! -d "$BACKEND_DIR/venv" ]; then
  echo "[1/5] Creating Python virtual environment..."
  python3 -m venv "$BACKEND_DIR/venv"
  echo "[1/5] Installing backend dependencies..."
  "$BACKEND_DIR/venv/bin/pip" install -q --upgrade pip
  "$BACKEND_DIR/venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
fi

# Ensure PyInstaller is available
if "$BACKEND_DIR/venv/bin/python" -m PyInstaller --version >/dev/null 2>&1; then
  PYINSTALLER_CMD="$BACKEND_DIR/venv/bin/python -m PyInstaller"
elif which pyinstaller >/dev/null 2>&1; then
  PYINSTALLER_CMD="$(which pyinstaller)"
else
  echo "[ERROR] Không tìm thấy pyinstaller trong venv hoặc system!"
  exit 1
fi
echo "[1/5] Dùng PyInstaller: $PYINSTALLER_CMD"

# ── Step 2: PyInstaller — build Python backend binary ────────
echo "[2/5] Building Python backend with PyInstaller..."
cd "$BACKEND_DIR"
"$BACKEND_DIR/venv/bin/python" -m PyInstaller \
  --clean \
  --noconfirm \
  "$BACKEND_DIR/video_studio.spec"

echo "[2/5] ✅ Backend binary: $BACKEND_DIR/dist/video_studio_backend/"

# ── Step 3: Install Node.js deps ──────────────────────────────
echo "[3/5] Installing Node.js dependencies..."
cd "$FRONTEND_DIR"
npm install --silent

# ── Step 4: Electron Forge — make macOS package ───────────────
echo "[4/5] Building Electron app (macOS)..."
cd "$FRONTEND_DIR"
npm run make -- --platform darwin

# ── Step 5: Summary ───────────────────────────────────────────
echo ""
echo "================================================"
echo "  ✅ Build hoàn tất!"
echo ""
find "$FRONTEND_DIR/out/make" -name "*.zip" -o -name "*.dmg" 2>/dev/null | while read -r f; do
  SIZE=$(du -sh "$f" | cut -f1)
  echo "  📦 $SIZE  $(basename "$f")"
  echo "  📁 $f"
done
echo ""
echo "  Zalo hỗ trợ: 0386.690.764 (Cao Triều)"
echo "================================================"
