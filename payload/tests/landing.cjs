'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {LandingAnalyzer}=require('../msfs/lib/landing-analyzer');
const {LandingAnalyzer:XLandingAnalyzer}=require('../xplane/lib/landing-analyzer');
for(const Analyzer of [LandingAnalyzer,XLandingAnalyzer]){
 test(Analyzer===LandingAnalyzer?'MSFS: aterrizaje suave produce aterrizaje de seda':'X-Plane: aterrizaje suave produce BUTTER',()=>{
   const found=[];const x=new Analyzer(e=>found.push(e));
   const s={at:1000,onGround:false,groundSpeed:70,aglFeet:40,pitchDeg:1,gForce:1,verticalSpeed:-350,paused:false,replay:false,slew:false};
   x.record(s);
   x.record({...s,at:2000,aglFeet:18,pitchDeg:2,verticalSpeed:-110});
   x.record({...s,at:2300,aglFeet:8,pitchDeg:2.3,verticalSpeed:-55});
   x.record({...s,at:2600,onGround:true,aglFeet:0,pitchDeg:2.1,verticalSpeed:-15,gForce:1.02});
   assert.equal(found.length,0);
   x.record({...s,at:3200,onGround:true,aglFeet:0,gForce:1.08,verticalSpeed:0});
   assert.equal(found.length,1);
   assert.equal(found[0].verdict,'¡DE SEDA!');
   assert.equal(found[0].verticalSpeedFpm,-55);
   assert.equal(found[0].gForce,1.08);
   assert.equal(found[0].type,'landing');
   assert.ok(found[0].floatSeconds > 0, 'Debe medir la flotación cuando se detecta recogida.');
   assert.match(found[0].detail,/español|toma|recogida|aterrizaje|Contacto|¡Excelente/i);
   x.record({...s,at:3500,onGround:false,aglFeet:2});
   x.record({...s,at:3900,onGround:true,aglFeet:0});
   assert.equal(found.length,1);
 });
 test('AVG: pausa/replay/slew/teletransporte nunca presentan aterrizaje',()=>{
   for(const stop of [{paused:true},{replay:true},{slew:true},{crashDetected:true},{at:8000}]){
     const found=[];const x=new Analyzer(e=>found.push(e));
     const s={at:1000,onGround:false,groundSpeed:60,aglFeet:60,pitchDeg:1,gForce:1,verticalSpeed:-180};
     x.record(s);x.record({...s,at:2000,aglFeet:20});
     x.record({...s,at:2500,onGround:true,aglFeet:0,...stop});
     x.record({...s,at:3100,onGround:true,aglFeet:0});
     assert.equal(found.length,0);
   }
 });
}

for (const Analyzer of [LandingAnalyzer,XLandingAnalyzer]){
 test('AVG: estima flotación desde 20 ft aun sin detectar recogida',()=>{
   const output=[];const a=new Analyzer(v=>output.push(v));
   const s={at:1000,onGround:false,groundSpeed:75,aglFeet:60,
     verticalSpeed:-341.8,pitchDeg:2,pitchRateDegSec:0,gForce:1,paused:false,replay:false,slew:false};
   a.record(s);
   a.record({...s,at:2000,aglFeet:28});
   a.record({...s,at:2400,aglFeet:16});
   a.record({...s,at:2800,aglFeet:0,onGround:true,gForce:1.83});
   a.record({...s,at:3400,aglFeet:0,onGround:true,gForce:1.85});
   assert.equal(output.length,1);
   assert.equal(output[0].verdict,'ATERRIZAJE NORMAL');
   assert.equal(output[0].verticalSpeedFpm,-341.8);
   assert.equal(output[0].gForce,1.85);
   assert.equal(output[0].floatEstimated,true);
   assert.ok(output[0].floatSeconds>=0.5&&output[0].floatSeconds<=1.0);
   assert.equal(output[0].type,'landing');
 });
 test('AVG: no inventa flotación cuando falta altura sobre el terreno',()=>{
   const output=[];const a=new Analyzer(v=>output.push(v));
   const s={at:1000,onGround:false,groundSpeed:70,aglFeet:null,
     verticalSpeed:-340,pitchDeg:1,pitchRateDegSec:0,gForce:1,paused:false,replay:false,slew:false};
   a.record(s);
   a.record({...s,at:2000});
   a.record({...s,at:2500,onGround:true,gForce:1.5});
   a.record({...s,at:3100,onGround:true,gForce:1.6});
   assert.equal(output.length,1);
   assert.equal(output[0].floatSeconds,null);
 });
 test('AVG: aterrizaje fuerte se clasifica sin generar expediente',()=>{
   const output=[];const a=new Analyzer(v=>output.push(v));
   const s={at:1000,onGround:false,groundSpeed:70,aglFeet:45,
     verticalSpeed:-590,pitchDeg:1,pitchRateDegSec:0,gForce:1,paused:false,replay:false,slew:false};
   a.record(s);a.record({...s,at:2000,aglFeet:14});
   a.record({...s,at:2300,onGround:true,aglFeet:0,gForce:2.5});
   a.record({...s,at:2900,onGround:true,aglFeet:0,gForce:2.9});
   assert.equal(output.length,1);
   assert.equal(output[0].verdict,'ATERRIZAJE FUERTE');
 });
}
