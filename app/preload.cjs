const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('trace', {
  api: (method, endpoint, body) => ipcRenderer.invoke('api-request', method, endpoint, body),
  onFocusSearch: (fn) => ipcRenderer.on('focus-search', fn),
  onBlurHide: (fn) => ipcRenderer.on('blur-hide', fn),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  username: () => ipcRenderer.invoke('get-username'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  getIcon: () => ipcRenderer.invoke('get-icon'),
})
