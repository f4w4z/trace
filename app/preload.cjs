const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('smt', {
  api: (method, endpoint, body) => ipcRenderer.invoke('api-request', method, endpoint, body),
  onFocusSearch: (fn) => ipcRenderer.on('focus-search', fn),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
})
