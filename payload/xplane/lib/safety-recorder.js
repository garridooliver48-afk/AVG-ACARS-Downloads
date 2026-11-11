'use strict';
const { randomUUID } = require('node:crypto');
const { classifySafetyWindow } = require('./safety-rules');
class SafetyRecorder {
  constructor(enqueue, simulator) { this.enqueue=enqueue;this.simulator=simulator;this.reset(); }
  reset() { this.samples=[];this.flightId=null;this.reported=false;this.resumeAt=0; }
  record(context, sample) {
    if (!context?.flightId) { this.reset();return; }
    if (this.flightId!==context.flightId) { this.reset();this.flightId=context.flightId; }
    if (this.reported) return;
    if (!sample || !sample.safetyReady || sample.paused || sample.replay || sample.slew) {
      this.samples=[];this.resumeAt=Date.now()+1500;return;
    }
    const {safetyReady, ...clean}=sample;
    if (![clean.at,clean.latitude,clean.longitude,clean.altitude,clean.groundSpeed].every(Number.isFinite))return;
    const prior=this.samples[this.samples.length-1];
    if(prior && (clean.at-prior.at>2000 || clean.at<=prior.at))this.samples=[];
    if(clean.at<this.resumeAt)return;
    if(prior && clean.at-prior.at<150 && !clean.crashDetected && !(clean.onGround&&clean.gForce>=2.5))return;
    // At most 65 bounded, chronological samples; preserve the trigger even between normal ticks.
    if(this.samples.at(-1)?.at===clean.at)return;
    this.samples.push(clean);
    this.samples=this.samples.filter(s=>clean.at-s.at<=8000).slice(-65);
    const finding=classifySafetyWindow(this.samples);
    if(!finding)return;
    // Synchronous durable save must succeed before marking this flight as reported.
    this.enqueue({...context,eventId:randomUUID(),simulator:this.simulator,samples:this.samples.map(s=>({...s}))});
    this.reported=true;
  }
}
module.exports={SafetyRecorder};
