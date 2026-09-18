import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let backendProcess: ChildProcess | null = null;
const BACKEND_PORT = 8765;

/**
 * Spawn Python FastAPI backend as a child process (sidecar).
 * In dev: sử dụng venv Python trong backend/.
 * In production: sử dụng PyInstaller binary.
 */
function spawnBackend() {
  if (backendProcess && !backendProcess.killed) {
    console.log('[Backend] Already running');
    return;
  }

  const isDev = process.env.NODE_ENV !== 'production';
  const fs = require('node:fs');
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'video_studio_backend.exe' : 'video_studio_backend';

  let pythonCmd = '';
  let backendDir = '';
  let runArgs: string[] = [];

  if (isDev) {
    // Robust resolution for dev mode: try multiple relative paths until backend exists
    const candidates = [
      path.join(app.getAppPath(), '..', 'backend'),
      path.join(app.getAppPath(), '..', '..', 'backend'),
      path.join(process.cwd(), '..', 'backend'),
      path.join(process.cwd(), 'backend'),
    ];
    backendDir = candidates.find(p => fs.existsSync(p)) || candidates[0];
    pythonCmd = isWin
      ? path.join(backendDir, 'venv', 'Scripts', 'python.exe')
      : path.join(backendDir, 'venv', 'bin', 'python');

    runArgs = [
      '-m', 'uvicorn', 'app.main:app',
      '--host', '127.0.0.1',
      '--port', String(BACKEND_PORT),
      '--reload',
      '--log-level', 'info',
    ];
  } else {
    // Production: PyInstaller standalone binary
    const candidateDirs = [
      path.join(process.resourcesPath, 'backend', 'video_studio_backend'),
      path.join(process.resourcesPath, 'video_studio_backend'),
      path.join(process.resourcesPath, 'backend'),
    ];

    for (const dir of candidateDirs) {
      const candidateExe = path.join(dir, binaryName);
      if (fs.existsSync(candidateExe)) {
        pythonCmd = candidateExe;
        backendDir = dir;
        break;
      }
    }

    if (!pythonCmd) {
      // Fallback
      backendDir = candidateDirs[0];
      pythonCmd = path.join(backendDir, binaryName);
    }

    // Frozen PyInstaller binary already runs uvicorn inside run_server.py
    runArgs = [];
  }

  if (!isWin && fs.existsSync(pythonCmd)) {
    try {
      fs.chmodSync(pythonCmd, 0o755);
    } catch (err) {
      console.warn('[Backend] chmodSync warning:', err);
    }
  }

  console.log(`[Backend] Spawning: ${pythonCmd} in ${backendDir}`);

  try {
    backendProcess = spawn(
      pythonCmd,
      runArgs,
      {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          BACKEND_PORT: String(BACKEND_PORT),
          BACKEND_HOST: '127.0.0.1',
        },
      }
    );

    backendProcess.on('error', (err) => {
      console.error('[Backend Spawn Error]', err);
    });

    backendProcess.stdout?.on('data', (d: Buffer) => console.log('[Backend]', d.toString()));
    backendProcess.stderr?.on('data', (d: Buffer) => console.error('[Backend]', d.toString()));
    backendProcess.on('exit', (code) => {
      console.log(`[Backend] exited with code ${code}`);
      backendProcess = null;
    });
  } catch (err) {
    console.error('[Backend Failed to spawn]', err);
  }
}

function killBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
    console.log('[Backend] Killed');
  }
}

const createWindow = () => {
  const iconPath = path.join(app.getAppPath(), 'public', 'icon.png');
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',  // macOS native look
    backgroundColor: '#0f1117',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Expose backend port to renderer via environment
  
  // Open external links in user default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.executeJavaScript(
      `window.BACKEND_PORT = ${BACKEND_PORT};`
    );
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('ready', () => {
  spawnBackend();
  // Delay window creation slightly to let backend start
  setTimeout(createWindow, 1500);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  killBackend();
});

app.on('will-quit', () => {
  killBackend();
});

process.on('exit', () => {
  killBackend();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (!backendProcess || backendProcess.killed) {
      spawnBackend();
    }
    createWindow();
  }
});

