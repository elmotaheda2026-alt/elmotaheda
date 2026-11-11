const { contextBridge, ipcRenderer } = require('electron');

try {
  let apiBaseUrl = 'http://127.0.0.1:4000';
  try {
    apiBaseUrl = ipcRenderer.sendSync('get-api-url');
  } catch (_) {}

  contextBridge.exposeInMainWorld('__API_BASE_URL__', apiBaseUrl);

  contextBridge.exposeInMainWorld('electronAPI', {
    // 1. SQL Server engine & setup
    checkSqlStatus: () => ipcRenderer.invoke('check-sql-status'),
    downloadAndInstallSql: () => ipcRenderer.invoke('download-and-install-sql'),
    onSqlProgress: (callback) => ipcRenderer.on('sql-install-progress', (_event, data) => callback(data)),

    // 2. Network scan & client probe
    scanNetwork: () => ipcRenderer.invoke('scan-network'),
    testServerIp: (ip) => ipcRenderer.invoke('test-server-ip', ip),

    // 3. Application start & lifecycle
    startApp: (config) => ipcRenderer.send('start-app', config),
    closeWindow: () => ipcRenderer.send('close-window'),

    // 4. Events & listeners
    onStatus: (callback) => ipcRenderer.on('setup-status', (_event, message) => callback(message)),
    onError: (callback) => ipcRenderer.on('setup-error', (_event, message) => callback(message)),
    onAppStarted: (callback) => ipcRenderer.on('app-started', (_event, data) => callback(data)),

    // 5. System helpers
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    openSetupWindow: () => ipcRenderer.send('open-setup-window'),
    runFirewallSetup: () => ipcRenderer.invoke('run-firewall-setup'),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  });
} catch (err) {
  console.error('Failed to initialize preload-main:', err);
}
