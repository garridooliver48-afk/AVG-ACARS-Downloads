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
   $('landing-metrics').textContent='Vertical Speed: '+num(payload.verticalSpeedFpm,2)+' FPM / '+num(payload.gForce,2)+' G';
   $('landing-detail').textContent=detail||'Touchdown recorded';
   $('landing-nose').textContent='Nose: '+num(payload.noseRateDegSec,2)+' deg/sec | Float: '+(Number.isFinite(payload.floatSeconds)?'~'+payload.floatSeconds.toFixed(1):'—')+' secs';
   $('landing-verdict').textContent=payload.verdict||'LANDING';
 }else{
   $('title').textContent=title;
   $('detail').textContent=detail;
 }
});
