'use strict';
// AVG Landing Feedback - evaluación local, independiente del PIREP y de accidentes.
const valid = Number.isFinite;
const between = (x,lo,hi) => valid(x) && x>=lo && x<=hi;
const fmt = (x,n=1) => valid(x) ? Number(x.toFixed(n)) : null;

class LandingAnalyzer {
  constructor(notify=()=>{}) { this.notify=notify; this.reset(); }
  reset() {
    this.prev=null; this.airStart=null; this.airborne=false;
    this.flareAt=null; this.flareAgl=null; this.floatAt=null;
    this.pending=null; this.lastTouch=-Infinity;
  }
  emitLanding(p) {
    const vs=p.vs;
    const g=p.g;
    const impact=valid(vs)?Math.abs(vs):null;
    const softness=impact!==null && (!valid(g)||g<=1.3) && impact<=120 ? 'BUTTER!'
      : impact!==null && (!valid(g)||g<=1.6) && impact<=250 ? 'SMOOTH!'
      : impact!==null && (impact>=500 || (valid(g)&&g>=2.5)) ? 'HARD LANDING'
      : 'LANDING';
    const detail=(p.flareAgl!==null && p.flareAgl<12) ? 'Good, but late flare'
      : (valid(p.floatSeconds)&&p.floatSeconds>8) ? 'Good, but long float'
      : softness==='BUTTER!' ? 'Excellent touchdown'
      : softness==='SMOOTH!' ? 'Good landing' : 'Touchdown recorded';
    this.notify({
      type:'landing', title:'ATERRIZAJE AVG',
      verticalSpeedFpm:fmt(vs,1), gForce:fmt(g,2),
      noseRateDegSec:fmt(p.noseRate,2),
      floatSeconds:fmt(p.floatSeconds,1),
      detail, verdict:softness
    });
  }
  record(s) {
    if(!s || !valid(s.at) || typeof s.onGround!=='boolean')return;
    if(s.paused || s.replay || s.slew || s.crashDetected) {
      this.reset();return;
    }
    const prev=this.prev;
    if(prev && (s.at<=prev.at || s.at-prev.at>1500)) {
      // Desconexión, pausa, salto temporal: nunca generar un toque ficticio.
      this.reset();
      this.prev={...s}; return;
    }
    const dt=prev ? (s.at-prev.at)/1000 : null;
    const derivedRate=dt && between(s.pitchDeg,-90,90) && between(prev.pitchDeg,-90,90)
      ? (s.pitchDeg-prev.pitchDeg)/dt : null;
    const noseRate=between(s.pitchRateDegSec,-50,50) ? s.pitchRateDegSec
      : between(derivedRate,-50,50)?derivedRate:null;
    const agl=s.aglFeet;
    const gs=s.groundSpeed;
    // Completar el resultado unos instantes después de contacto para captar el pico de G.
    if(this.pending) {
      if(s.onGround && between(s.gForce,-5,20))
        this.pending.g=valid(this.pending.g)?Math.max(this.pending.g,s.gForce):s.gForce;
      if(s.at-this.pending.at>=500) {
        const result=this.pending;this.pending=null;
        this.emitLanding(result);
      }
    }
    if(!s.onGround) {
      if(between(agl,15,15000) && gs>=15 ||
         !valid(agl) && gs>=40) {
        if(this.airStart===null)this.airStart=s.at;
      }
      if(this.airStart!==null && s.at-this.airStart>=800)this.airborne=true;
      if(between(agl,0,50)) {
        if(this.flareAt===null && valid(noseRate) && noseRate>0.35
           && valid(s.verticalSpeed) && s.verticalSpeed<0) {
          this.flareAt=s.at;this.flareAgl=agl;
        }
        if(this.floatAt===null && agl<=20 && between(s.verticalSpeed,-200,40)) {
          this.floatAt=s.at;
        }
      }
      if(valid(agl) && agl>100) {
        this.flareAt=null;this.flareAgl=null;this.floatAt=null;
      }
    }
    if(prev && !prev.onGround && s.onGround && this.airborne &&
       valid(gs) && gs>=15 && s.at-this.lastTouch>=15000) {
      // Tomar velocidad vertical inmediatamente antes de contacto.
      const vs=valid(prev.verticalSpeed) ? prev.verticalSpeed :
        valid(s.verticalSpeed) ? s.verticalSpeed : null;
      if(between(vs,-3000,200)) {
        const estimatedFloat=this.floatAt!==null ? (s.at-this.floatAt)/1000 : null;
        this.pending={
          at:s.at,vs,
          g:between(s.gForce,-5,20)?s.gForce:null,
          noseRate,flareAgl:this.flareAgl,
          floatSeconds:between(estimatedFloat,0,45)?estimatedFloat:null
        };
        this.lastTouch=s.at;
      }
    }
    if(s.onGround) {
      this.airStart=null;this.airborne=false;
      this.flareAt=null;this.flareAgl=null;this.floatAt=null;
    }
    this.prev={...s};
  }
}
module.exports={LandingAnalyzer};
