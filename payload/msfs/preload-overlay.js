'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('avgOverlay', {
 listen(callback) {
  ipcRenderer.on('avg:overlay', (_event, payload) => {
   if (!payload || !['start','complete','ready','landing'].includes(payload.type)) return;
   callback({
    type:payload.type,title:String(payload.title||''),detail:String(payload.detail||''),
    ...(payload.type==='landing'?{
     verticalSpeedFpm:payload.verticalSpeedFpm,
     gForce:payload.gForce,
     noseRateDegSec:payload.noseRateDegSec,
     floatSeconds:payload.floatSeconds,
     floatEstimated:payload.floatEstimated === true,
     verdict:String(payload.verdict||'LANDING').slice(0,35)
    }:{})
   });
  });
 }
});
