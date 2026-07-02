const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { startBackend, stopBackend, checkHealth } = require('./backend-loader.cjs');

const CONFIG_FILE = path.join(app.getPath('userData'), 'app-config.json');

let setupWindow = null;
let mainWindow = null;
let appConfig = null;

// ── Config helpers ──────────────────────────────────────────────

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('Could not load config:', e.message);
  }
  return null;
}

function saveConfig(config) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Could not save config:', e.message);
  }
}

// ── Setup Window ────────────────────────────────────────────────

function showSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 500,
    resizable: false,
    frame: false,
    transparent: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    title: 'Al-Muttahida ERP - Setup',
  });

  setupWindow.loadFile(path.join(__dirname, 'setup.html'));

  setupWindow.on('closed', () => {
    setupWindow = null;
    // If no main window was opened, quit the app
    if (!mainWindow) app.quit();
  });
}

// ── Main Application Window ─────────────────────────────────────

function createMainWindow(apiBaseUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Al Muttahida ERP',
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Load the built frontend (dist/index.html)
    // Inject the API base URL into the page
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

    if (fs.existsSync(indexPath)) {
      // Read HTML and inject the API URL as a global variable
      let html = fs.readFileSync(indexPath, 'utf-8');
      const injectScript = `<script>window.__API_BASE_URL__="${apiBaseUrl}";</script>`;
      html = html.replace('<head>', `<head>${injectScript}`);

      // Write to a temp file and load it
      const tempPath = path.join(app.getPath('userData'), 'index.html');
      fs.writeFileSync(tempPath, html, 'utf-8');
      mainWindow.loadFile(tempPath);
    } else {
      // Fallback: try loading the URL directly
      mainWindow.loadURL(apiBaseUrl.replace(':4000', ':5173'));
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC: Handle setup choices ───────────────────────────────────

ipcMain.on('start-app', async (event, config) => {
  const { mode, serverIp } = config;

  try {
    if (mode === 'server') {
      // Server mode: start the backend, then open the main window
      if (event.sender && setupWindow) {
        event.sender.send('setup-status', 'جاري تشغيل السيرفر...');
      }

      const port = await startBackend();
      const apiUrl = `http://127.0.0.1:${port}`;

      // Save config so next time it auto-starts as server
      saveConfig({ mode: 'server', port });

      // Close setup and open main window
      if (setupWindow) setupWindow.close();
      createMainWindow(apiUrl);

    } else if (mode === 'client') {
      // Client mode: verify the server is reachable, then open the main window
      const apiUrl = `http://${serverIp}:4000`;

      if (event.sender && setupWindow) {
        event.sender.send('setup-status', 'جاري الاتصال بالسيرفر...');
      }

      // Check if server is reachable
      try {
        await checkHealth(`${apiUrl}/health`);
      } catch (err) {
        if (event.sender) {
          event.sender.send('setup-error', `لا يمكن الاتصال بالسيرفر على ${serverIp}. تأكد أن السيرفر شغال والجهازين على نفس الشبكة.`);
        }
        return;
      }

      // Save config so next time it auto-connects
      saveConfig({ mode: 'client', serverIp });

      // Close setup and open main window
      if (setupWindow) setupWindow.close();
      createMainWindow(apiUrl);
    }
  } catch (err) {
    console.error('Start error:', err);
    if (event.sender) {
      event.sender.send('setup-error', `حصل خطأ: ${err.message}`);
    }
  }
});

// ── App lifecycle ───────────────────────────────────────────────

app.whenReady().then(() => {
  // Try to load saved config
  appConfig = loadConfig();

  if (appConfig) {
    // Auto-start with saved config
    if (appConfig.mode === 'server') {
      startBackend()
        .then((port) => {
          createMainWindow(`http://127.0.0.1:${port}`);
        })
        .catch((err) => {
          console.error('Failed to auto-start server:', err);
          // Show setup screen as fallback
          showSetupWindow();
        });
    } else if (appConfig.mode === 'client' && appConfig.serverIp) {
      const apiUrl = `http://${appConfig.serverIp}:4000`;
      checkHealth(`${apiUrl}/health`)
        .then(() => {
          createMainWindow(apiUrl);
        })
        .catch(() => {
          // Server not reachable, show setup to re-enter IP
          showSetupWindow();
        });
    } else {
      showSetupWindow();
    }
  } else {
    // First time: show setup
    showSetupWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showSetupWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
