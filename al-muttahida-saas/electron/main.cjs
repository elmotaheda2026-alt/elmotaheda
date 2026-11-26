const { app, BrowserWindow, ipcMain, Menu, dialog, powerMonitor, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { startBackend, stopBackend, checkHealth, ensureBackendRunning, getAppDataDir } = require('./backend-loader.cjs');

let autoUpdater = null;
try {
  try {
    ({ autoUpdater } = require('./electron-updater.bundle.cjs'));
  } catch (_) {
    ({ autoUpdater } = require('electron-updater'));
  }
} catch (err) {
  console.warn('[AutoUpdater] electron-updater not available:', err.message);
}

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
    const errLog = path.join(logDir, 'error.log');
    if (fs.existsSync(errLog) && fs.statSync(errLog).size >= 2 * 1024 * 1024) {
      const prevErrLog = path.join(logDir, 'error.old.log');
      try { if (fs.existsSync(prevErrLog)) fs.unlinkSync(prevErrLog); } catch (_) { }
      fs.renameSync(errLog, prevErrLog);
    }
    fs.appendFile(errLog, `[${new Date().toISOString()}] ${err.stack || err}\n`, () => { });
  } catch (_) { }
});

// Prevent Chromium window occlusion, DirectComposition sleep-blank textures, and audio service stalls on Windows
if (isWindows) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,AudioServiceOutOfProcess');
  app.commandLine.appendSwitch('disable-direct-composition');
}

// Configure Chromium compatibility flags for Windows 7 / 32-bit / Low-spec GPU
if (isLegacyWindows || is32Bit || process.argv.includes('--legacy-compat') || process.argv.includes('--disable-gpu')) {
  console.log(`[Compatibility Mode] Active (Platform: ${process.platform}, OS Release: ${osRelease}, Arch: ${process.arch})`);
  try {
    app.disableHardwareAcceleration();
  } catch (_) { }
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-rasterization');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,D3D11Experimental,AudioServiceOutOfProcess');
}

const CONFIG_FILE = path.join(getAppDataDir(), 'config.json');

let setupWindow = null;
let mainWindow = null;
let appConfig = null;
let currentApiUrl = 'http://127.0.0.1:4000';

function ensureFirewallRules() {
  if (process.platform !== 'win32') return;
  const cmdTcp = 'netsh advfirewall firewall show rule name="AlMuttahida ERP Ports TCP" >nul 2>&1 || netsh advfirewall firewall add rule name="AlMuttahida ERP Ports TCP" dir=in action=allow protocol=TCP localport=1433,4000,5000,5173';
  const cmdUdp = 'netsh advfirewall firewall show rule name="AlMuttahida ERP Ports UDP" >nul 2>&1 || netsh advfirewall firewall add rule name="AlMuttahida ERP Ports UDP" dir=in action=allow protocol=UDP localport=4001';
  exec(`${cmdTcp} & ${cmdUdp}`, (error) => {
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
      const unpackedPs = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'init-sql-login.ps1');
      const psScript = fs.existsSync(unpackedPs) ? unpackedPs : path.join(__dirname, 'init-sql-login.ps1');
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
      return JSON.parse(fs.readFileSync(pdConfig, 'utf-8').replace(/^\uFEFF/, ''));
    }
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8').replace(/^\uFEFF/, ''));
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

    // 1. Always persist in %APPDATA% (user-writable)
    const appDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, content, 'utf-8');

    // 2. Best-effort mirror to %PROGRAMDATA% without failing if non-admin lacks write ACL
    try {
      const pdConfig = getProgramDataConfigFile();
      const pdDir = path.dirname(pdConfig);
      if (!fs.existsSync(pdDir)) fs.mkdirSync(pdDir, { recursive: true });
      fs.writeFileSync(pdConfig, content, 'utf-8');
    } catch (pdErr) {
      console.warn('ProgramData config mirror skipped:', pdErr.message);
    }
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
      defaultPath: fs.existsSync('D:\\') ? 'D:\\' : app.getPath('documents'),
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

function reloadMainWindowSafely() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const isDevMode = process.env.NODE_ENV === 'development';
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  try {
    if (!isDevMode && fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else if (isDevMode) {
      mainWindow.loadURL('http://localhost:5173');
    } else {
      mainWindow.webContents.reloadIgnoringCache();
    }
  } catch (err) {
    console.warn('[Main Window] Safe reload fallback:', err?.message || err);
    try {
      mainWindow.webContents.reloadIgnoringCache();
    } catch (_) { }
  }
}

function forceWindowRepaint() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.invalidate();
  } catch (_) { }
  try {
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.setOpacity(0.999);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.setOpacity(1);
          } catch (_) { }
        }
      }, 60);
    }
  } catch (_) { }
}

