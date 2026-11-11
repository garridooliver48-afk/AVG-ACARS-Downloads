'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {EventEmitter}=require('node:events');const Module=require('node:module');
const {classifySafetyWindow:classify}=require('../xplane/lib/safety-rules');
const {SafetyRecorder}=require('../xplane/lib/safety-recorder');
const {SafetyOutbox}=require('../xplane/lib/safety-outbox');
const {normalizeTelemetry,DATAREFS}=require('../xplane/lib/xplane-rref');
const base={at:Date.now(),latitude:14.58,longitude:-90.52,altitude:5000,groundSpeed:80,onGround:false,
  gForce:1,bank:0,verticalSpeed:-1000,paused:false,replay:false,slew:false,safetyReady:true};
function sequence(end={}){return [base,{...base,at:base.at+200,altitude:4997,onGround:true,gForce:3,...end}];}
test('reglas: aterrizaje fuerte, impacto, vuelco y choque explícito',()=>{
 assert.equal(classify(sequence()).kind,'HARD_LANDING');
 assert.equal(classify(sequence({gForce:4})).kind,'GROUND_IMPACT');
 assert.equal(classify(sequence({gForce:1,bank:70})).kind,'GROUND_BANK');
 assert.equal(classify(sequence({gForce:1,groundSpeed:0,crashDetected:true})).kind,'SIM_CRASH');
 assert.equal(classify([{...base,verticalSpeed:-2000},{...base,at:base.at+1000,altitude:4900,groundSpeed:0,onGround:true}]).kind,'ABRUPT_STOP');
});
test('reglas: llegada normal, pausa, replay, slew, desconexión y teletransporte no generan alertas',()=>{
 for(const end of [{gForce:1.2},{paused:true},{replay:true},{slew:true},{at:base.at+5000},{latitude:10}])assert.equal(classify(sequence(end)),null);
 assert.equal(classify(sequence({gForce:1.1,groundSpeed:3})),null);
});
test('RREF: opcionales ausentes conservan posición; campos de seguridad usan sus unidades',()=>{
 const m=new Map([14.58,-90.52,1000,270,40,0,1,0,0,0].map((v,i)=>[i,v]));
 assert.equal(normalizeTelemetry(m).safetyReady,false);
 [3,25,-950,0,0,0,1].forEach((v,i)=>m.set(10+i,v));
 const s=normalizeTelemetry(m);assert.equal(s.safetyReady,true);assert.equal(s.verticalSpeed,-950);
 assert.equal(s.crashDetected,true);assert.equal(s.onGround,false);assert.equal(DATAREFS.length,20);
  m.set(17,5);m.set(18,3);m.set(19,-1.25);
  const landing=normalizeTelemetry(m);assert.ok(Math.abs(landing.aglFeet-16.4042)<0.01);assert.equal(landing.pitchDeg,3);assert.equal(landing.pitchRateDegSec,-1.25);
});
test('grabador: persistir antes de marcar; un evento por vuelo; no depende del PIREP',()=>{
 const events=[];let fail=true;const r=new SafetyRecorder(e=>{if(fail)throw Error('disk');events.push(e);},'xplane');
 const context={flightId:'flight1',licenseNumber:'AVG-001',apiBaseUrl:'https://aviacionvirtualgt.com'};
 r.record(context,base);assert.throws(()=>r.record(context,sequence()[1]),/disk/);assert.equal(r.reported,false);
 fail=false;r.record(context,{...sequence()[1],at:base.at+400});assert.equal(events.length,1);
 r.record(context,{...sequence()[1],at:base.at+600});assert.equal(events.length,1);
 assert.equal(events[0].samples.length,3);
});
test('cola durable: caída de red, reinicio, sesión incorrecta y reintento sin duplicados',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'avg-safety-'));const file=path.join(dir,'queue.json');
 const event={eventId:'e1',flightId:'f1',licenseNumber:'AVG-001',apiBaseUrl:'https://aviacionvirtualgt.com',samples:sequence()};
 let calls=0;const config={apiBaseUrl:event.apiBaseUrl,token:'test',licenseNumber:'AVG-001'};
 const box=new SafetyOutbox({file,getSettings:()=>config,request:async()=>{calls++;throw Error('offline');}});
 box.enqueue(event);await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(fs.readFileSync(file)).length,1);
 box.enqueue(event);assert.equal(box.items.length,1);
 const restored=new SafetyOutbox({file,getSettings:()=>({...config,licenseNumber:'AVG-002'}),request:async()=>{throw Error('wrong account sent');}});
 await restored.flush();assert.equal(restored.items.length,1);
 restored.getSettings=()=>config;restored.request=async()=>({data:{status:'received',caseId:'case1'}});
 await restored.flush();assert.deepEqual(JSON.parse(fs.readFileSync(file)),[]);
 fs.rmSync(dir,{recursive:true});
});
test('cola: respuesta incompleta y archivo corrupto nunca borran evidencia',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'avg-safety-'));const file=path.join(dir,'queue.json');
 const box=new SafetyOutbox({file,getSettings:()=>({apiBaseUrl:'http://localhost'}),request:async()=>({data:{}})});
 box.enqueue({eventId:'e',flightId:'f',apiBaseUrl:'http://localhost'});await new Promise(r=>setImmediate(r));assert.equal(box.items.length,1);
 fs.writeFileSync(file,'broken');assert.throws(()=>new SafetyOutbox({file}));fs.rmSync(dir,{recursive:true});
});
test('MSFS: SimConnect recibe unidades, pausa, evento Crashed con clientEventId y motores apagados',async()=>{
 const real=Module._load;const handle=new EventEmitter();const defs=[];const subs=[];
 handle.addToDataDefinition=(...x)=>defs.push(x);handle.subscribeToSystemEvent=(...x)=>subs.push(x);
 handle.requestDataOnSimObject=()=>{};handle.close=()=>{};
 Module._load=function(id,...rest){if(id==='node-simconnect')return {open:async()=>({recvOpen:{applicationName:'MSFS 2020'},handle}),Protocol:{FSX_SP2:1},SimConnectPeriod:{SIM_FRAME:1},SimConnectDataType:{INT32:1,FLOAT64:2}};return real.call(this,id,...rest);};
 const {FlightEngine}=require('../msfs/lib/engine');let now=base.at;const realNow=Date.now;Date.now=()=>now;const events=[];
 const engine=new FlightEngine({emit:()=>{},getPending:()=>null,savePending:()=>{},clearPending:()=>{},recordSafety:e=>events.push(e),
   request:async()=>({data:{flightId:'f1',licenseNumber:'AVG-001',aircraft:'A36',origin:'MGGT',destination:'MGPC'}})});
 try{
  await engine.connect({apiBaseUrl:'http://localhost',token:'t'});
  assert.ok(subs.some(x=>x[1]==='Pause_EX1'));assert.ok(defs.some(x=>x[1]==='VERTICAL SPEED'&&x[2]==='Feet per minute'));
  handle.emit('event',{clientEventId:7101,data:0});
  function data({on=1,ground=0,g=1,vs=-1000,camera=2}={}){const vals=[on,0,14.58,-90.52,5000,0,80,ground,g,0,vs,0,camera];let i=0;engine.onSimData({data:{readInt32:()=>vals[i++],readFloat64:()=>vals[i++]}});}
  data();now+=200;data({on:0,ground:1,g:3});assert.equal(events.length,1);assert.equal(events[0].simulator,'msfs');
  engine.safety.reset();now+=200;data();now+=200;handle.emit('event',{clientEventId:7102,data:0});
  assert.equal(events.length,2);assert.equal(events[1].samples.at(-1).crashDetected,true);
  engine.safety.reset();now+=200;handle.emit('event',{clientEventId:7101,data:4});data({ground:1,g:5});assert.equal(events.length,2);
 }finally{engine.disconnect({silent:true});Date.now=realNow;Module._load=real;}
});
test('X-Plane: captura impacto aunque se apaguen los motores',()=>{
 const {FlightEngine}=require('../xplane/lib/engine');let now=base.at;const realNow=Date.now;Date.now=()=>now;const events=[];
 const engine=new FlightEngine({emit:()=>{},getPending:()=>null,savePending:()=>{},clearPending:()=>{},recordSafety:e=>events.push(e),request:async()=>({data:{}})});
 engine.assignment={flightId:'f1',licenseNumber:'AVG-001'};engine.settings={apiBaseUrl:'http://localhost'};
 try{engine.onXPlaneData({...base,heading:0,enginesRunning:true});now+=200;
 engine.onXPlaneData({...sequence()[1],heading:0,enginesRunning:false});assert.equal(events.length,1);}
 finally{Date.now=realNow;}
});
