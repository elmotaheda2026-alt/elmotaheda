const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { startBackend, stopBackend, checkHealth, getAppDataDir } = require('./backend-loader.cjs');

// ── Legacy OS & Low-Spec Compatibility Settings (Windows 7 / 8 / 32-bit) ──
const isWindows = process.platform === 'win32';
const osRelease = isWindows ? os.release() : '';
// Windows 7 is NT 6.1, Windows 8 is NT 6.2, Windows 8.1 is NT 6.3
const isLegacyWindows = isWindows && (osRelease.startsWith('6.1') || osRelease.startsWith('6.2') || osRelease.startsWith('6.3'));
const is32Bit = process.arch === 'ia32';

// Global error handler to catch and log startup exceptions on legacy systems
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
  try {
    const logDir = path.join(getAppDataDir(), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'error.log'), `[${new Date().toISOString()}] ${err.stack || err}\n`);
  } catch (_) {}
});

// Configure Chromium compatibility flags for Windows 7 / 32-bit / Low-spec GPU
if (isLegacyWindows || is32Bit || process.argv.includes('--legacy-compat') || process.argv.includes('--disable-gpu')) {
  console.log(`[Compatibility Mode] Active (Platform: ${process.platform}, OS Release: ${osRelease}, Arch: ${process.arch})`);
  try {
    app.disableHardwareAcceleration();
  } catch (_) {}
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-rasterization');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,D3D11Experimental,AudioServiceOutOfProcess');
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('allow-insecure-localhost');
}

const CONFIG_FILE = path.join(getAppDataDir(), 'config.json');

let setupWindow = null;
let mainWindow = null;
let appConfig = null;
let currentApiUrl = 'http://127.0.0.1:4000';

function ensureFirewallRules() {
  if (process.platform !== 'win32') return;
  const cmd = 'netsh advfirewall firewall add rule name="AlMuttahida ERP Ports" dir=in action=allow protocol=TCP localport=1433,5000,4000,5173';
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.warn('Firewall rule notice (requires admin if not previously granted):', error.message);
    } else {
      console.log('AlMuttahida ERP firewall rules configured successfully.');
    }
  });
}

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
    const existing = loadConfig() || {};
    const merged = { ...existing, ...config };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) {
    console.error('Could not save config:', e.message);
  }
}

// ── Setup Window ────────────────────────────────────────────────

function showSetupWindow() {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 640,
    height: 700,
    resizable: true,
    minWidth: 550,
    minHeight: 600,
    frame: false,
    transparent: false,
    icon: path.join(__dirname, 'icon.png'),
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
    if (!mainWindow) app.quit();
  });
}

// ── Main Window ─────────────────────────────────────────────────

ipcMain.on('get-api-url', (event) => {
  event.returnValue = currentApiUrl;
});

ipcMain.handle('select-directory', async () => {
  try {
    const parent = mainWindow || setupWindow;
    const result = await dialog.showOpenDialog(parent, {
      title: 'اختر مجلد حفظ النسخ الاحتياطية التلقائية',
      defaultPath: 'D:\\',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  } catch (err) {
    console.warn('Directory selection failed:', err.message);
    return null;
  }
});

function createMainWindow(apiBaseUrl) {
  currentApiUrl = apiBaseUrl;

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f8fafc',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-main.cjs'),
    },
    title: 'Al-Muttahida ERP',
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      mainWindow.loadURL(apiBaseUrl.replace(':4000', ':5173'));
    }
  }

  // DevTools shortcut (Ctrl+Shift+I / F12) and reload shortcut (F5 / Ctrl+R)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      } else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
        mainWindow.webContents.reload();
        event.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC: Setup Window Helpers ────────────────────────────────────

ipcMain.on('close-setup-window', () => {
  if (setupWindow) setupWindow.close();
  if (!mainWindow) app.quit();
});

ipcMain.handle('open-external-url', async (_event, url) => {
  const { shell } = require('electron');
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    await shell.openExternal(url);
  }
});

ipcMain.handle('run-firewall-setup', async () => {
  return new Promise((resolve) => {
    ensureFirewallRules();
    resolve({ success: true });
  });
});

ipcMain.handle('check-sql-status', async () => {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    let resolved = false;
    socket.setTimeout(1800);
    socket.on('connect', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ running: true, port: 1433 });
      }
    });
    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ running: false, error: 'انتهت مهلة محاولة الاتصال بالبورت 1433' });
      }
    });
    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        resolve({ running: false, error: err.message });
      }
    });
    socket.connect(1433, '127.0.0.1');
  });
});

