'use strict';
const { randomUUID }=require('node:crypto');
const { classifySafetyWindow }=require('./safety-rules');
// 5 Hz history, original trigger detector preserved unchanged.
class SafetyRecorder{
 constructor(enqueue,simulator){this.enqueue=enqueue;this.simulator=simulator;this.samples=[];this.history=[];this.flightId=null;this.reported=false;this.resumeAt=0;this.pending=null;}
 finish(){const p=this.pending;if(!p)return;this.pending=null;
   if(p.history.length<=p.initialCount)return;
   this.enqueue({...p.event,eventId:randomUUID(),relatedEventId:p.event.eventId,fdrSamples:p.history.slice(0,800)});
 }
 breakWindow(){this.finish();this.samples=[];this.history=[];this.resumeAt=Date.now()+1500;}
 reset(){this.finish();this.samples=[];this.history=[];this.flightId=null;this.reported=false;this.resumeAt=0;}
 record(context,sample){
  if(!context?.flightId){this.reset();return;}
  if(this.flightId!==context.flightId){this.reset();this.flightId=context.flightId;}
  if(!sample||!sample.safetyReady||sample.paused||sample.replay||sample.slew){
   this.finish();this.samples=[];this.history=[];this.resumeAt=Date.now()+1500;return;
  }
  const {safetyReady,...clean}=sample;
  if(![clean.at,clean.latitude,clean.longitude,clean.altitude,clean.groundSpeed].every(Number.isFinite))return;
  if(clean.at<this.resumeAt)return;
  const last=this.history.at(-1);
  if(last&&(clean.at-last.at>2500||clean.at<=last.at)){
    if(clean.at<=last.at&&!clean.crashDetected)return;
    this.finish();this.history=[];this.samples=[];
  }
  const histLast=this.history.at(-1);
  if(!histLast||clean.at-histLast.at>=200||clean.crashDetected){
    if(histLast?.at!==clean.at)this.history.push(clean);
    this.history=this.history.filter(s=>clean.at-s.at<=120000).slice(-650);
  }
  if(this.reported){
    const p=this.pending;
    if(p){
      if(clean.at-p.trigger>30000){this.finish();return;}
      const prev=p.history.at(-1);
      if(!prev||clean.at-prev.at>=200)p.history.push(clean);
      if(clean.at-p.trigger>=29800){this.finish();}
    }
    return;
  }
  const prior=this.samples.at(-1);
  if(prior&&(clean.at-prior.at>2000||clean.at<=prior.at))this.samples=[];
  if(prior&&clean.at-prior.at<150&&!clean.crashDetected&&!(clean.onGround&&clean.gForce>=2.5))return;
  if(this.samples.at(-1)?.at===clean.at)return;
  this.samples.push(clean);
  this.samples=this.samples.filter(s=>clean.at-s.at<=8000).slice(-65);
  const finding=classifySafetyWindow(this.samples);if(!finding)return;
  if(this.history.at(-1)?.at!==clean.at)this.history.push(clean);
  this.history=this.history.filter(s=>clean.at-s.at<=120000).slice(-650);
  const history=this.history.map(s=>({...s}));
  const event={...context,eventId:randomUUID(),simulator:this.simulator,samples:this.samples.map(s=>({...s})),...(history.length>=2?{fdrSamples:history}:{})};
  this.enqueue(event);this.reported=true;
  this.pending={event,history:history.map(s=>({...s})),initialCount:history.length,trigger:clean.at};
 }
}
module.exports={SafetyRecorder};
