# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect all submodules for dynamic libraries
hiddenimports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',
    'fastapi',
    'starlette',
    'pydantic',
    'pydantic_settings',
    'aiosqlite',
    'sqlalchemy',
    'sqlalchemy.dialects.sqlite',
    'sqlalchemy.ext.asyncio',
    'greenlet',
    'cryptography',
    'httpx',
    'requests',
    'dotenv',
    'app',
    'app.main',
    'app.core',
    'app.core.config',
    'app.core.db',
    'app.api',
    'app.api.routes_affiliate',
    'app.api.routes_editor',
    'app.api.routes_jobs',
    'app.api.routes_library',
    'app.api.routes_license',
    'app.api.routes_localize',
    'app.api.routes_publish',
    'app.api.routes_settings',
    'app.models',
    'app.services',
    'app.services.license_service',
    'app.workers',
]

# Collect submodules for app
hiddenimports += collect_submodules('app')

# Data files (include app files if needed)
datas = [
    ('app', 'app'),
]

a = Analysis(
    ['run_server.py'],
    pathex=['.'],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'test', 'unittest', 'torchvision'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Filter duplicate libraries on macOS / PyInstaller
filtered_binaries = []
seen_targets = set()
for dest, src, type_ in a.binaries:
    # 1. Tránh duplicate destination filenames
    if dest in seen_targets:
        continue
    # 2. Loại bỏ các file libtorch*.dylib bị gom nhầm ra thư mục gốc _internal (gây lỗi duplicate C++ type / GradBucket)
    # Vì torch đã có toàn bộ dylib cần thiết nằm bên trong thư mục torch/lib/
    if dest in ['libtorch.dylib', 'libtorch_cpu.dylib', 'libtorch_python.dylib', 'libc10.dylib', 'libshm.dylib']:
        continue
    seen_targets.add(dest)
    filtered_binaries.append((dest, src, type_))

a.binaries = filtered_binaries

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='video_studio_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='video_studio_backend',
)