async function createMainWindow(apiBaseUrl) {
  currentApiUrl = apiBaseUrl;

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload-main.cjs'),
    },
    title: 'شركة المتحدة للتجارة والتوريدات',
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    const isAllowedLocal =
      navUrl.startsWith('file://') ||
      navUrl.startsWith('http://localhost:') ||
      navUrl.startsWith('http://127.0.0.1:');
    if (!isAllowedLocal) {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Load UI immediately without blocking on backend health polling
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 800);

  mainWindow.on('focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.focus();
    }
  });

  mainWindow.on('unresponsive', () => {
    console.warn('[Main Window] Window unresponsive; reloading...');
    reloadMainWindowSafely();
  });

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

  // Recover automatically if renderer process crashes instead of leaving a white screen
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.warn(`[Main Window] Renderer process gone (${details?.reason}). Reloading...`);
    if (details?.reason === 'clean-exit') return;
    setTimeout(() => {
      reloadMainWindowSafely();
    }, 600);
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

  // DevTools shortcut (development only) and reload shortcut (F5 / Ctrl+R)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (
        (!app.isPackaged || process.env.NODE_ENV === 'development') &&
        ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12')
      ) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      } else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
        mainWindow.webContents.reload();
        event.preventDefault();
      } else if (input.control && input.shift && input.key.toLowerCase() === 'o') {
        showSetupWindow();
        event.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (whatsappWindow && !whatsappWindow.isDestroyed()) {
      isAppQuitting = true;
      whatsappWindow.destroy();
      whatsappWindow = null;
    }
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

// ── IPC: Real Interactive PDF Print Preview (Fixes "This app doesn't support print preview") ──

function resolvePaperSpec(html, requestedPaperSize) {
  const explicit = typeof requestedPaperSize === 'string' ? requestedPaperSize.toLowerCase().trim() : '';
  if (explicit === 'thermal-58mm' || explicit === '58mm') {
    return { kind: 'thermal', widthMm: 58 };
  }
  if (explicit === 'thermal-80mm' || explicit === '80mm') {
    return { kind: 'thermal', widthMm: 80 };
  }
  if (explicit === 'a4-landscape') {
    return { kind: 'a4', landscape: true };
  }
  if (explicit === 'a4' || explicit === 'a4-portrait') {
    return { kind: 'a4', landscape: false };
  }

  // Auto-detect from HTML @page or body width when paperSize wasn't passed explicitly
  if (/@page\s*\{[^}]*58mm/i.test(html) || /\bwidth\s*:\s*58mm\b/i.test(html)) {
    return { kind: 'thermal', widthMm: 58 };
  }
  if (/@page\s*\{[^}]*80mm/i.test(html) || /\bwidth\s*:\s*80mm\b/i.test(html)) {
    return { kind: 'thermal', widthMm: 80 };
  }
  if (/@page\s*\{[^}]*A4\s+landscape/i.test(html)) {
    return { kind: 'a4', landscape: true };
  }
  return { kind: 'a4', landscape: false };
}

function openPrintPreviewFromPdfBuffer(pdfBuffer, title, options = {}) {
  const tempPdfPath = path.join(
    os.tmpdir(),
    `elmotaheda-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
  );
  fs.writeFileSync(tempPdfPath, pdfBuffer);

  const isThermal = options.kind === 'thermal';
  const iconCandidate = path.join(__dirname, 'icon.png');
  const previewWin = new BrowserWindow({
    width: isThermal ? 560 : 1000,
    height: isThermal ? 780 : 840,
    minWidth: isThermal ? 420 : 700,
    minHeight: 550,
    title: title || 'معاينة الطباعة - شركة المتحدة',
    autoHideMenuBar: true,
    backgroundColor: '#1e293b',
    ...(fs.existsSync(iconCandidate) ? { icon: iconCandidate } : {}),
    webPreferences: {
      plugins: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  previewWin.setMenuBarVisibility(false);
  previewWin.loadURL(`file:///${tempPdfPath.replace(/\\/g, '/')}`);
  previewWin.on('closed', () => {
    fs.unlink(tempPdfPath, () => { });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.webContents.focus();
    }
  });
}

async function renderWebContentsToPdf(webContents, options = {}) {
  if (options.kind === 'thermal' && options.widthInches && options.heightInches) {
    return await webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: false,
      pageSize: {
        width: options.widthInches,
        height: options.heightInches,
      },
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      },
    });
  }

  try {
    return await webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: Boolean(options.landscape),
    });
  } catch (err) {
    console.warn('printToPDF preferCSSPageSize fallback to A4:', err?.message || err);
    return await webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: false,
      pageSize: 'A4',
      landscape: Boolean(options.landscape),
    });
  }
}

