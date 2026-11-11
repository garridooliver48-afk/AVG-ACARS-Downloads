'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const Module=require('node:module');const {EventEmitter}=require('node:events');

test('MSFS: entrenamiento conecta sin consultar generador y jamás genera PIREP ni accidentes',async()=>{
 const real=Module._load;
 const handle=new EventEmitter();
 handle.addToDataDefinition=()=>{};handle.subscribeToSystemEvent=()=>{};
 handle.requestDataOnSimObject=()=>{};handle.close=()=>{};
 Module._load=function(id,...args){
  if(id==='node-simconnect')return {
   open:async()=>({recvOpen:{applicationName:'MSFS 2020'},handle}),
   Protocol:{FSX_SP2:1},SimConnectPeriod:{SIM_FRAME:1},
   SimConnectDataType:{INT32:1,FLOAT64:2}
  };
  return real.call(this,id,...args);
 };
 const {FlightEngine}=require('../msfs/lib/engine');
 const events=[],requests=[],safety=[],pireps=[];
 const eng=new FlightEngine({emit:(name,data)=>events.push([name,data]),
  getPending:()=>null,savePending:x=>pireps.push(x),clearPending:()=>{},
  recordSafety:x=>safety.push(x),request:(...args)=>{requests.push(args);throw Error('No debe hacer peticiones API');}});
 try{
  await eng.connect(null,{testMode:true});
  assert.equal(eng.state,'connected');assert.equal(eng.testMode,true);
  assert.equal(requests.length,0);
  assert.ok(events.find(([name,value])=>name==='flight'&&value.licenseNumber==='ENTRENAMIENTO'));
  // El motor puede funcionar sin crear un vuelo AVG.
  const vals=[1,0,14.58,-90.52,4600,0,60,0,1,0,-150,0,2,50,2];
  let idx=0;eng.onSimData({data:{readInt32:()=>vals[idx++],readFloat64:()=>vals[idx++]}});
  assert.equal(eng.track,null);assert.equal(requests.length,0);
  assert.equal(pireps.length,0);assert.equal(safety.length,0);
 }finally{eng.disconnect({silent:true});Module._load=real;}
 assert.equal(eng.testMode,false);
});

test('X-Plane: entrenamiento con telemetría real, sin cuenta AVG ni PIREP',async()=>{
 const {FlightEngine}=require('../xplane/lib/engine');
 const requests=[],events=[],pireps=[],safety=[];
 const s={latitude:14.58,longitude:-90.52,altitude:1500,heading:280,groundSpeed:75,
  onGround:false,enginesRunning:true,aglFeet:40,verticalSpeed:-200,gForce:1.0,
  pitchDeg:2,paused:false,replay:false,slew:false,safetyReady:true};
 const client={stop:async()=>{},onTelemetry:null,onStatus:null};
 const eng=new FlightEngine({emit:(n,v)=>events.push([n,v]),
  getPending:()=>null,savePending:x=>pireps.push(x),clearPending:()=>{},
  recordSafety:x=>safety.push(x),
  request:(...args)=>{requests.push(args);throw Error('API no permitida en prueba');},
  probeXPlaneImpl:async()=>({client,telemetry:s})});
 const oldNow=Date.now;let now=10000;Date.now=()=>now;
 try{
  await eng.connect(null,{testMode:true});
  assert.equal(eng.testMode,true);assert.equal(eng.state,'connected');
  assert.equal(requests.length,0);
  now+=900;eng.onXPlaneData({...s,aglFeet:15,verticalSpeed:-120,pitchDeg:3});
  now+=300;eng.onXPlaneData({...s,aglFeet:6,verticalSpeed:-50,pitchDeg:4});
  now+=300;eng.onXPlaneData({...s,onGround:true,aglFeet:0,verticalSpeed:-25,gForce:1.08});
  now+=600;eng.onXPlaneData({...s,onGround:true,aglFeet:0,verticalSpeed:0,gForce:1.12});
  const land=events.find(([n,p])=>n==='notification'&&p.type==='landing');
  assert.ok(land,'Debe emitir resultado al tocar pista');
  assert.equal(land[1].verticalSpeedFpm,-50);
  assert.equal(land[1].verdict,'BUTTER!');
  assert.equal(eng.track,null);
  assert.equal(requests.length,0);assert.equal(pireps.length,0);assert.equal(safety.length,0);
 }finally{eng.disconnect({silent:true});Date.now=oldNow;}
});
