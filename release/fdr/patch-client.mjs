// Patch only the exact, previously released ACARS files. Fail closed on unknown package.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const [root,kind]=process.argv.slice(2);
if(!root||!['msfs','xplane'].includes(kind))throw Error('Usage: patch-client.mjs <extracted asar> msfs|xplane');
function edit(file,replacements){const full=path.join(root,file);let s=fs.readFileSync(full,'utf8');for(const [a,b] of replacements){if(!s.includes(a))throw Error('Unexpected package: '+file+' / '+a.slice(0,80));s=s.replace(a,b)}fs.writeFileSync(full,s);}
const msfsVars=[
 ['ias','AIRSPEED INDICATED','Knots',0,1100],
 ['aoaDegrees','INCIDENCE ALPHA','Degrees',-180,180],
 ['flapsPercent','TRAILING EDGE FLAPS LEFT PERCENT','Percent',0,100],
 ['gearPercent','GEAR TOTAL PCT EXTENDED','Percent',0,100],
 ['rpm','GENERAL ENG RPM:1','RPM',0,200000],
 ['throttlePercent','GENERAL ENG THROTTLE LEVER POSITION:1','Percent',-100,110],
 ['fuelKg','FUEL TOTAL QUANTITY WEIGHT','Kilograms',0,300000],
 ['windKnots','AMBIENT WIND VELOCITY','Knots',0,300],
 ['windDirection','AMBIENT WIND DIRECTION','Degrees',0,360],
 ['autopilot','AUTOPILOT MASTER','Bool',0,1,true],
 ['stallWarning','STALL WARNING','Bool',0,1,true],
];
if(kind==='msfs'){
 edit('lib/engine.js',[
  ["      handle.on('simObjectData', event => {",
   "      const fdrVars="+JSON.stringify(msfsVars)+";\n      this.fdrReadings={};\n      handle.on('simObjectData', event => {"],
  ["        try { this.onSimData(event); }",
   "        if(event.requestID>=100&&event.requestID<100+fdrVars.length){try{const [key,,,min,max,bool]=fdrVars[event.requestID-100];const v=event.data.readFloat64();if(Number.isFinite(v)&&v>=min&&v<=max)this.fdrReadings[key]={value:bool?v>0.5:v,at:Date.now()};}catch{}return;}\n        if(event.requestID!==1)return;\n        try { this.onSimData(event); }"],
  ["      handle.requestDataOnSimObject(1, 1, 0, SimConnectPeriod.SIM_FRAME);",
   "      handle.requestDataOnSimObject(1, 1, 0, SimConnectPeriod.SIM_FRAME);\n      // Separate data definitions: unsupported add-ons cannot change the original packet layout.\n      for(let i=0;i<fdrVars.length;i++){const [,name,unit]=fdrVars[i];try{handle.addToDataDefinition(100+i,name,unit,SimConnectDataType.FLOAT64);handle.requestDataOnSimObject(100+i,100+i,0,SimConnectPeriod.SECOND);}catch{}}"],
  ["const safetySample={at:now,latitude:lat,longitude:lon,altitude:alt,groundSpeed:speed,onGround,",
   "const safetySample={at:now,latitude:lat,longitude:lon,altitude:alt,groundSpeed:speed,onGround,\n      ...Object.fromEntries(Object.entries(this.fdrReadings||{}).filter(([,v])=>now-v.at<=2500).map(([key,v])=>[key,v.value])),\n      ...(Number.isFinite(heading)?{heading:((heading%360)+360)%360}:{}),enginesRunning:on,\n      ...(Number.isFinite(pitchDegrees)&&Math.abs(pitchDegrees)<=180?{pitchDegrees}:{}),\n      ...(Number.isFinite(aglFeet)&&aglFeet>=-5000&&aglFeet<=100000?{aglFeet}:{}),"],
  ["if(this.simPaused)this.safety.samples=[];","if(this.simPaused)this.safety.breakWindow();"],
  ["if(event.clientEventId===7103)this.safety.samples=[];","if(event.clientEventId===7103)this.safety.breakWindow();"]
 ]);
}else{
 const vars=[
 ['sim/flightmodel/position/y_agl','aglFeet',3.280839895,-5000,100000],
 ['sim/flightmodel/position/theta','pitchDegrees',1,-180,180],
 ['sim/flightmodel/position/indicated_airspeed','ias',1,0,1100],
 ['sim/flightmodel/position/alpha','aoaDegrees',1,-180,180],
 ['sim/flightmodel/controls/flaprat','flapsPercent',100,0,100],
 ['sim/flightmodel2/gear/deploy_ratio[0]','gearPercent',100,0,100],
 ['sim/cockpit2/engine/indicators/engine_speed_rpm[0]','rpm',1,0,200000],
 ['sim/cockpit2/engine/actuators/throttle_ratio[0]','throttlePercent',100,-100,110],
 ['sim/flightmodel/weight/m_fuel_total','fuelKg',1,0,300000],
 ['sim/cockpit2/autopilot/autopilot_mode','autopilot',1,0,2,true],
 ['sim/cockpit2/annunciators/stall_warning','stallWarning',1,0,1,true]
 ];
 edit('lib/xplane-rref.js',[
 ["'sim/flightmodel2/misc/has_crashed'","'sim/flightmodel2/misc/has_crashed',\n  "+vars.map(v=>JSON.stringify(v[0])).join(',\n  ')],
 ["    slew: values.get(15)>0.5,","    slew: values.get(15)>0.5,\n    ...Object.fromEntries("+JSON.stringify(vars)+".flatMap(([,key,factor,min,max,bool],i)=>{const v=values.get(17+i)*factor;return Number.isFinite(v)&&v>=min&&v<=max?[[key,bool?(key==='autopilot'?v===2:v>0.5):v]]:[]})),"]
 ]);
 edit('lib/engine.js',[
 ["{at:now,latitude:lat,longitude:lon,altitude:alt,groundSpeed:speed,onGround,",
  "{at:now,latitude:lat,longitude:lon,altitude:alt,groundSpeed:speed,onGround,\n        ...Object.fromEntries(['aglFeet','pitchDegrees','ias','aoaDegrees','flapsPercent','gearPercent','rpm','throttlePercent','fuelKg','autopilot','stallWarning'].filter(k=>typeof safety[k]==='boolean'||Number.isFinite(safety[k])).map(k=>[k,safety[k]])),\n        ...(Number.isFinite(heading)?{heading:((heading%360)+360)%360}:{}),enginesRunning:on,"]
 ]);
}
edit('main.js',[
 ["    recordSafety:event=>safetyOutbox.enqueue(event),", "    recordSafety:event=>{safetyOutbox.enqueue(event);void simulatorCapture.onIncident(event);},"],
 ["  engine = new FlightEngine({", "  const simulatorCapture=require('./lib/simulator-capture').createSimulatorCapture({simulator:"+JSON.stringify(kind)+",enqueue:event=>safetyOutbox.enqueue(event),onStatus:text=>send('message',{level:'info',text})});\n  void simulatorCapture.consent();\n  engine = new FlightEngine({"]
]);
fs.copyFileSync(path.join(base,'simulator-capture.js'),path.join(root,'lib','simulator-capture.js'));
for(const f of ['safety-recorder.js','safety-outbox.js']){if(!fs.existsSync(path.join(root,'lib',f)))throw Error('Missing '+f);fs.copyFileSync(path.join(base,f),path.join(root,'lib',f));}
console.log('AVG FDR patch applied: '+kind);