ipcMain.handle('print-preview-html', async (_event, payload = {}) => {
  const html = typeof payload?.html === 'string' ? payload.html : '';
  const title = typeof payload?.title === 'string' ? payload.title : 'معاينة الطباعة';
  if (!html) return { success: false, error: 'Empty HTML content' };

  const paperSpec = resolvePaperSpec(html, payload?.paperSize);
  const tempHtmlPath = path.join(
    os.tmpdir(),
    `elmotaheda-print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`
  );
  let renderWin = null;

  try {
    fs.writeFileSync(tempHtmlPath, html, 'utf8');
    const thermalCssWidthPx =
      paperSpec.kind === 'thermal' ? Math.round((paperSpec.widthMm / 25.4) * 96) : 1000;

    renderWin = new BrowserWindow({
      show: false,
      frame: paperSpec.kind !== 'thermal',
      width: thermalCssWidthPx,
      height: paperSpec.kind === 'thermal' ? 100 : 1200,
      useContentSize: paperSpec.kind === 'thermal',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    await renderWin.loadURL(`file:///${tempHtmlPath.replace(/\\/g, '/')}`);
    // Give webfonts and RTL table layout a moment to settle
    await new Promise((resolve) => setTimeout(resolve, 220));

    let pdfOptions = { kind: 'a4', landscape: Boolean(paperSpec.landscape) };
    if (paperSpec.kind === 'thermal') {
      const contentHeightPx = await renderWin.webContents.executeJavaScript(`(() => {
        const el = document.querySelector('.receipt') || document.body;
        const rect = el ? el.getBoundingClientRect() : { height: 0 };
        return Math.ceil(Math.max(rect.height || 0, el?.scrollHeight || 0, 180));
      })()`);

      const widthInches = Number((paperSpec.widthMm / 25.4).toFixed(4));
      // 96 CSS px = 1 inch, plus ~3mm (0.12 in) bottom buffer to prevent clipping without wasting roll paper
      const heightInches = Number((contentHeightPx / 96 + 0.12).toFixed(4));
      const heightMm = Math.ceil(heightInches * 25.4);

      await renderWin.webContents.insertCSS(`
        @page { size: ${paperSpec.widthMm}mm ${heightMm}mm !important; margin: 0 !important; }
        html, body {
          width: ${paperSpec.widthMm}mm !important;
          max-width: ${paperSpec.widthMm}mm !important;
          height: auto !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
      `);

      pdfOptions = {
        kind: 'thermal',
        widthInches,
        heightInches,
      };
    }

    const pdfBuffer = await renderWebContentsToPdf(renderWin.webContents, pdfOptions);
    openPrintPreviewFromPdfBuffer(pdfBuffer, title, { kind: paperSpec.kind });
    return { success: true };
  } catch (err) {
    console.error('print-preview-html failed:', err);
    return { success: false, error: err?.message || 'Print preview failed' };
  } finally {
    if (renderWin && !renderWin.isDestroyed()) {
      try { renderWin.destroy(); } catch (_) { }
    }
    fs.unlink(tempHtmlPath, () => { });
  }
});

ipcMain.handle('print-preview-current', async (event, payload = {}) => {
  try {
    const title = typeof payload?.title === 'string' ? payload.title : 'معاينة الطباعة';
    const paperSpec = resolvePaperSpec('', payload?.paperSize);
    const pdfBuffer = await renderWebContentsToPdf(event.sender, {
      kind: 'a4',
      landscape: Boolean(paperSpec.landscape),
    });
    openPrintPreviewFromPdfBuffer(pdfBuffer, title, { kind: 'a4' });
    return { success: true };
  } catch (err) {
    console.error('print-preview-current failed:', err);
    return { success: false, error: err?.message || 'Print preview failed' };
  }
});

ipcMain.handle('run-firewall-setup', async () => {
  return new Promise((resolve) => {
    ensureFirewallRules();
    resolve({ success: true });
  });
});

ipcMain.handle('save-custom-sql-config', async (_event, customSql = {}) => {
  try {
    const { port: customPort, ...rest } = customSql || {};
    saveConfig({
      ...rest,
      ...(customPort ? { dbPort: Number(customPort) } : {}),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function getInstallerPaths() {
  const installersDir = path.join(getAppDataDir(), 'installers');
  try {
    if (!fs.existsSync(installersDir)) fs.mkdirSync(installersDir, { recursive: true });
  } catch (_) { }
  return {
    installersDir,
    sqlPath: path.join(installersDir, 'SQL2025-SSEI-Expr.exe'),
    ssmsPath: path.join(installersDir, 'vs_SSMS.exe'),
  };
}

function broadcastSqlProgress(event, payload) {
  try {
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send('sql-install-progress', payload);
    }
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('sql-install-progress', payload);
    }
    if (setupWindow && !setupWindow.isDestroyed() && setupWindow.webContents) {
      setupWindow.webContents.send('sql-install-progress', payload);
    }
  } catch (_) { }
}

function downloadInstallerWithProgress({ url, targetPath, targetLabel, targetKey, fallbackBytes, event }) {
  const https = require('https');
  const tmpPath = `${targetPath}.download`;

  return new Promise((resolve, reject) => {
    const getWithRedirects = (currentUrl, redirectsLeft = 6) => {
      if (redirectsLeft <= 0) return reject(new Error('تجاوز عدد التحويلات المسموح بها'));
      if (!String(currentUrl).startsWith('https://')) {
        return reject(new Error('رابط التحميل يجب أن يستخدم اتصال HTTPS آمن'));
      }
      const req = https.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          let nextUrl = response.headers.location;
          if (!nextUrl.startsWith('http')) {
            const parsed = new URL(currentUrl);
            nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
          }
          response.resume();
          return getWithRedirects(nextUrl, redirectsLeft - 1);
        }

        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`فشل التحميل برمز: ${response.statusCode}`));
        }

        const totalBytes = parseInt(response.headers['content-length'] || String(fallbackBytes), 10) || fallbackBytes;
        let receivedBytes = 0;
        const fileStream = fs.createWriteStream(tmpPath);

        response.on('data', (chunk) => {
          receivedBytes += chunk.length;
          const pct = Math.min(92, 5 + Math.round((receivedBytes / totalBytes) * 87));
          const mbDone = (receivedBytes / (1024 * 1024)).toFixed(1);
          const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
          broadcastSqlProgress(event, {
            target: targetKey,
            step: 'downloading',
            percent: pct,
            msg: `جاري تحميل ${targetLabel} (${mbDone} ميجابايت من ${mbTotal} ميجابايت)...`,
          });
        });

        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
              fs.renameSync(tmpPath, targetPath);
              resolve(targetPath);
            } catch (renameErr) {
              reject(renameErr);
            }
          });
        });
        fileStream.on('error', (err) => {
          try { fs.unlinkSync(tmpPath); } catch (_) { }
          reject(err);
        });
      });
      req.setTimeout(30000, () => {
        req.destroy(new Error('انتهت مهلة الاتصال أثناء التحميل'));
      });
      req.on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch (_) { }
        reject(err);
      });
    };

    getWithRedirects(url);
  });
}

function checkPort1433() {
  const net = require('net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    socket.setTimeout(900);
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
}

function buildCleanApiUrl(rawHostOrUrl, defaultPort = 4000) {
  const raw = String(rawHostOrUrl || '').trim();
  if (!raw) return `http://127.0.0.1:${defaultPort}`;
  let cleaned = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
  if (!cleaned) return `http://127.0.0.1:${defaultPort}`;
  if (!/:\d+$/.test(cleaned)) {
    cleaned = `${cleaned}:${defaultPort}`;
  }
  const candidate = `http://${cleaned}`;
  try {
    new URL(candidate);
    return candidate;
  } catch {
    return `http://127.0.0.1:${defaultPort}`;
  }
}

function checkDbHealthDetails(apiUrl) {
  const http = require('http');
  return new Promise((resolve) => {
    try {
      const safeBase = buildCleanApiUrl(apiUrl, 4000);
      const req = http.get(`${safeBase}/health/db`, { timeout: 6000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            resolve({ ok: res.statusCode === 200 && Boolean(parsed.ok), error: parsed.error || null });
          } catch {
            resolve({ ok: res.statusCode === 200, error: res.statusCode === 200 ? null : `HTTP ${res.statusCode}` });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'انتهت مهلة فحص قاعدة البيانات' }); });
    } catch (err) {
      resolve({ ok: false, error: err?.message || 'Invalid URL' });
    }
  });
}

let schemaProvisionPromise = null;

