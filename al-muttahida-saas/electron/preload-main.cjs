const { contextBridge, ipcRenderer } = require('electron');

try {
  let apiBaseUrl = 'http://127.0.0.1:4000';
  try {
    apiBaseUrl = ipcRenderer.sendSync('get-api-url');
  } catch (_) {}

  contextBridge.exposeInMainWorld('__API_BASE_URL__', apiBaseUrl);

  contextBridge.exposeInMainWorld('electronAPI', {
    // 1. SQL Server engine, SSMS & setup
    checkSqlStatus: () => ipcRenderer.invoke('check-sql-status'),
    checkSqlEnvironment: () => ipcRenderer.invoke('check-sql-environment'),
    configureSqlDatabase: () => ipcRenderer.invoke('configure-sql-database'),
    downloadAndInstallSql: () => ipcRenderer.invoke('download-and-install-sql'),
    downloadSsmsInstaller: () => ipcRenderer.invoke('download-ssms-installer'),
    openDownloadedInstaller: (target) => ipcRenderer.invoke('open-downloaded-installer', target),
    saveCustomSqlConfig: (cfg) => ipcRenderer.invoke('save-custom-sql-config', cfg),
    onSqlProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('sql-install-progress', handler);
      return () => ipcRenderer.removeListener('sql-install-progress', handler);
    },

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
    onNavigate: (callback) => ipcRenderer.on('navigate-to', (_event, route) => callback(route)),

    // 5. System helpers
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    openSetupWindow: () => ipcRenderer.send('open-setup-window'),
    runFirewallSetup: () => ipcRenderer.invoke('run-firewall-setup'),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    printPreviewHtml: (payload) => ipcRenderer.invoke('print-preview-html', payload),
    printPreviewCurrent: (payload) => ipcRenderer.invoke('print-preview-current', payload),

    // 6. Auto-updater
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getUpdateUrl: () => ipcRenderer.invoke('get-update-url'),
    setUpdateUrl: (url) => ipcRenderer.invoke('set-update-url', url),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdaterStatus: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('updater-status', handler);
      return () => ipcRenderer.removeListener('updater-status', handler);
    },

    // 7. WhatsApp Web Session
    openWhatsappSession: () => ipcRenderer.invoke('whatsapp-open-session'),
    checkWhatsappSession: () => ipcRenderer.invoke('whatsapp-check-session'),
    logoutWhatsappSession: () => ipcRenderer.invoke('whatsapp-logout-session'),
    sendWhatsappWebMessage: (payload) => ipcRenderer.invoke('whatsapp-send-web-message', payload),
    onWhatsappSessionUpdated: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('whatsapp-session-updated', handler);
      return () => ipcRenderer.removeListener('whatsapp-session-updated', handler);
    },
  });
} catch (err) {
  console.error('Failed to initialize preload-main:', err);
}
