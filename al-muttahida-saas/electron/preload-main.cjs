const { contextBridge, ipcRenderer } = require('electron');

try {
  const apiBaseUrl = ipcRenderer.sendSync('get-api-url');
  contextBridge.exposeInMainWorld('__API_BASE_URL__', apiBaseUrl);
  contextBridge.exposeInMainWorld('electronAPI', {
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
  });
} catch (err) {
  console.error('Failed to initialize preload:', err);
}
