'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('avgOverlay', {
  listen(callback) {
    ipcRenderer.on('avg:overlay', (_event, payload) => {
      if (payload && ['start', 'complete', 'ready'].includes(payload.type)) {
        callback({ title: String(payload.title || ''), detail: String(payload.detail || ''), type: payload.type });
      }
    });
  },
});
