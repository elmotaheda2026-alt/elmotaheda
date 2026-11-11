const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { startBackend, stopBackend, checkHealth, getAppDataDir } = require('./backend-loader.cjs');

// ── Single Instance Lock (Fixes white screen caused by opening multiple instances) ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance of Al-Muttahida ERP is already running. Quitting duplicate...');
  app.quit();
  process.exit(0);
}

app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
  // If user tries to open a second instance, focus the existing main or setup window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (setupWindow) {
    if (setupWindow.isMinimized()) setupWindow.restore();
    setupWindow.focus();
  }
});

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

function ensureSqlConfigured() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(true);

    // 1. Ensure SQL Server services are started
    exec('sc config MSSQLSERVER start= auto & net start MSSQLSERVER & sc config "MSSQL$SQLEXPRESS" start= auto & net start "MSSQL$SQLEXPRESS"', () => {
      // 2. Run PowerShell init script to ensure alm_app login & AlMuttahida_New database exist
      const psScript = path.join(__dirname, 'init-sql-login.ps1');
      if (fs.existsSync(psScript)) {
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}"`, (err, stdout) => {
          if (stdout) console.log('[init-sql-login]', stdout.trim());
          resolve(true);
        });
      } else {
        resolve(true);
      }
    });
  });
}

// ── Config helpers ──────────────────────────────────────────────

function getProgramDataConfigFile() {
  const pd = process.env.PROGRAMDATA || 'C:\\ProgramData';
  return path.join(pd, 'Al-Muttahida ERP', 'config.json');
}

function loadConfig() {
  try {
    const pdConfig = getProgramDataConfigFile();
    if (fs.existsSync(pdConfig)) {
      return JSON.parse(fs.readFileSync(pdConfig, 'utf-8'));
    }
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
    const existing = loadConfig() || {};
    const merged = { ...existing, ...config };
    const content = JSON.stringify(merged, null, 2);

    // 1. Save in %PROGRAMDATA%
    const pdConfig = getProgramDataConfigFile();
    const pdDir = path.dirname(pdConfig);
    if (!fs.existsSync(pdDir)) fs.mkdirSync(pdDir, { recursive: true });
    fs.writeFileSync(pdConfig, content, 'utf-8');

    // 2. Also mirror to %APPDATA%
    const appDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
  } catch (e) {
    console.error('Could not save config:', e.message);
  }
}

// ── Setup Window ────────────────────────────────────────────────

function showSetupWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('navigate-to', '/onboarding');
  } else {
    createMainWindow(currentApiUrl);
  }
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Safety fallback: if ready-to-show takes more than 1.5s, force display window so it doesn't get stuck hidden
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1500);

  // If page load fails, retry after a short delay instead of staying blank
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.warn(`[Main Window] Load failed: ${errorCode} - ${errorDescription}. Retrying in 1s...`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
        if (fs.existsSync(indexPath)) {
          mainWindow.loadFile(indexPath);
        } else {
          mainWindow.loadURL(apiBaseUrl.replace(':4000', ':5173'));
        }
      }
    }, 1000);
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
      } else if (input.key === 'F2') {
        showSetupWindow();
        event.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC: Setup Window Helpers ────────────────────────────────────

ipcMain.on('open-setup-window', () => { showSetupWindow(); });

ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();
  } else if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on('close-setup-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
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

ipcMain.handle('download-and-install-sql', async (event) => {
  const https = require('https');
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const { exec } = require('child_process');

  const sendProgress = (step, percent, msg) => {
    try {
      if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('sql-install-progress', { step, percent, msg });
      }
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('sql-install-progress', { step, percent, msg });
      }
      if (setupWindow && !setupWindow.isDestroyed() && setupWindow.webContents) {
        setupWindow.webContents.send('sql-install-progress', { step, percent, msg });
      }
    } catch (_) {}
  };

  // 1. Try to start existing installed SQL Server services first
  sendProgress('service-check', 10, 'جاري فحص خدمات SQL Server على جهازك وتشغيلها تلقائياً...');
  const startServiceResult = await new Promise((res) => {
    exec('sc config MSSQLSERVER start= auto & net start MSSQLSERVER || sc config MSSQL$SQLEXPRESS start= auto & net start MSSQL$SQLEXPRESS', (err) => {
      res(!err);
    });
  });

  if (startServiceResult) {
    sendProgress('service-started', 80, 'تم تشغيل محرك SQL Server... جاري تهيئة قاعدة البيانات...');
    await ensureSqlConfigured();
    ensureFirewallRules();
    sendProgress('done', 100, 'تم الاتصال وتفعيل محرك البيانات بنجاح!');
    return { success: true, startedExisting: true };
  }

  // 2. Download official Microsoft SQL Server Express installer
  sendProgress('downloading', 20, 'جاري تحميل محرك قواعد البيانات الرسمي (SQL Server Express)...');
  const targetDir = getAppDataDir();
  try {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  } catch (_) {}
  const installerPath = path.join(targetDir, 'SQL2025-SSEI-Expr.exe');
  const downloadUrl = 'https://go.microsoft.com/fwlink/p/?linkid=2216019';

  const downloadFile = (url) => {
    return new Promise((resolve, reject) => {
      const getWithRedirects = (currentUrl, redirectsLeft = 5) => {
        if (redirectsLeft <= 0) return reject(new Error('تجاوز عدد التحويلات المسموح بها'));
        const client = currentUrl.startsWith('https') ? https : http;
        client.get(currentUrl, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            let nextUrl = response.headers.location;
            if (!nextUrl.startsWith('http')) {
              const parsed = new URL(currentUrl);
              nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
            }
            return getWithRedirects(nextUrl, redirectsLeft - 1);
          }

          if (response.statusCode !== 200) {
            return reject(new Error(`فشل التحميل برمز: ${response.statusCode}`));
          }

          const totalBytes = parseInt(response.headers['content-length'] || '4606792', 10);
          let receivedBytes = 0;
          const fileStream = fs.createWriteStream(installerPath);

          response.on('data', (chunk) => {
            receivedBytes += chunk.length;
            const pct = Math.min(85, 20 + Math.round((receivedBytes / totalBytes) * 65));
            const mbDone = (receivedBytes / (1024 * 1024)).toFixed(1);
            const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
            sendProgress('downloading', pct, `جاري تحميل محرك البيانات (${mbDone} ميجابايت من ${mbTotal} ميجابايت)...`);
          });

          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
          fileStream.on('error', reject);
        }).on('error', reject);
      };

      getWithRedirects(url);
    });
  };

  try {
    await downloadFile(downloadUrl);
  } catch (dlErr) {
    console.error('Download error:', dlErr);
    sendProgress('error', 0, `تعذر التحميل التلقائي: ${dlErr.message}`);
    return { success: false, error: dlErr.message };
  }

  // 3. Launch the installer with Unattended parameters including Mixed-mode and TCP
  sendProgress('installing', 90, 'تم التحميل بنجاح. جاري تشغيل مثبت محرك البيانات تلقائياً...');
  ensureFirewallRules();

  try {
    const installArgs = '/Action=Install /IACCEPTSQLSERVERLICENSETERMS /QS /Hideconsole /FEATURES=SQL /INSTANCENAME=SQLEXPRESS /SECURITYMODE=SQL /SAPWD="Alm@2026#App" /TCPENABLED=1 /NPENABLED=1 /SQLSYSADMINACCOUNTS="BUILTIN\\Administrators"';
    const child = exec(`"${installerPath}" ${installArgs}`, {
      detached: true,
      windowsHide: false,
    });
    child.unref();

    sendProgress('installing', 95, 'معالج التثبيت يعمل الآن لتجهيز قاعدة البيانات... يرجى الانتظار دقيقة.');
    return { success: true, launched: true };
  } catch (execErr) {
    const { shell } = require('electron');
    await shell.openPath(installerPath);
    return { success: true, opened: true };
  }
});

