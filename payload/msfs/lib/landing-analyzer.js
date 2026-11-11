'use strict';
// AVG ACARS · evaluador LOCAL de aterrizajes. Nunca modifica puntos, PIREP ni accidentes.
const finite = Number.isFinite;
const range = (x, a, b) => finite(x) && x >= a && x <= b;
const rounded = (x, digits = 1) => finite(x) ? Number(x.toFixed(digits)) : null;
const LOW_HEIGHT_FT = 20;

class LandingAnalyzer {
  constructor(notify = () => {}) {
    this.notify = notify;
    this.reset();
  }
  reset() {
    this.previous = null;
    this.airborneStart = null;
    this.airborne = false;
    this.flareStart = null;
    this.flareHeight = null;
    this.below20At = null;
    this.pending = null;
    this.lastTouch = -Infinity;
  }
  present(p) {
    const rate = finite(p.verticalSpeedFpm) ? Math.abs(p.verticalSpeedFpm) : null;
    const g = p.gForce;
    const heavy = (rate !== null && rate >= 500) || (finite(g) && g >= 2.5);
    const silk = rate !== null && rate <= 120 && finite(g) && g <= 1.3;
    const soft = rate !== null && rate <= 250 && finite(g) && g <= 1.6;
    const verdict = heavy ? 'ATERRIZAJE FUERTE'
      : silk ? '¡DE SEDA!'
      : soft ? '¡MUY SUAVE!'
      : 'ATERRIZAJE NORMAL';

    const detail = heavy ? 'Contacto fuerte: revisa la toma'
      : finite(p.flareHeight) && p.flareHeight < 12 ? 'Buena toma, pero recogida tardía'
      : finite(p.floatSeconds) && p.floatSeconds > 8 ? 'Flotación prolongada antes del contacto'
      : silk ? '¡Excelente toma!'
      : soft ? 'Buen aterrizaje'
      : 'Contacto registrado';
    this.notify({
      type: 'landing',
      title: 'EVALUACIÓN DE ATERRIZAJE',
      verticalSpeedFpm: rounded(p.verticalSpeedFpm, 2),
      gForce: rounded(g, 2),
      noseRateDegSec: rounded(p.noseRateDegSec, 2),
      floatSeconds: rounded(p.floatSeconds, 1),
      floatEstimated: p.floatEstimated === true,
      verdict,
      detail
    });
  }
  record(sample) {
    if (!sample || !finite(sample.at) || typeof sample.onGround !== 'boolean') return;
    if (sample.paused || sample.replay || sample.slew || sample.crashDetected) {
      this.reset(); return;
    }
    const prev = this.previous;
    if (prev && (sample.at <= prev.at || sample.at - prev.at > 1500)) {
      // No evaluar un rebote producido por pausa/desconexión/teletransporte.
      this.reset(); this.previous = { ...sample }; return;
    }
    const dt = prev ? (sample.at - prev.at) / 1000 : null;
    const pitchRate = range(sample.pitchRateDegSec, -50, 50)
      ? sample.pitchRateDegSec
      : (dt && prev && range(sample.pitchDeg, -90, 90) && range(prev.pitchDeg, -90, 90))
      ? (sample.pitchDeg - prev.pitchDeg) / dt : null;
    const rate = sample.verticalSpeed;
    const agl = sample.aglFeet;
    const gs = sample.groundSpeed;

    // Esperar 500 ms tras tocar para recoger el máximo de fuerza G.
    if (this.pending) {
      if (sample.onGround && range(sample.gForce, -5, 20)) {
        this.pending.gForce = finite(this.pending.gForce)
          ? Math.max(this.pending.gForce, sample.gForce) : sample.gForce;
      }
      if (sample.at - this.pending.at >= 500) {
        const result = this.pending;
        this.pending = null;
        this.present(result);
      }
    }
    if (!sample.onGround) {
      if ((range(agl, 15, 15000) && finite(gs) && gs >= 15)
        || (!finite(agl) && finite(gs) && gs >= 40)) {
        if (this.airborneStart === null) this.airborneStart = sample.at;
      }
      if (this.airborneStart !== null && sample.at - this.airborneStart >= 800)
        this.airborne = true;
      if (range(agl, 0, 60) && this.airborne && finite(gs) && gs >= 15) {
        // Iniciar la recogida al comenzar a levantar el morro o reducir descenso.
        const pitchUp = range(pitchRate, 0.20, 30);
        const reducedDescent = prev && finite(prev.verticalSpeed) && finite(rate)
          && prev.verticalSpeed < -120 && rate - prev.verticalSpeed >= 50;
        if (this.flareStart === null && agl <= 50 && rate < 0 && (pitchUp || reducedDescent)) {
          this.flareStart = sample.at;
          this.flareHeight = agl;
        }
        // Respaldo por altura si el inicio del redondeo no puede medirse:
        // "flotación estimada" = tiempo desde cruzar ~20 ft AGL hasta tocar.
        if (this.below20At === null && agl <= LOW_HEIGHT_FT) {
          if (prev && range(prev.aglFeet, LOW_HEIGHT_FT + 0.001, 80)
              && range(agl, 0, LOW_HEIGHT_FT) && sample.at > prev.at) {
            const portion = (prev.aglFeet - LOW_HEIGHT_FT) / (prev.aglFeet - agl);
            this.below20At = prev.at + portion * (sample.at - prev.at);
          } else {
            this.below20At = sample.at;
          }
        }
      }
      if (finite(agl) && agl > 100) {
        this.flareStart = null;
        this.flareHeight = null;
        this.below20At = null;
      }
    }
    const touchdown = prev && !prev.onGround && sample.onGround &&
      this.airborne && finite(gs) && gs >= 15 && sample.at - this.lastTouch >= 15000;
    if (touchdown) {
      const approachRate = finite(prev.verticalSpeed) ? prev.verticalSpeed :
        finite(rate) ? rate : null;
      if (range(approachRate, -3000, 200)) {
        const start = this.flareStart !== null ? this.flareStart : this.below20At;
        const elapsed = start !== null ? (sample.at - start) / 1000 : null;
        // Sin AGL válido, no fabricar duración de flotación.
        this.pending = {
          at: sample.at,
          verticalSpeedFpm: approachRate,
          gForce: range(sample.gForce, -5, 20) ? sample.gForce : null,
          noseRateDegSec: pitchRate,
          flareHeight: this.flareHeight,
          floatSeconds: range(elapsed, 0, 30) ? elapsed : null,
          floatEstimated: this.flareStart === null
        };
        this.lastTouch = sample.at;
      }
    }
    if (sample.onGround) {
      this.airborneStart = null;
      this.airborne = false;
      this.flareStart = null;
      this.flareHeight = null;
      this.below20At = null;
    }
    this.previous = { ...sample };
  }
}
module.exports = { LandingAnalyzer };
