'use strict';
const { randomUUID } = require('node:crypto');
const { SafetyRecorder } = require('./safety-recorder');
const { LandingAnalyzer } = require('./landing-analyzer');
const { haversineKm, requestAvg } = require('./network');

const PING_EVERY_MS = 5_000;
const SHOW_EVERY_MS = 1_000;
const SNAPSHOT_EVERY_MS = 15_000;
const AUTO_RETRY_MS = 12_000;
const SHUTDOWN_STABLE_MS = 12_000;
const ARRIVAL_RADIUS_KM = 5;
const MAX_STOP_SPEED_KT = 5;
const MIN_DISTANCE_KM = 1;


class FlightEngine {
  constructor({ emit, recordSafety = () => {}, getPending, savePending, clearPending, request = requestAvg, autoPirep = false }) {
    this.emit = emit;
    this.safety = new SafetyRecorder(recordSafety, 'msfs');
    this.landing = new LandingAnalyzer(data => this.emit('notification', data));
    this.request = request;
    this.autoPirep = autoPirep;
    this.stopCandidateAt = null;
    this.autoSending = false;
    this.getPending = getPending;
    this.savePending = savePending;
    this.clearPending = clearPending;
    this.state = 'idle';
    this.handle = null;
    this.sessionId = 0;
    this.assignment = null;
    this.settings = null;
    this.track = null;
    this.testMode = false; // Entrenamiento local: nunca crea vuelo, PIREP o llamada al servidor.
    this.pingBusy = false;
    this.reportBusy = false;
    this.lastUiAt = 0;
    this.lastPingAt = 0;
    this.lastSnapshotAt = 0;
    this.lastFailureAt = 0;
    this.simName = '';
    this.autoEnabled = false;
    this.autoTimer = null;
    this.autoSettings = null;
  }

  status(label, level = 'info') {
    this.emit('status', { state: this.state, label, level });
  }

  // Intenta conectar cuando SimConnect esté disponible, sin intervención del piloto.
  // Solo funciona si previamente se guardó una credencial AVG válida.
  startAuto(settings) {
    if (!settings?.token || !settings?.apiBaseUrl) {
      throw new Error('Configura primero tu cuenta AVG.');
    }
    this.autoSettings = { apiBaseUrl: settings.apiBaseUrl, token: settings.token };
    this.autoEnabled = true;
    if (this.state === 'idle') {
      this.status(this.getPending()
        ? (this.autoPirep ? 'PIREP pendiente: intentando enviarlo automáticamente.' : 'Tienes un PIREP pendiente. Revísalo antes de iniciar otro vuelo.')
        : 'Detección automática activa. Esperando vuelo y simulador...');
      this.scheduleAuto(0);
    }
    return { automatic: true };
  }

