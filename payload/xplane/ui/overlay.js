'use strict';
const $=id=>document.getElementById(id);
const num=(v,n)=>Number.isFinite(v)?v.toFixed(n):'—';
window.avgOverlay.listen((payload)=>{
 const {title,detail,type}=payload;
 $('notice').className='notice '+type;
 const isLanding=type==='landing';
 $('standard').hidden=isLanding;
 $('landing').hidden=!isLanding;
 if(isLanding){
   $('landing-metrics').textContent='Velocidad vertical: '+num(payload.verticalSpeedFpm,2)+' pies/min | Fuerza G: '+num(payload.gForce,2);
   $('landing-detail').textContent=detail||'Contacto registrado';
   $('landing-nose').textContent='Morro: '+num(payload.noseRateDegSec,2)+' °/s | Flotación est.: '+(Number.isFinite(payload.floatSeconds)?'≈'+payload.floatSeconds.toFixed(1)+' s':'—');
   $('landing-verdict').textContent=payload.verdict||'ATERRIZAJE';
 }else{
   $('title').textContent=title;
   $('detail').textContent=detail;
 }
});
