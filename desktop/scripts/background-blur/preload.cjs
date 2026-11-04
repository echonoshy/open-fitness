const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('blurArtifacts', {
  save: (name, data) => ipcRenderer.invoke('save-blur-artifact', { name, data }),
});