async function ensureBackendSchemaReady(timeoutMs = 15000) {
  if (schemaProvisionPromise) {
    return schemaProvisionPromise;
  }

  schemaProvisionPromise = (async () => {
    try {
      const localPort = Number(appConfig?.port || 4000) || 4000;
      const quickApiUrl = `http://127.0.0.1:${localPort}`;
      const quickCheck = await checkDbHealthDetails(quickApiUrl);
      if (quickCheck.ok) {
        currentApiUrl = quickApiUrl;
        return quickCheck;
      }

      const port = (await startBackend()) || 4000;
      const apiUrl = `http://127.0.0.1:${port}`;
      currentApiUrl = apiUrl;

      const deadline = Date.now() + timeoutMs;
      let lastResult = { ok: false, error: 'جاري تهيئة قاعدة البيانات...' };
      while (Date.now() < deadline) {
        lastResult = await checkDbHealthDetails(apiUrl);
        if (lastResult.ok) {
          return lastResult;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      return lastResult;
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  })().finally(() => {
    schemaProvisionPromise = null;
  });

  return schemaProvisionPromise;
}

async function detectSqlEnvironment() {
  const { sqlPath, ssmsPath } = getInstallerPaths();
  const isPortOpen = await checkPort1433();

  let sqlInstalled = isPortOpen;
  let sqlRunning = isPortOpen;
  let ssmsInstalled = false;

  if (process.platform === 'win32') {
    const psDetectScript = `
      $sqlInst = $false; $sqlRun = $false; $ssmsInst = $false;
      try {
        $svcs = Get-Service -Name 'MSSQLSERVER','MSSQL$*' -ErrorAction SilentlyContinue
        if ($svcs) {
          $sqlInst = $true
          if ($svcs | Where-Object { $_.Status -eq 'Running' }) { $sqlRun = $true }
        }
        if (-not $sqlInst -and (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL')) {
          $props = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL' -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }
          if ($props) { $sqlInst = $true }
        }
      } catch {}
      try {
        $ssmsPaths = @(
          "$env:ProgramFiles\\Microsoft SQL Server Management Studio*",
          "\${env:ProgramFiles(x86)}\\Microsoft SQL Server Management Studio*"
        )
        foreach ($p in $ssmsPaths) {
          if (Get-ChildItem -Path $p -Filter 'Ssms.exe' -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 1) {
            $ssmsInst = $true; break
          }
        }
        if (-not $ssmsInst) {
          $uninstKeys = @(
            'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
          )
          $hit = Get-ItemProperty $uninstKeys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*SQL Server Management Studio*' } | Select-Object -First 1
          if ($hit) { $ssmsInst = $true }
        }
      } catch {}
      [PSCustomObject]@{ sqlInstalled=$sqlInst; sqlRunning=$sqlRun; ssmsInstalled=$ssmsInst } | ConvertTo-Json -Compress
    `;

    const detected = await new Promise((resolve) => {
      const encoded = Buffer.from(psDetectScript, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { timeout: 6000 }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve(null);
        }
      });
    });

    if (detected) {
      sqlInstalled = Boolean(detected.sqlInstalled || isPortOpen);
      sqlRunning = Boolean(detected.sqlRunning || isPortOpen);
      ssmsInstalled = Boolean(detected.ssmsInstalled);
    }
  }

  const sqlInstallerDownloaded = fs.existsSync(sqlPath) && fs.statSync(sqlPath).size > 1024 * 1024;
  const ssmsInstallerDownloaded = fs.existsSync(ssmsPath) && fs.statSync(ssmsPath).size > 1024 * 1024;

  // Verify the backend can actually log into SQL Server and initDb() has created all tables
  let schemaReady = false;
  if (isPortOpen || sqlRunning) {
    const schemaCheck = await ensureBackendSchemaReady(10000);
    schemaReady = Boolean(schemaCheck && schemaCheck.ok);
  }

  const sqlReady = Boolean((isPortOpen || sqlRunning) && schemaReady);

  let recommendedStep = 'ready';
  if (!sqlInstalled) recommendedStep = 'download_sql';
  else if (!sqlReady) recommendedStep = 'configure_sql';
  else if (!ssmsInstalled) recommendedStep = 'download_ssms';

  return {
    sqlInstalled,
    sqlRunning,
    sqlReady,
    ssmsInstalled,
    sqlInstallerDownloaded,
    ssmsInstallerDownloaded,
    sqlInstallerPath: sqlPath,
    ssmsInstallerPath: ssmsPath,
    recommendedStep,
  };
}

ipcMain.handle('check-sql-environment', async () => {
  return detectSqlEnvironment();
});

ipcMain.handle('configure-sql-database', async (event) => {
  broadcastSqlProgress(event, { target: 'sql', step: 'configuring', percent: 30, msg: 'جاري تشغيل خدمات SQL Server وتفعيل المصادقة والصلاحيات...' });
  await ensureSqlConfigured();
  ensureFirewallRules();

  broadcastSqlProgress(event, { target: 'sql', step: 'configuring', percent: 65, msg: 'جاري ربط قاعدة البيانات وإنشاء الجداول التلقائية...' });
  const schemaRes = await ensureBackendSchemaReady(25000);
  if (schemaRes.ok) {
    broadcastSqlProgress(event, { target: 'sql', step: 'done', percent: 100, msg: 'تم تشغيل محرك SQL Server وإنشاء جداول قاعدة البيانات بنجاح!' });
    return { success: true, running: true };
  }

  const detail = schemaRes.error ? ` (${schemaRes.error})` : '';
  return {
    success: false,
    error: `تعذر إتمام الربط وإنشاء الجداول في SQL Server${detail}. تأكد من تشغيل خدمة SQL Server ثم أعد المحاولة.`,
  };
});

ipcMain.handle('download-and-install-sql', async (event) => {
  const { shell } = require('electron');
  const envState = await detectSqlEnvironment();

  if (envState.sqlInstalled) {
    broadcastSqlProgress(event, { target: 'sql', step: 'service-check', percent: 40, msg: 'تم العثور على SQL Server مثبتاً بالفعل، جاري تفعيله وإنشاء الجداول...' });
    await ensureSqlConfigured();
    ensureFirewallRules();
    const schemaRes = await ensureBackendSchemaReady(25000);
    if (schemaRes.ok) {
      broadcastSqlProgress(event, { target: 'sql', step: 'done', percent: 100, msg: 'تم تشغيل وتفعيل محرك SQL Server وجداول قاعدة البيانات بنجاح!' });
      return { success: true, startedExisting: true };
    }
  }

  const { sqlPath } = getInstallerPaths();
  if (!envState.sqlInstallerDownloaded) {
    broadcastSqlProgress(event, { target: 'sql', step: 'downloading', percent: 5, msg: 'جاري بدء تحميل مثبت SQL Server Express الرسمي...' });
    try {
      await downloadInstallerWithProgress({
        url: 'https://go.microsoft.com/fwlink/p/?linkid=2216019',
        targetPath: sqlPath,
        targetLabel: 'SQL Server Express',
        targetKey: 'sql',
        fallbackBytes: 4606792,
        event,
      });
    } catch (dlErr) {
      console.error('SQL download error:', dlErr);
      broadcastSqlProgress(event, { target: 'sql', step: 'error', percent: 0, msg: `تعذر تحميل مثبت SQL: ${dlErr.message}` });
      return { success: false, error: dlErr.message };
    }
  }

  broadcastSqlProgress(event, { target: 'sql', step: 'installing', percent: 95, msg: 'تم التحميل بنجاح! جاري فتح معالج تثبيت SQL Server...' });
  ensureFirewallRules();
  const openErr = await shell.openPath(sqlPath);
  if (openErr) {
    return { success: false, error: `تعذر فتح ملف التثبيت: ${openErr}` };
  }
  return { success: true, launched: true, installerPath: sqlPath };
});

ipcMain.handle('download-ssms-installer', async (event) => {
  const { shell } = require('electron');
  const envState = await detectSqlEnvironment();
  if (envState.ssmsInstalled) {
    broadcastSqlProgress(event, { target: 'ssms', step: 'done', percent: 100, msg: 'أداة SSMS مثبتة بالفعل على جهازك!' });
    return { success: true, alreadyInstalled: true };
  }

  const { ssmsPath } = getInstallerPaths();
  if (!envState.ssmsInstallerDownloaded) {
    broadcastSqlProgress(event, { target: 'ssms', step: 'downloading', percent: 5, msg: 'جاري بدء تحميل أداة إدارة قواعد البيانات (SSMS)...' });
    try {
      await downloadInstallerWithProgress({
        url: 'https://aka.ms/ssmsfullsetup',
        targetPath: ssmsPath,
        targetLabel: 'أداة إدارة قاعدة البيانات SSMS',
        targetKey: 'ssms',
        fallbackBytes: 5994632,
        event,
      });
    } catch (dlErr) {
      console.error('SSMS download error:', dlErr);
      broadcastSqlProgress(event, { target: 'ssms', step: 'error', percent: 0, msg: `تعذر تحميل SSMS: ${dlErr.message}` });
      return { success: false, error: dlErr.message };
    }
  }

  broadcastSqlProgress(event, { target: 'ssms', step: 'installing', percent: 95, msg: 'تم تحميل SSMS بنجاح! جاري فتح المثبت الآن...' });
  const openErr = await shell.openPath(ssmsPath);
  if (openErr) {
    return { success: false, error: `تعذر فتح مثبت SSMS: ${openErr}` };
  }
  return { success: true, launched: true, installerPath: ssmsPath };
});

ipcMain.handle('open-downloaded-installer', async (_event, target) => {
  const { shell } = require('electron');
  const { sqlPath, ssmsPath } = getInstallerPaths();
  const targetPath = target === 'ssms' ? ssmsPath : sqlPath;
  if (!fs.existsSync(targetPath)) {
    return { success: false, error: 'ملف التثبيت غير موجود بعد، يرجى تحميله أولاً.' };
  }
  const openErr = await shell.openPath(targetPath);
  if (openErr) return { success: false, error: openErr };
  return { success: true };
});

ipcMain.handle('check-sql-status', async () => {
  const envState = await detectSqlEnvironment();
  if (envState.sqlReady) {
    return { running: true, port: 1433, ...envState };
  }
  if (envState.sqlInstalled) {
    await ensureSqlConfigured();
    const schemaRes = await ensureBackendSchemaReady(20000);
    if (schemaRes.ok) {
      return { running: true, port: 1433, configured: true, ...envState, sqlReady: true };
    }
    return {
      running: false,
      error: schemaRes.error || 'تعذر ربط وتهيئة جداول قاعدة البيانات في SQL Server.',
      ...envState,
    };
  }
  return { running: false, error: 'محرك SQL Server غير متصل حالياً', ...envState };
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
    const activeRequests = new Set();
    const timers = [];

    const VIRTUAL_ADAPTER_REGEX = /vEthernet|WSL|VMware|VirtualBox|Hyper-V|Docker|Loopback|ZeroTier|Tailscale|Hamachi|Teredo|Bluetooth/i;

    const udpClient = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = (ip) => {
      if (!finished) {
        finished = true;
        for (const t of timers) clearTimeout(t);
        for (const req of activeRequests) {
          try { req.destroy(); } catch (_) { }
        }
        activeRequests.clear();
        try { udpClient.close(); } catch (_) { }
        resolve(ip);
      }
    };

    const probe = (targetIp, timeoutMs = 700) => new Promise((res) => {
      if (finished) return res(null);
      const req = http.get(`http://${targetIp}:4000/health`, { timeout: timeoutMs }, (r) => {
        if (r.statusCode !== 200) {
          r.resume();
          activeRequests.delete(req);
          return res(null);
        }
        let body = '';
        r.on('data', (chunk) => { body += chunk; });
        r.on('end', () => {
          activeRequests.delete(req);
          try {
            const parsed = JSON.parse(body);
            if (parsed && (parsed.service === 'al-muttahida-backend' || parsed.ok === true)) {
              return res(targetIp);
            }
          } catch (_) { }
          return res(null);
        });
      });
      activeRequests.add(req);
      req.on('error', () => {
        activeRequests.delete(req);
        res(null);
      });
      req.on('timeout', () => {
        activeRequests.delete(req);
        try { req.destroy(); } catch (_) { }
        res(null);
      });
    });

    // Helper: compute directed subnet broadcast (e.g., 192.168.1.255)
    const getBroadcastAddress = (ip, netmask) => {
      const ipParts = String(ip).split('.').map(Number);
      const maskParts = String(netmask || '255.255.255.0').split('.').map(Number);
      if (ipParts.length !== 4 || maskParts.length !== 4) return null;
      return ipParts.map((octet, idx) => (octet | (~maskParts[idx] & 255))).join('.');
    };

    // Collect active LAN interfaces (prefer physical adapters over virtual ones)
    const ifaces = os.networkInterfaces();
    const ownIps = new Set();
    const activeSubnets = [];
    const fallbackSubnets = [];
    const broadcastTargets = new Set(['255.255.255.255']);

    for (const name of Object.keys(ifaces)) {
      const isVirtual = VIRTUAL_ADAPTER_REGEX.test(name);
      for (const iface of ifaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
          ownIps.add(iface.address);
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
            if (!isVirtual) {
              if (!activeSubnets.includes(subnet)) activeSubnets.push(subnet);
            } else {
              if (!fallbackSubnets.includes(subnet)) fallbackSubnets.push(subnet);
            }
          }
          const bcast = getBroadcastAddress(iface.address, iface.netmask);
          if (bcast) broadcastTargets.add(bcast);
        }
      }
    }

    // 1. UDP Discovery (with directed broadcasts + 3 retries)
    udpClient.on('error', () => { });
    udpClient.on('message', async (msg, rinfo) => {
      if (finished) return;
      try {
        const data = JSON.parse(msg.toString());
        if (data.service === 'al-muttahida-backend' || data.serverIp) {
          const candidates = [rinfo.address, data.serverIp, ...(Array.isArray(data.allIps) ? data.allIps : [])]
            .filter((ip, idx, arr) => ip && ip !== '127.0.0.1' && arr.indexOf(ip) === idx);
          for (const candidate of candidates) {
            const ok = await probe(candidate, 900);
            if (ok) return finish(ok);
          }
          finish(rinfo.address || data.serverIp);
        }
      } catch (_) { }
    });

    const sendDiscoveryPings = () => {
      if (finished) return;
      const msg = Buffer.from('ALMUTTAHIDA_DISCOVERY_PING');
      for (const target of broadcastTargets) {
        try {
          udpClient.send(msg, 0, msg.length, 4001, target);
        } catch (_) { }
      }
    };

    try {
      udpClient.bind(() => {
        try {
          udpClient.setBroadcast(true);
          sendDiscoveryPings();
          timers.push(setTimeout(sendDiscoveryPings, 450));
          timers.push(setTimeout(sendDiscoveryPings, 1000));
        } catch (_) { }
      });
    } catch (_) { }

    // Global safety timeout (7.5s so batched scan finishes cleanly even when UDP is blocked)
    timers.push(setTimeout(() => finish(null), 7500));

    // Helper: probe a list of IPs with bounded concurrency so Windows TCP stack never chokes
    const probeBatchList = async (ips, batchSize = 30, timeoutMs = 650) => {
      for (let i = 0; i < ips.length; i += batchSize) {
        if (finished) return null;
        const batch = ips.slice(i, i + batchSize);
        const results = await Promise.all(batch.map((ip) => probe(ip, timeoutMs)));
        const hit = results.find(Boolean);
        if (hit) return hit;
      }
      return null;
    };

    // 2. Fast ARP cache probe (checks recently seen LAN hosts in < 300ms)
    const arpIps = await new Promise((res) => {
      if (process.platform !== 'win32') return res([]);
      exec('arp -a', { timeout: 1200 }, (_err, stdout) => {
        if (!stdout) return res([]);
        const matches = stdout.match(/\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g) || [];
        const unique = Array.from(new Set(matches)).filter(
          (ip) => !ownIps.has(ip) && !ip.endsWith('.255') && !ip.endsWith('.0')
        );
        res(unique);
      });
    });

    if (!finished && arpIps.length > 0) {
      const arpHit = await probeBatchList(arpIps, 25, 600);
      if (arpHit) return finish(arpHit);
    }

    // 3. Prioritized subnet scan (client's own active LAN subnet(s) first, bounded concurrency)
    const orderedSubnets = [...activeSubnets];
    if (orderedSubnets.length === 0) {
      for (const s of [...fallbackSubnets, '192.168.1', '192.168.0', '192.168.100', '10.0.0']) {
        if (!orderedSubnets.includes(s)) orderedSubnets.push(s);
      }
    }

    const alreadyProbed = new Set(arpIps);
    for (const subnet of orderedSubnets) {
      if (finished) break;
      const subnetIps = [];
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        if (!ownIps.has(ip) && !alreadyProbed.has(ip)) {
          subnetIps.push(ip);
        }
      }
      const hit = await probeBatchList(subnetIps, 35, 550);
      if (hit) return finish(hit);
    }

    // 4. Last resort: check localhost in case server is running on this same machine
    if (!finished) {
      const localHit = await probe('127.0.0.1', 500);
      if (localHit) return finish('127.0.0.1');
    }

    finish(null);
  });
});

