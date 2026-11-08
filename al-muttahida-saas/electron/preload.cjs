const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startApp: (config) => ipcRenderer.send('start-app', config),
  onError: (callback) => ipcRenderer.on('setup-error', (_event, message) => callback(message)),
  onStatus: (callback) => ipcRenderer.on('setup-status', (_event, message) => callback(message)),
  checkSqlStatus: () => ipcRenderer.invoke('check-sql-status'),
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  testServerIp: (ip) => ipcRenderer.invoke('test-server-ip', ip),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  runFirewallSetup: () => ipcRenderer.invoke('run-firewall-setup'),
  closeWindow: () => ipcRenderer.send('close-setup-window'),
});