  scheduleAuto(delayMs = AUTO_RETRY_MS) {
    if (!this.autoEnabled) return;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      void this.autoAttempt();
    }, delayMs);
  }

  async autoAttempt() {
    if (!this.autoEnabled || this.state !== 'idle') return;
    if (this.getPending()) {
      if (!this.autoPirep) {
        this.status('PIREP pendiente: revísalo antes de iniciar otro vuelo.');
        this.scheduleAuto();
        return;
      }
      try {
        await this.submitPending(this.autoSettings);
      } catch (err) {
        this.status('PIREP guardado localmente. Reintentando envío...', 'error');
        this.scheduleAuto();
      }
      return;
    }
    try {
      await this.connect(this.autoSettings, { automatic: true });
    } catch (err) {
      if (!this.autoEnabled) return;
      if (/\bHTTP (401|403)\b/.test(String(err?.message))) {
        this.stopAuto({ disconnect: false });
        this.status('Tu sesión venció o la cuenta no está autorizada.', 'error');
        this.emit('auth', { required: true });
        return;
      }
      if (err?.code === 'AVG_FLIGHT_MISMATCH') {
        this.stopAuto({ disconnect: false });
        this.status('El vuelo asignado cambió durante una sesión. Revisa el ACARS.', 'error');
        this.failure('No se reinició el vuelo anterior para evitar perder su registro.');
        return;
      }
      this.status('Esperando a MSFS 2020 y un vuelo asignado...');
      this.scheduleAuto();
    }
  }

  stopAuto({ disconnect = true } = {}) {
    this.autoEnabled = false;
    this.autoSettings = null;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    if (disconnect && this.state !== 'idle') this.disconnect();
  }

  async connect(settings, { automatic = false, testMode = false } = {}) {
    if (this.state !== 'idle') throw new Error('El ACARS ya se está conectando o está conectado.');
    if (!testMode && this.getPending()) throw new Error('Tienes un PIREP pendiente. Revísalo antes de iniciar otro vuelo.');
    this.state = 'connecting';
    this.testMode = testMode === true;
    this.settings = testMode ? null : settings;
    const sid = ++this.sessionId;
    this.status(testMode ? 'ENTRENAMIENTO: buscando simulador sin vuelo AVG...' : 'Consultando vuelo asignado en AVG...');
    try {
      if (!testMode) {
      const response = await this.request(settings.apiBaseUrl, settings.token, '/api/flights/live?mine=1');
      const flight = response.data;
      if (!flight.flightId || !flight.licenseNumber || !flight.aircraft || !flight.origin || !flight.destination) {
        throw new Error('El servidor no devolvió un vuelo asignado completo.');
      }
      if (sid !== this.sessionId) return;
      if (this.track?.flightId && this.track.flightId !== flight.flightId) {
        const error = new Error('El vuelo asignado cambió durante una sesión activa.');
        error.code = 'AVG_FLIGHT_MISMATCH';
        throw error;
      }
      this.assignment = {
        tripLeg: flight.plan?.tripLeg === 'return' ? 'return' : 'outbound',
        isRoundTrip: flight.plan?.isRoundTrip === true,
        destinationCoords: this.destinationCoords(flight.plan),
        flightId: flight.flightId,
        licenseNumber: flight.licenseNumber,
        aircraft: flight.aircraft,
        registration: flight.registration || 'SIN MATRÍCULA',
        origin: flight.origin,
        destination: flight.destination,
        targetFuelLiters: flight.targetFuelLiters ?? null,
        targetWeightKg: flight.targetWeightKg ?? null,
      };
      this.emit('flight', this.assignment);
      } else {
        this.assignment = null;
        this.track = null;
        this.emit('flight', {
          licenseNumber:'ENTRENAMIENTO',origin:'LIBRE',destination:'LIBRE',
          aircraft:'PRUEBA LOCAL',registration:'SIN PIREP',
          targetFuelLiters:null,targetWeightKg:null
        });
      }
      this.status(testMode ? 'ENTRENAMIENTO: conectando con MSFS...' : 'Buscando Microsoft Flight Simulator...');
      const { open, Protocol, SimConnectPeriod, SimConnectDataType } = require('node-simconnect');
      const { recvOpen, handle } = await open('AVG ACARS', Protocol.FSX_SP2);
      if (sid !== this.sessionId) { try { handle.close?.(); } catch {} return; }
      this.handle = handle;
      this.simName = String(recvOpen.applicationName || 'MSFS 2020');
      handle.on('simObjectData', event => {
        if (sid !== this.sessionId || this.state !== 'connected') return;
        try { this.onSimData(event); }
        catch (err) { this.failure(`Error de telemetría: ${err.message}`); }
      });
      handle.on('quit', () => this.onSimDisconnected(sid));
      handle.on('close', () => this.onSimDisconnected(sid));
      handle.on('exception', err => this.failure(`SimConnect: ${err?.message || 'excepción'}`));
      handle.addToDataDefinition(1, 'ENG COMBUSTION:1', 'Bool', SimConnectDataType.INT32);
      handle.addToDataDefinition(1, 'ENG COMBUSTION:2', 'Bool', SimConnectDataType.INT32);
      handle.addToDataDefinition(1, 'PLANE LATITUDE', 'Degrees', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'PLANE LONGITUDE', 'Degrees', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'PLANE ALTITUDE', 'Feet', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'PLANE HEADING DEGREES TRUE', 'Degrees', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'GROUND VELOCITY', 'Knots', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'SIM ON GROUND', 'Bool', SimConnectDataType.INT32);
      handle.addToDataDefinition(1, 'G FORCE', 'GForce', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'PLANE BANK DEGREES', 'Degrees', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'VERTICAL SPEED', 'Feet per minute', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'IS SLEW ACTIVE', 'Bool', SimConnectDataType.INT32);
      handle.addToDataDefinition(1, 'CAMERA STATE', 'Enum', SimConnectDataType.INT32);
      handle.addToDataDefinition(1, 'PLANE ALT ABOVE GROUND', 'Feet', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(1, 'PLANE PITCH DEGREES', 'Degrees', SimConnectDataType.FLOAT64);
      this.simPaused = null;
      this.lastSafetySample = null;
      handle.on('event', event => {
        if(sid!==this.sessionId||this.state!=='connected')return;
        if(event.clientEventId===7101){this.simPaused=event.data!==0;if(this.simPaused)this.safety.samples=[];}
        if(event.clientEventId===7102){
          const sample=this.lastSafetySample;
          if(this.track && sample && Date.now()-sample.at<=2000){
            try{this.safety.record({flightId:this.assignment.flightId,licenseNumber:this.assignment.licenseNumber,
              apiBaseUrl:this.settings.apiBaseUrl},{...sample,at:Math.max(Date.now(),sample.at+1),crashDetected:true});}
            catch(error){this.failure('No se pudo guardar la evidencia: '+error.message);}
          }
        }
        if(event.clientEventId===7103)this.safety.samples=[];
      });
      handle.subscribeToSystemEvent(7101,'Pause_EX1');
      handle.subscribeToSystemEvent(7102,'Crashed');
      handle.subscribeToSystemEvent(7103,'PositionChanged');
      this.state = 'connected';
      this.status(testMode ? `ENTRENAMIENTO LOCAL · ${this.simName} · SIN PIREP` : `Conectado a ${this.simName}`, 'ok');
      handle.requestDataOnSimObject(1, 1, 0, SimConnectPeriod.SIM_FRAME);
      return this.assignment;
    } catch (err) {
      if (sid === this.sessionId) this.disconnect({ silent: true, preserveTrack: Boolean(this.track) });
      if (!automatic) this.status(`No se pudo conectar: ${err.message}`, 'error');
      throw err;
    }
  }

  destinationCoords(plan) {
    const d = plan?.destination;
    const lat = Number(d?.lat);
    const lon = Number(d?.lon);
    return d && d.lat != null && d.lon != null && Number.isFinite(lat) && Number.isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  }

  failure(message) {
    const now = Date.now();
    if (now - this.lastFailureAt > 12_000) {
      this.lastFailureAt = now;
      this.emit('message', { level: 'error', text: message });
    }
  }

  onSimDisconnected(sid) {
    if (sid !== this.sessionId || this.state === 'idle') return;
    const training = this.testMode;
    const interrupted = Boolean(this.track);
    this.disconnect({ silent: true, preserveTrack: interrupted });
    if (training) {
      this.status('Entrenamiento detenido: MSFS desconectado. No se envió ningún dato a AVG.');
      this.emit('training', { enabled: false });
      return;
    }
    this.status(interrupted
      ? 'MSFS desconectado. Reintentando; no se enviará PIREP automáticamente.'
      : 'MSFS desconectado. Esperando reconexión automática...');
    this.scheduleAuto(8_000);
  }

  onSimData(recv) {
    const combustion1 = recv.data.readInt32();
    const combustion2 = recv.data.readInt32();
    const lat = recv.data.readFloat64();
    const lon = recv.data.readFloat64();
    const alt = Math.round(recv.data.readFloat64());
    const heading = Math.round(recv.data.readFloat64());
    const speed = Math.round(recv.data.readFloat64());
    const onGround = recv.data.readInt32() > 0;
    const gForce=recv.data.readFloat64();
    const bank=recv.data.readFloat64();
    const verticalSpeed=recv.data.readFloat64();
    const slew=recv.data.readInt32()>0;
    const cameraState=recv.data.readInt32();
    const aglFeet=recv.data.readFloat64();
    const pitchDegrees=recv.data.readFloat64();
    const on = combustion1 > 0 || combustion2 > 0;
    const now = Date.now();
    const validPosition = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if (!this.testMode && on && !this.track && !this.getPending()) {
      this.track = { flightId: this.assignment.flightId, reportId: randomUUID(), startedAt: now,
        lastPosition: null, distanceKm: 0, hadEngineOn: true, hadAirborne: false };
      this.stopCandidateAt = null;
      const leg = this.assignment.tripLeg === 'return' ? 'regreso' : 'ida';
      this.emit('message', { level: 'ok', text: `Motor encendido. Vuelo de ${leg} iniciado.` });
      this.emit('notification', { type: 'start', title: 'MOTOR ENCENDIDO', detail: `Vuelo de ${leg} iniciado` });
    }
    const safetySample={at:now,latitude:lat,longitude:lon,altitude:alt,groundSpeed:speed,onGround,
      gForce,bank,verticalSpeed,slew,paused:this.simPaused!==false,replay:cameraState===17,
      safetyReady:this.simPaused!==null&&[gForce,bank,verticalSpeed].every(Number.isFinite)};
    this.lastSafetySample=safetySample;
    // Evaluación informativa del toque: no modifica PIREP, puntos ni accidentes.
    this.landing.record({at:now,onGround,groundSpeed:speed,verticalSpeed,gForce,
      aglFeet,pitchDeg:Number.isFinite(pitchDegrees)?-pitchDegrees:null,
      paused:this.simPaused===true,replay:cameraState===17,slew});
    if(this.track&&validPosition)this.safety.record({flightId:this.assignment.flightId,
      licenseNumber:this.assignment.licenseNumber,apiBaseUrl:this.settings.apiBaseUrl},safetySample);
    if (this.track && on && !onGround && Number.isFinite(speed) && speed >= 35) {
      this.track.hadAirborne = true;
    }
    if (this.track && on && validPosition) {
      const pos = { lat, lon, time: now };
      const prior = this.track.lastPosition;
      if (prior) {
        const delta = haversineKm(prior, pos);
        const hours = (now - prior.time) / 3_600_000;
        if (Number.isFinite(delta) && delta >= 0 && hours > 0 && delta / hours <= 900) {
          this.track.distanceKm += delta;
        }
      }
      this.track.lastPosition = pos;
    }
    if (this.track && on && now - this.lastSnapshotAt >= SNAPSHOT_EVERY_MS) {
      this.lastSnapshotAt = now;
      // Punto de recuperación local en caso de cierre inesperado, no un PIREP final.
      this.emit('snapshot', { startedAt: this.track.startedAt, distanceKm: this.track.distanceKm });
    }
    if (now - this.lastUiAt >= SHOW_EVERY_MS) {
      this.lastUiAt = now;
      this.emit('telemetry', {
        altitude: Number.isFinite(alt) ? alt : null,
        groundSpeed: Number.isFinite(speed) ? speed : null,
        heading: Number.isFinite(heading) ? heading : null,
        latitude: validPosition ? lat : null,
        longitude: validPosition ? lon : null,
        enginesRunning: on,
        distanceKm: this.track ? Number(this.track.distanceKm.toFixed(3)) : 0,
        durationSeconds: this.track ? Math.max(0, Math.floor((now - this.track.startedAt) / 1000)) : 0,
      });
    }
    if (this.track && on && validPosition && !this.pingBusy && now - this.lastPingAt >= PING_EVERY_MS) {
      this.lastPingAt = now;
      this.pingBusy = true;
      const details = {
        flightId: this.assignment.flightId,
        callsign: this.assignment.registration,
        registration: this.assignment.registration,
        aircraft: this.assignment.aircraft,
        origin: this.assignment.origin,
        destination: this.assignment.destination,
        latitude: lat, longitude: lon, altitude: alt,
        heading, groundSpeed: speed, enginesRunning: true,
        phase: speed > 65 ? 'EN_ROUTE' : 'TAXI',
      };
      this.request(this.settings.apiBaseUrl, this.settings.token, '/api/acars', 'POST', {
        action: 'ping', licenseNumber: this.assignment.licenseNumber, flightData: details,
      })
        .catch(err => this.failure(`No se pudo enviar la posición: ${err.message}`))
        .finally(() => { this.pingBusy = false; });
    }
    // Nunca registrar solo por apagar motor: confirmar aterrizaje, parada y llegada real.
    const destination = this.assignment?.destinationCoords;
    const withinDestination = destination && validPosition &&
      haversineKm({ lat, lon }, destination) <= ARRIVAL_RADIUS_KM;
    const stoppedAtDestination = this.track && this.simPaused===false && !slew && cameraState!==17 && !on && onGround &&
      Number.isFinite(speed) && speed <= MAX_STOP_SPEED_KT &&
      this.track.hadAirborne && this.track.distanceKm >= MIN_DISTANCE_KM &&
      withinDestination;
    if (!stoppedAtDestination) this.stopCandidateAt = null;
    else if (this.stopCandidateAt === null) this.stopCandidateAt = now;

    if (this.track && stoppedAtDestination &&
        now - this.stopCandidateAt >= SHUTDOWN_STABLE_MS && !this.autoSending) {
      const flight = this.assignment;
      const report = {
        licenseNumber: flight.licenseNumber,
        apiBaseUrl: this.settings.apiBaseUrl,
        flightData: {
          flightId: flight.flightId,
          reportId: this.track.reportId,
          callsign: flight.registration,
          registration: flight.registration,
          aircraft: flight.aircraft,
          origin: flight.origin,
          destination: flight.destination,
          durationMinutes: Math.max(1, Math.round((now - this.track.startedAt) / 60_000)),
          distanceKm: Number(this.track.distanceKm.toFixed(3)),
          landingRateFpm: null,
        }
      };
      // Persistir antes de llamar al servidor: ante fallo de red el PIREP queda en disco.
      this.savePending(report);
      this.track = null;
      this.stopCandidateAt = null;
      this.emit('pending', report);
      this.emit('message', { level: 'info', text: 'Motor apagado. Llegada confirmada; procesando PIREP...' });
      if (this.autoPirep) {
        this.autoSending = true;
        void this.submitPending(this.settings).catch(err => {
          this.failure(`PIREP pendiente en este equipo: ${err.message}`);
          // Se conserva en disco; la reconexión reintentará sin duplicar estadísticas.
          if (this.state !== 'idle') this.disconnect({ silent: true });
          this.scheduleAuto();
        }).finally(() => { this.autoSending = false; });
      } else {
        this.emit('message', { level: 'info', text: 'PIREP preparado para revisión manual (modo seguro).' });
      }
    }
  }

  async submitPending(settings) {
    if (this.reportBusy) throw new Error('Ya se está enviando el PIREP.');
    const pending = this.getPending();
    if (!pending) throw new Error('No hay un PIREP pendiente.');
    if (!settings?.token) throw new Error('Guarda primero tu token ACARS.');
    if (pending.apiBaseUrl !== settings.apiBaseUrl) {
      throw new Error('El PIREP corresponde a otro servidor AVG.');
    }
    this.reportBusy = true;
    try {
      const result = await this.request(settings.apiBaseUrl, settings.token, '/api/acars', 'POST', {
        action: 'finish', licenseNumber: pending.licenseNumber, flightData: pending.flightData,
      });
      this.clearPending();
      this.emit('pending', null);
      this.emit('message', { level: 'ok', text: result.data?.duplicate ? 'PIREP ya registrado en AVG.' : 'PIREP guardado en AVG.' });
      const leg = this.assignment?.tripLeg === 'return' ? 'regreso' : 'ida';
      this.emit('notification', { type: 'complete', title: 'MOTOR APAGADO',
        detail: `Vuelo de ${leg} finalizado · PIREP confirmado` });
      if (result.data?.returnAssigned === true) {
        this.emit('notification', { type: 'ready', title: 'REGRESO ASIGNADO',
          detail: 'Esperando el encendido de motores' });
      }
      // El vuelo terminó: esperar un nuevo plan y evitar transmitir el vuelo anterior.
      if (this.state !== 'idle') this.disconnect({ silent: true });
      this.scheduleAuto(2_000);
      return result;
    } finally {
      this.reportBusy = false;
    }
  }

  disconnect({ silent = false, preserveTrack = false } = {}) {
    this.safety.reset();
    this.landing.reset();
    this.testMode = false;
    ++this.sessionId;
    const handle = this.handle;
    this.handle = null;
    if (!preserveTrack) this.track = null;
    this.lastPingAt = 0;
    this.lastUiAt = 0;
    this.lastSnapshotAt = 0;
    this.pingBusy = false;
    this.stopCandidateAt = null;
    this.state = 'idle';
    if (handle) {
      try { handle.close?.(); } catch {}
    }
    if (!silent) this.status('Desconectado de MSFS. No se envió ningún PIREP.');
    this.emit('telemetry', null);
    return true;
  }
}

module.exports = { FlightEngine };