ipcMain.handle('check-sql-status', async () => {
  const net = require('net');
  const checkPort = () => new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    socket.setTimeout(1200);
    socket.on('connect', () => {
      if (!resolved) { resolved = true; socket.destroy(); resolve(true); }
    });
    socket.on('timeout', () => {
      if (!resolved) { resolved = true; socket.destroy(); resolve(false); }
    });
    socket.on('error', () => {
      if (!resolved) { resolved = true; socket.destroy(); resolve(false); }
    });
    socket.connect(1433, '127.0.0.1');
  });

  const isPortOpen = await checkPort();
  if (isPortOpen) {
    ensureSqlConfigured().catch(() => {});
    return { running: true, port: 1433 };
  }

  // If port 1433 did not respond, check if SQL Server service is present and try init script
  const psScript = path.join(__dirname, 'init-sql-login.ps1');
  if (fs.existsSync(psScript)) {
    const psOk = await new Promise((resolve) => {
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}"`, (err, stdout) => {
        if (!err && stdout && stdout.includes('SUCCESS')) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });

    if (psOk) {
      return { running: true, port: 1433, configured: true };
    }
  }

  return { running: false, error: 'محرك SQL Server غير متصل حالياً' };
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
      await ensureSqlConfigured().catch(() => {});

      if (event.sender) {
        event.sender.send('setup-status', 'جاري تشغيل السيرفر وقاعدة البيانات...');
      }

      let port;
      try {
        port = await startBackend();
      } catch (beErr) {
        if (event.sender) {
          event.sender.send('setup-error', `تعذر بدء السيرفر المحلي: ${beErr.message}`);
        }
        return;
      }

      const apiUrl = `http://127.0.0.1:${port}`;
      currentApiUrl = apiUrl;

      // Check database connection via /health/db
      let dbReady = false;
      for (let i = 0; i < 15; i++) {
        try {
          await checkHealth(`${apiUrl}/health/db`);
          dbReady = true;
          break;
        } catch (_) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (!dbReady) {
        stopBackend();
        if (event.sender) {
          event.sender.send('setup-error', 'تم تشغيل السيرفر ولكن تعذر الاتصال بقاعدة البيانات (SQL Server). تأكد من تشغيل محرك البيانات بالأسفل أو اضغط على زر التهيئة التلقائية.');
        }
        return;
      }

      saveConfig({ mode: 'server', port, host: '127.0.0.1' });

      if (event.sender) {
        event.sender.send('app-started', { success: true, mode: 'server', apiUrl });
      }

      if (!mainWindow) {
        createMainWindow(apiUrl);
      }

    } else if (mode === 'client') {
      const apiUrl = `http://${serverIp}:4000`;
      currentApiUrl = apiUrl;

      if (event.sender) {
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

      stopBackend();
      saveConfig({ mode: 'client', serverIp, host: serverIp });

      if (event.sender) {
        event.sender.send('app-started', { success: true, mode: 'client', apiUrl });
      }

      if (!mainWindow) {
        createMainWindow(apiUrl);
      }
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

  // If first time (no config) or mode not chosen:
  // Open React main window directly (React Router displays OnboardingWizard)!
  if (!appConfig || !appConfig.mode) {
    console.log('No prior config: Launching React main window in Onboarding mode...');
    createMainWindow('http://127.0.0.1:4000');
    return;
  }

  // If client mode
  if (appConfig.mode === 'client') {
    const remoteIp = appConfig.serverIp || appConfig.host;
    const apiUrl = `http://${remoteIp || '127.0.0.1'}:4000`;
    createMainWindow(apiUrl);
    return;
  }

  // Server mode
  try {
    ensureFirewallRules();
    ensureSqlConfigured().catch(() => {});
    console.log('Auto-launching local Express backend...');
    let port = 4000;
    try {
      port = await startBackend();
    } catch (e) {
      console.warn('Backend start error:', e.message);
    }
    const apiUrl = `http://127.0.0.1:${port}`;
    createMainWindow(apiUrl);
  } catch (err) {
    console.error('Failed to auto-start backend server:', err);
    createMainWindow('http://127.0.0.1:4000');
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
