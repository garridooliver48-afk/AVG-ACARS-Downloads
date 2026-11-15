'use strict';
// No screen/desktop capture. An opt-in is required on every ACARS session.
const {desktopCapturer,dialog}=require('electron');
function createSimulatorCapture({simulator,enqueue,onStatus=()=>{}}){
 let allowed=false;
 const validName=name=>simulator==='msfs'?/^Microsoft Flight Simulator(?: 2020)?(?:$|[ -])/i.test(name):/^(?:X-Plane(?: 12)?(?:$|[ .-])|X-System(?:$|[ -]))/i.test(name);
 async function consent(){
  try{const r=await dialog.showMessageBox({type:'question',title:'AVG FDR - capturas de incidentes',message:'¿Autorizar capturas automáticas del simulador durante esta sesión?',detail:'Solo al detectar un incidente, AVG guardará hasta dos imágenes de la ventana del simulador y las enviará al expediente, visible para ti, AVG-001 y AVG-002 (consulta de seguridad). No se envían imágenes del escritorio ni de otras aplicaciones. Puedes rechazarlo y seguir volando.' ,buttons:['No autorizar','Autorizar esta sesión'],defaultId:0,cancelId:0,noLink:true});allowed=r.response===1;}catch{allowed=false;}
 }
 async function snap(event,phase,expectedId){
  if(!allowed)return null;
  // Window thumbnails are obtained locally by Electron. Only one recognized simulator window is retained.
  const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1280,height:720},fetchWindowIcons:false});
  const matches=sources.filter(s=>validName(s.name)&&(!expectedId||s.id===expectedId));
  if(matches.length!==1)return null;
  const source=matches[0],image=source.thumbnail;
  if(!image||image.isEmpty())return null;
  const jpeg=image.toJPEG(78);
  if(!jpeg.length||jpeg.length>600000)return null;
  const capturedAt=Date.now(),occurredAt=event.samples.at(-1)?.at;
  if(!Number.isFinite(occurredAt)||capturedAt<occurredAt-1000||capturedAt>occurredAt+15000)return null;
  enqueue({capture:true,eventId:event.eventId,phase,capturedAt,consent:true,flightId:event.flightId,licenseNumber:event.licenseNumber,apiBaseUrl:event.apiBaseUrl,jpeg:'data:image/jpeg;base64,'+jpeg.toString('base64')});
  return source.id;
 }
 async function onIncident(event){
  if(!allowed||event.relatedEventId)return;
  try{
   const source=await snap(event,'alert');if(!source){onStatus('No se pudo identificar una ventana del simulador para guardar la captura. La telemetría se conserva.');return;}
   onStatus('Captura de la ventana del simulador guardada para el expediente.');
   await new Promise(resolve=>setTimeout(resolve,2500));
   await snap(event,'after',source);
  }catch{onStatus('No se pudo guardar una captura. La alerta de telemetría no se modifica.');}
 }
 return {consent,onIncident};
}
module.exports={createSimulatorCapture};
