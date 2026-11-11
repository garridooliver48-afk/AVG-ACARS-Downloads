'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['status', 'flight', 'telemetry', 'message', 'pending', 'auth', 'training']);
contextBridge.exposeInMainWorld('avg', {
  getInitial: () => ipcRenderer.invoke('avg:getInitial'),
  login: data => ipcRenderer.invoke('avg:login', data),
  logout: () => ipcRenderer.invoke('avg:logout'),
  connect: () => ipcRenderer.invoke('avg:connect'),
  disconnect: () => ipcRenderer.invoke('avg:disconnect'),
  sendPirep: () => ipcRenderer.invoke('avg:sendPirep'),
  discardPirep: () => ipcRenderer.invoke('avg:discardPirep'),
  openPortal: () => ipcRenderer.invoke('avg:openPortal'),
  startTraining: () => ipcRenderer.invoke('avg:startTraining'),
  stopTraining: () => ipcRenderer.invoke('avg:stopTraining'),
  onEvent: listener => {
    const handler = (_evt, packet) => { if (allowed.has(packet?.event)) listener(packet.event, packet.payload); };
    ipcRenderer.on('avg:event', handler);
    return () => ipcRenderer.removeListener('avg:event', handler);
  },
});
