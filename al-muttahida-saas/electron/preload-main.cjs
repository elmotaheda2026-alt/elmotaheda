const { contextBridge, ipcRenderer } = require('electron');

try {
  const apiBaseUrl = ipcRenderer.sendSync('get-api-url');
  contextBridge.exposeInMainWorld('__API_BASE_URL__', apiBaseUrl);
} catch (err) {
  console.error('Failed to get API base URL in preload:', err);
}
