@echo off
REM =============================================================
REM build_windows.bat — 1-click build cho Video Studio (Windows)
REM Output: frontend\out\make\squirrel.windows\  → VideoStudioSetup.exe
REM =============================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."
set "BACKEND_DIR=%ROOT_DIR%\backend"
set "FRONTEND_DIR=%ROOT_DIR%\frontend"

echo ================================================
echo   Video Studio - Windows Build
echo   Root: %ROOT_DIR%
echo ================================================

REM ── Step 1: Kiểm tra Python ──────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Khong tim thay Python. Vui long cai Python 3.10+ truoc.
  pause
  exit /b 1
)

REM ── Step 2: Tao venv neu chua co ─────────────────────────────
echo [1/5] Kiem tra virtual environment...
if not exist "%BACKEND_DIR%\venv" (
  echo [1/5] Tao Python virtual environment...
  python -m venv "%BACKEND_DIR%\venv"
)

REM ── Step 3: Cai dat backend deps ──────────────────────────────
echo [2/5] Cai dat backend dependencies...
call "%BACKEND_DIR%\venv\Scripts\pip.exe" install -q --upgrade pip
call "%BACKEND_DIR%\venv\Scripts\pip.exe" install -q -r "%BACKEND_DIR%\requirements.txt"
call "%BACKEND_DIR%\venv\Scripts\pip.exe" install -q pyinstaller

REM ── Step 4: PyInstaller ───────────────────────────────────────
echo [3/5] Build Python backend voi PyInstaller...
pushd "%BACKEND_DIR%"
call "%BACKEND_DIR%\venv\Scripts\pyinstaller.exe" ^
  --clean ^
  --noconfirm ^
  "%BACKEND_DIR%\video_studio.spec"
popd
echo [3/5] Backend binary: %BACKEND_DIR%\dist\video_studio_backend\

REM ── Step 5: Node.js deps ─────────────────────────────────────
echo [4/5] Cai dat Node.js dependencies...
pushd "%FRONTEND_DIR%"
call npm install --silent

REM ── Step 6: Electron Forge make ──────────────────────────────
echo [5/5] Build Electron app (Windows)...
call npm run make -- --platform win32
popd

echo.
echo ================================================
echo   Build hoan tat!
echo   Output: %FRONTEND_DIR%\out\make\squirrel.windows\
echo.
echo   Zalo ho tro: 0386.690.764 (Cao Trieu)
echo ================================================
pause
