// The only bridge between the setup wizard page and the app. The page gets these functions and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hearth', {
  state: () => ipcRenderer.invoke('wizard:state'),
  detectOllama: () => ipcRenderer.invoke('wizard:detect-ollama'),
  dockerCheck: () => ipcRenderer.invoke('wizard:docker-check'),
  testRemote: (url) => ipcRenderer.invoke('wizard:test-remote', url),
  testHomeAssistant: (url, token) => ipcRenderer.invoke('wizard:test-ha', url, token),
  chooseFolder: (current) => ipcRenderer.invoke('wizard:choose-folder', current),
  openExternal: (url) => ipcRenderer.invoke('wizard:open-external', url),
  apply: (cfg) => ipcRenderer.invoke('wizard:apply', cfg),
  finish: () => ipcRenderer.invoke('wizard:finish'),
  cancel: () => ipcRenderer.invoke('wizard:cancel'),
  onProgress: (fn) => ipcRenderer.on('wizard:progress', (e, ev) => fn(ev)),
  onPrefill: (fn) => ipcRenderer.on('wizard:prefill', (e, p) => fn(p)),
});