// ── IPC: Handle setup choices ───────────────────────────────────

ipcMain.on('start-app', async (event, config) => {
  const { mode, serverIp } = config;

  try {
    if (mode === 'server') {
      ensureFirewallRules();
      await ensureSqlConfigured().catch(() => { });

      if (event.sender) {
        event.sender.send('setup-status', 'جاري تشغيل السيرفر وقاعدة البيانات...');
      }

      let port;
      try {
        port = (await startBackend()) || 4000;
      } catch (beErr) {
        if (event.sender) {
          event.sender.send('setup-error', `تعذر بدء السيرفر المحلي: ${beErr.message}`);
        }
        return;
      }

      const apiUrl = `http://127.0.0.1:${port}`;
      currentApiUrl = apiUrl;

      // Check database connection via /health/db (allow up to 45s for first-time schema/index initialization)
      let dbReady = false;
      for (let i = 0; i < 45; i++) {
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
      const apiUrl = buildCleanApiUrl(serverIp, 4000);
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
    const apiUrl = buildCleanApiUrl(remoteIp || '127.0.0.1', 4000);
    createMainWindow(apiUrl);
    return;
  }

  // Server mode: open UI window immediately while launching backend in parallel
  try {
    const apiPort = Number(appConfig?.port || 4000);
    createMainWindow(`http://127.0.0.1:${apiPort}`);
    ensureFirewallRules();
    console.log('Auto-launching local Express backend...');
    startBackend()
      .catch((e) => {
        console.warn('Backend start warning, ensuring SQL configuration:', e.message);
        return ensureSqlConfigured().then(() => startBackend());
      })
      .catch((err) => {
        console.error('Failed to auto-start backend server:', err);
      });
    if (!appConfig.lastSuccessfulServer) {
      ensureSqlConfigured().catch(() => { });
    }
  } catch (err) {
    console.error('Failed to auto-start backend server:', err);
    if (!mainWindow) {
      createMainWindow('http://127.0.0.1:4000');
    }
  }
}

let lastUpdaterStatus = null;

function sendUpdaterStatus(payload) {
  lastUpdaterStatus = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('updater-status', payload);
    } catch (_) { }
  }
}

function isAllowedUpdateUrl(rawUrl) {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:') {
      const h = parsed.hostname;
      return (
        h === 'localhost' ||
        h === '127.0.0.1' ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
      );
    }
    return false;
  } catch {
    return false;
  }
}