ipcMain.handle('test-server-ip', async (_event, ip) => {
  return new Promise((resolve) => {
    const http = require('http');
    const cleanIp = String(ip || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0];
    if (!cleanIp) return resolve({ ok: false, error: 'عنوان IP غير صالح' });

    const req = http.get(`http://${cleanIp}:4000/health`, { timeout: 2500 }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ ok: res.statusCode === 200, data: parsed });
        } catch {
          resolve({ ok: res.statusCode === 200 });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'انتهت مهلة الاتصال' }); });
  });
});

ipcMain.handle('scan-network', async () => {
  return new Promise(async (resolve) => {
    const dgram = require('dgram');
    const http = require('http');
    const os = require('os');
    let finished = false;

    const udpClient = dgram.createSocket('udp4');
    const finish = (ip) => {
      if (!finished) {
        finished = true;
        try { udpClient.close(); } catch (_) {}
        resolve(ip);
      }
    };

    udpClient.on('error', () => {});
    udpClient.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.service === 'al-muttahida-backend' || data.serverIp) {
          finish(data.serverIp || rinfo.address);
        }
      } catch (_) {}
    });

    try {
      udpClient.bind(() => {
        try {
          udpClient.setBroadcast(true);
          const msg = Buffer.from('ALMUTTAHIDA_DISCOVERY_PING');
          udpClient.send(msg, 0, msg.length, 4001, '255.255.255.255');
        } catch (_) {}
      });
    } catch (_) {}

    const probe = (targetIp) => new Promise((res) => {
      const req = http.get(`http://${targetIp}:4000/health`, { timeout: 800 }, (r) => {
        if (r.statusCode === 200) res(targetIp);
        else res(null);
      });
      req.on('error', () => res(null));
      req.on('timeout', () => { req.destroy(); res(null); });
    });

    const localHit = await probe('127.0.0.1');
    if (localHit) return finish('127.0.0.1');

    const ifaces = os.networkInterfaces();
    const subnets = new Set(['192.168.1', '192.168.0', '192.168.100', '10.0.0']);
    for (const key of Object.keys(ifaces)) {
      for (const iface of ifaces[key] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          if (parts.length === 4) subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
        }
      }
    }

    for (const s of subnets) {
      for (let i = 1; i <= 254; i++) {
        probe(`${s}.${i}`).then((ip) => { if (ip) finish(ip); });
      }
    }

    setTimeout(() => {
      finish(null);
    }, 2800);
  });
});

// ── IPC: Handle setup choices ───────────────────────────────────

ipcMain.on('start-app', async (event, config) => {
  const { mode, serverIp } = config;

  try {
    if (mode === 'server') {
      ensureFirewallRules();
      if (event.sender && setupWindow) {
        event.sender.send('setup-status', 'جاري تشغيل السيرفر...');
      }

      const port = await startBackend();
      const apiUrl = `http://127.0.0.1:${port}`;
      saveConfig({ mode: 'server', port });

      if (setupWindow) setupWindow.close();
      createMainWindow(apiUrl);

    } else if (mode === 'client') {
      const apiUrl = `http://${serverIp}:4000`;

      if (event.sender && setupWindow) {
        event.sender.send('setup-status', 'جاري الاتصال بالسيرفر...');
      }

      try {
        await checkHealth(`${apiUrl}/health`);
      } catch (err) {
        if (event.sender) {
          event.sender.send('setup-error', `لا يمكن الاتصال بالسيرفر على ${serverIp}. تأكد أن السيرفر شغال والجهازين على نفس الشبكة.`);
        }
        return;
      }

      saveConfig({ mode: 'client', serverIp, host: serverIp });

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

// ── App lifecycle: Automatic Backend Auto-Spawn ─────────────────

async function initAndLaunch() {
  appConfig = loadConfig();

  // If explicitly configured as client mode with a remote server IP
  if (appConfig && appConfig.mode === 'client' && (appConfig.serverIp || appConfig.host)) {
    const remoteIp = appConfig.serverIp || appConfig.host;
    const apiUrl = `http://${remoteIp}:4000`;

    try {
      await checkHealth(`${apiUrl}/health`);
      createMainWindow(apiUrl);
      return;
    } catch (err) {
      console.warn(`Remote server ${remoteIp} unreachable, showing setup window:`, err.message);
      showSetupWindow();
      return;
    }
  }

  // Default: Server / Standalone mode
  // Automatically spawn and launch local Express backend
  try {
    ensureFirewallRules();
    console.log('Auto-launching local Express backend...');
    const port = await startBackend();
    const apiUrl = `http://127.0.0.1:${port}`;
    createMainWindow(apiUrl);
  } catch (err) {
    console.error('Failed to auto-start backend server:', err);
    // Show setup window with error so user can diagnose or switch to client mode
    showSetupWindow();
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  initAndLaunch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!mainWindow) initAndLaunch();
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
