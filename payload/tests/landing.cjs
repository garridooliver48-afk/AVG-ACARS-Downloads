'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {LandingAnalyzer}=require('../msfs/lib/landing-analyzer');
const {LandingAnalyzer:XLandingAnalyzer}=require('../xplane/lib/landing-analyzer');
for(const Analyzer of [LandingAnalyzer,XLandingAnalyzer]){
 test(Analyzer===LandingAnalyzer?'MSFS: aterrizaje suave produce BUTTER':'X-Plane: aterrizaje suave produce BUTTER',()=>{
   const found=[];const x=new Analyzer(e=>found.push(e));
   const s={at:1000,onGround:false,groundSpeed:70,aglFeet:40,pitchDeg:1,gForce:1,verticalSpeed:-350,paused:false,replay:false,slew:false};
   x.record(s);
   x.record({...s,at:2000,aglFeet:18,pitchDeg:2,verticalSpeed:-110});
   x.record({...s,at:2300,aglFeet:8,pitchDeg:2.3,verticalSpeed:-55});
   x.record({...s,at:2600,onGround:true,aglFeet:0,pitchDeg:2.1,verticalSpeed:-15,gForce:1.02});
   assert.equal(found.length,0);
   x.record({...s,at:3200,onGround:true,aglFeet:0,gForce:1.08,verticalSpeed:0});
   assert.equal(found.length,1);
   assert.equal(found[0].verdict,'BUTTER!');
   assert.equal(found[0].verticalSpeedFpm,-55);
   assert.equal(found[0].gForce,1.08);
   assert.equal(found[0].type,'landing');
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