function resolveUpdateUrl() {
  const cfg = appConfig || loadConfig();
  const customUrl = (process.env.UPDATE_URL || cfg?.updateUrl || '').trim();
  return isAllowedUpdateUrl(customUrl) ? customUrl : null;
}

function prepareForUpdateInstall() {
  isAppQuitting = true;
  stopWhatsappLoginWatcher();
  stopBackend();
  for (const refName of ['whatsappWindow', 'setupWindow', 'mainWindow']) {
    try {
      const win = refName === 'whatsappWindow' ? whatsappWindow : refName === 'setupWindow' ? setupWindow : mainWindow;
      if (win && !win.isDestroyed()) {
        win.removeAllListeners('close');
        win.destroy();
      }
    } catch (_) { }
  }
  whatsappWindow = null;
  setupWindow = null;
  mainWindow = null;
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;

  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    const customUrl = resolveUpdateUrl();
    if (customUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: customUrl });
    }

    autoUpdater.on('checking-for-update', () => {
      sendUpdaterStatus({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      sendUpdaterStatus({ status: 'available', version: info?.version });
    });

    autoUpdater.on('update-not-available', (info) => {
      sendUpdaterStatus({ status: 'up-to-date', version: info?.version || app.getVersion() });
    });

    autoUpdater.on('download-progress', (progress) => {
      sendUpdaterStatus({
        status: 'downloading',
        percent: Math.round(progress?.percent || 0),
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      sendUpdaterStatus({ status: 'downloaded', version: info?.version });
    });

    autoUpdater.on('before-quit-for-update', () => {
      prepareForUpdateInstall();
    });

    autoUpdater.on('error', (err) => {
      console.warn('[AutoUpdater] Error:', err?.message || err);
      sendUpdaterStatus({ status: 'error', message: err?.message || 'فشل فحص التحديثات' });
    });

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => { });
    }, 8000);

    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => { });
    }, 4 * 60 * 60 * 1000);
  } catch (err) {
    console.warn('[AutoUpdater] Setup failed:', err.message);
  }
}

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-updater-status', () => lastUpdaterStatus);

