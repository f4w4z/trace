const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('trace', {
  api: (method, endpoint, body) => ipcRenderer.invoke('api-request', method, endpoint, body),
  onFocusSearch: (fn) => ipcRenderer.on('focus-search', fn),
  onBlurHide: (fn) => ipcRenderer.on('blur-hide', fn),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  username: () => ipcRenderer.invoke('get-username'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  getIcon: () => ipcRenderer.invoke('get-icon'),
  execCommand: (cmd) => ipcRenderer.invoke('exec-command', cmd),
  conversationsList: () => ipcRenderer.invoke('conversations-list'),
  conversationGet: (id) => ipcRenderer.invoke('conversation-get', id),
  conversationSave: (conv) => ipcRenderer.invoke('conversation-save', conv),
  conversationDelete: (id) => ipcRenderer.invoke('conversation-delete', id),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  setRunAtStartup: (enable) => ipcRenderer.invoke('set-run-at-startup', enable),
})
