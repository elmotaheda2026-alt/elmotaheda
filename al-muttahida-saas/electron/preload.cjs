const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startApp: (config) => ipcRenderer.send('start-app', config),
  onError: (callback) => ipcRenderer.on('setup-error', (_event, message) => callback(message)),
});