ipcMain.handle('get-update-url', () => resolveUpdateUrl() || '');

ipcMain.handle('set-update-url', (_event, url) => {
  const cleanUrl = typeof url === 'string' ? url.trim() : '';
  if (cleanUrl && !isAllowedUpdateUrl(cleanUrl)) {
    return { ok: false, error: 'رابط التحديث غير صالح؛ يجب أن يستخدم HTTPS أو عنوان شبكة محلية موثوق.' };
  }
  saveConfig({ updateUrl: cleanUrl || null });
  appConfig = loadConfig();
  if (autoUpdater && app.isPackaged && cleanUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: cleanUrl });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  return { ok: true, updateUrl: cleanUrl };
});

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) {
    return { supported: false, message: 'ميزة التحديث التلقائي غير متاحة' };
  }
  if (!app.isPackaged) {
    return { supported: false, version: app.getVersion(), message: 'الفحص التلقائي يعمل في النسخة المثبتة فقط' };
  }
  try {
    const customUrl = resolveUpdateUrl();
    if (customUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: customUrl });
    }
    const result = await autoUpdater.checkForUpdates();
    return {
      supported: true,
      version: result?.updateInfo?.version || app.getVersion(),
    };
  } catch (err) {
    return { supported: true, error: err?.message || 'تعذر الاتصال بخادم التحديثات' };
  }
});

ipcMain.handle('install-update', () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false };
  prepareForUpdateInstall();
  setTimeout(() => {
    autoUpdater.quitAndInstall(true, true);
  }, 300);
  return { ok: true };
});

// ── WhatsApp Web Persistent Session IPC ────────────────────────
const WHATSAPP_PARTITION = 'persist:whatsapp';
const WHATSAPP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WHATSAPP_LOGIN_CHECK_JS = `
  Boolean(
    window.localStorage.getItem('last-wid-md') ||
    window.localStorage.getItem('last-wid') ||
    document.querySelector('#pane-side, [data-testid="chat-list"], [aria-label="Chat list"], [aria-label="قائمة الدردشات"]')
  )
`;
let whatsappWindow = null;
let whatsappWatcherTimer = null;

function stopWhatsappLoginWatcher() {
  if (whatsappWatcherTimer) {
    clearInterval(whatsappWatcherTimer);
    whatsappWatcherTimer = null;
  }
}

function sendWhatsappSessionUpdate(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('whatsapp-session-updated', payload);
    } catch (_) { }
  }
}

function startWhatsappLoginWatcher(win) {
  stopWhatsappLoginWatcher();
  whatsappWatcherTimer = setInterval(async () => {
    if (!win || win.isDestroyed()) {
      stopWhatsappLoginWatcher();
      return;
    }
    try {
      const loggedIn = await win.webContents.executeJavaScript(WHATSAPP_LOGIN_CHECK_JS).catch(() => false);
      if (loggedIn) {
        saveConfig({ whatsappSessionConnected: true });
        appConfig = loadConfig();
        sendWhatsappSessionUpdate({ connected: true, windowOpen: true });
        stopWhatsappLoginWatcher();
      }
    } catch (_) { }
  }, 2000);
}

let isAppQuitting = false;

function ensureWhatsappWindow(showWindow = false) {
  if (whatsappWindow && !whatsappWindow.isDestroyed()) {
    if (showWindow) {
      if (whatsappWindow.isMinimized()) whatsappWindow.restore();
      whatsappWindow.show();
      whatsappWindow.focus();
    }
    return whatsappWindow;
  }

  whatsappWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    show: showWindow,
    title: 'جلسة واتساب ويب - شركة المتحدة',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      partition: WHATSAPP_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  whatsappWindow.setMenuBarVisibility(false);
  whatsappWindow.webContents.setUserAgent(WHATSAPP_UA);
  whatsappWindow.on('close', (e) => {
    if (!isAppQuitting && whatsappWindow && !whatsappWindow.isDestroyed()) {
      e.preventDefault();
      whatsappWindow.hide();
    }
  });
  whatsappWindow.on('closed', () => {
    stopWhatsappLoginWatcher();
    whatsappWindow = null;
  });
  return whatsappWindow;
}

ipcMain.handle('whatsapp-check-session', async () => {
  try {
    let hasLoggedInDom = false;
    if (whatsappWindow && !whatsappWindow.isDestroyed()) {
      hasLoggedInDom = await whatsappWindow.webContents
        .executeJavaScript(WHATSAPP_LOGIN_CHECK_JS)
        .catch(() => false);
      if (hasLoggedInDom) {
        saveConfig({ whatsappSessionConnected: true });
        appConfig = loadConfig();
      }
    }
    const cfg = appConfig || loadConfig();
    const waSession = session.fromPartition(WHATSAPP_PARTITION);
    const cookies = await waSession.cookies.get({});
    const hasWaCookies = cookies.some((c) => (c.domain || '').includes('whatsapp.com'));
    const indexedDbDir = path.join(app.getPath('userData'), 'Partitions', 'whatsapp', 'IndexedDB');
    const hasIndexedDbOnDisk = fs.existsSync(indexedDbDir) && fs.readdirSync(indexedDbDir).length > 0;
    const connected = Boolean(
      hasLoggedInDom || cfg?.whatsappSessionConnected === true || (hasWaCookies && hasIndexedDbOnDisk),
    );
    return {
      connected,
      windowOpen: Boolean(whatsappWindow && !whatsappWindow.isDestroyed()),
    };
  } catch (err) {
    return { connected: false, windowOpen: false, error: err?.message };
  }
});

ipcMain.handle('whatsapp-open-session', async () => {
  try {
    const win = ensureWhatsappWindow(true);
    const currentUrl = win.webContents.getURL();
    if (!currentUrl || !currentUrl.startsWith('https://web.whatsapp.com')) {
      await win.loadURL('https://web.whatsapp.com/', { userAgent: WHATSAPP_UA });
    }
    startWhatsappLoginWatcher(win);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'تعذر فتح نافذة واتساب ويب' };
  }
});

ipcMain.handle('whatsapp-logout-session', async () => {
  try {
    stopWhatsappLoginWatcher();
    saveConfig({ whatsappSessionConnected: false });
    appConfig = loadConfig();
    if (whatsappWindow && !whatsappWindow.isDestroyed()) {
      whatsappWindow.destroy();
      whatsappWindow = null;
    }
    const waSession = session.fromPartition(WHATSAPP_PARTITION);
    await waSession.clearStorageData();
    sendWhatsappSessionUpdate({ connected: false, windowOpen: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'تعذر مسح الجلسة' };
  }
});

ipcMain.handle('whatsapp-send-web-message', async (_event, payload) => {
  const cleanPhone = String(payload?.phone || '').replace(/\D/g, '');
  const message = String(payload?.message || '');
  if (!cleanPhone || !message) {
    return { ok: false, reason: 'invalid_phone', error: 'رقم الهاتف أو نص الرسالة غير مكتمل' };
  }

  try {
    const win = ensureWhatsappWindow(false);
    const targetUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;
    await win.loadURL(targetUrl, { userAgent: WHATSAPP_UA });

    const outcome = await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        let attempts = 0;
        const timer = setInterval(() => {
          attempts += 1;

          // 1. Check if QR screen appeared (not logged in)
          const hasQrCanvas = Boolean(document.querySelector('canvas[aria-label]'));
          const hasChatPane = Boolean(document.querySelector('#pane-side, [data-testid="chat-list"]'));
          if (hasQrCanvas && !hasChatPane && attempts >= 5) {
            clearInterval(timer);
            resolve({ status: 'not_logged_in' });
            return;
          }

          // 2. Check for invalid phone / no WhatsApp account modal
          const popup = document.querySelector('[data-animate-modal-popup="true"], [role="dialog"]');
          if (popup) {
            const txt = (popup.textContent || '').toLowerCase();
            if (
              txt.includes('invalid') ||
              txt.includes('not on whatsapp') ||
              txt.includes('غير صحيح') ||
              txt.includes('غير مسجل') ||
              txt.includes('ليس على واتساب') ||
              txt.includes('رابط غير صالح')
            ) {
              const okBtn = popup.querySelector('button');
              if (okBtn) okBtn.click();
              clearInterval(timer);
              resolve({ status: 'no_whatsapp' });
              return;
            }
          }

          // 3. Check for send button
          const btn =
            document.querySelector('button[aria-label="Send"], button[aria-label="إرسال"]') ||
            document.querySelector('span[data-icon="send"]')?.closest('button') ||
            document.querySelector('span[data-icon="wds-ic-send-filled"]')?.closest('button');
          if (btn) {
            clearInterval(timer);
            setTimeout(() => {
              btn.click();
              resolve({ status: 'sent' });
            }, 700);
            return;
          }

          if (attempts >= 25) {
            clearInterval(timer);
            resolve({ status: 'timeout' });
          }
        }, 900);
      })
    `);

    if (outcome?.status === 'sent') {
      saveConfig({ whatsappSessionConnected: true });
      appConfig = loadConfig();
      return { ok: true, autoSent: true };
    }
    if (outcome?.status === 'no_whatsapp') {
      return { ok: false, reason: 'no_whatsapp', error: 'هذا الرقم لا يملك حساب واتساب' };
    }
    if (outcome?.status === 'not_logged_in') {
      return { ok: false, reason: 'not_logged_in', error: 'يرجى مسح كود QR أولاً لتفعيل الجلسة' };
    }
    return { ok: false, reason: 'timeout', error: 'انتهت مهلة تحميل المحادثة' };
  } catch (err) {
    return { ok: false, reason: 'send_error', error: err?.message || 'فشل إرسال الرسالة عبر جلسة واتساب ويب' };
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  initAndLaunch();
  setupAutoUpdater();

  let resumeTimer = null;

  const verifyMainWindowAfterWake = async () => {
    if (appConfig?.mode !== 'client') {
      ensureBackendRunning(Number(appConfig?.port || 4000)).catch(() => { });
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;

    forceWindowRepaint();
    if (mainWindow.isFocused()) {
      mainWindow.webContents.focus();
    }

    try {
      const hasContent = await Promise.race([
        mainWindow.webContents.executeJavaScript(
          'Boolean(document.getElementById("root") && document.getElementById("root").childElementCount > 0 && document.body && document.body.innerText.trim().length > 0)'
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error('renderer-timeout')), 3000)),
      ]);
      if (!hasContent && mainWindow && !mainWindow.isDestroyed()) {
        console.warn('[Main Window] Blank DOM detected on resume/unlock; reloading safely...');
        reloadMainWindowSafely();
      }
    } catch (err) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.warn(`[Main Window] Renderer check failed on resume/unlock (${err?.message || 'timeout'}); reloading safely...`);
        reloadMainWindowSafely();
      }
    }
  };

  const repaintMainWindow = () => {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
    }
    // Wait briefly so Windows display driver & network NIC finish waking from sleep
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      void verifyMainWindowAfterWake();
    }, 800);
  };

  app.on('child-process-gone', (_event, details) => {
    if (details?.type === 'GPU' && mainWindow && !mainWindow.isDestroyed()) {
      console.warn(`[Main Window] GPU process gone (${details?.reason}); forcing repaint & health check...`);
      setTimeout(() => {
        forceWindowRepaint();
        void verifyMainWindowAfterWake();
      }, 500);
    }
  });

  powerMonitor.on('unlock-screen', repaintMainWindow);
  powerMonitor.on('resume', repaintMainWindow);

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
  isAppQuitting = true;
  if (whatsappWindow && !whatsappWindow.isDestroyed()) {
    whatsappWindow.destroy();
    whatsappWindow = null;
  }
  stopBackend();
});
