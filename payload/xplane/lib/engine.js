'use strict';
const { randomUUID } = require('node:crypto');
const { SafetyRecorder } = require('./safety-recorder');
const { LandingAnalyzer } = require('./landing-analyzer');
const { haversineKm, requestAvg } = require('./network');
const { probeXPlane } = require('./xplane-probe');

const PING_EVERY_MS = 5_000;
const SHOW_EVERY_MS = 1_000;
const SNAPSHOT_EVERY_MS = 15_000;
const AUTO_RETRY_MS = 12_000;
const SHUTDOWN_STABLE_MS = 12_000;
const ARRIVAL_RADIUS_KM = 5;
const MAX_STOP_SPEED_KT = 5;
const MIN_DISTANCE_KM = 1;


class FlightEngine {
  constructor({ emit, recordSafety = () => {}, getPending, savePending, clearPending, request = requestAvg, autoPirep = false, probeXPlaneImpl = probeXPlane }) {
    this.emit = emit;
    this.safety = new SafetyRecorder(recordSafety, 'xplane');
    this.landing = new LandingAnalyzer(data => this.emit('notification', data));
    this.request = request;
    this.probeXPlane = probeXPlaneImpl;
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
    this.pingBusy = false;
    this.reportBusy = false;
    this.lastUiAt = 0;
    this.lastPingAt = 0;
    this.lastSnapshotAt = 0;
    this.lastFailureAt = 0;
    this.simName = '';
    this.simKind = '';
    this.autoEnabled = false;
    this.autoTimer = null;
    this.autoSettings = null;
  }

  status(label, level = 'info') {
    this.emit('status', {
      state: this.state,
      label,
      level,
      simKind: this.state === 'connected' ? this.simKind : null,
      simName: this.state === 'connected' ? this.simName : ''
    });
  }

  // Intenta conectar cuando X-Plane entregue telemetria valida.
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
      this.status('Esperando simulador compatible y vuelo asignado...');
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

  async connect(settings, { automatic = false } = {}) {
    if (this.state !== 'idle') throw new Error('El ACARS ya se está conectando o está conectado.');
    if (this.getPending()) throw new Error('Tienes un PIREP pendiente. Revísalo antes de iniciar otro vuelo.');
    this.state = 'connecting';
    this.settings = settings;
    const sid = ++this.sessionId;
    this.status('Consultando vuelo asignado en AVG...');
    try {
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
      // Aplicacion exclusiva para X-Plane 11 y 12.
      if (this.track &&
          this.track.simKind !== 'xplane') {
        throw new Error(
          'El vuelo interrumpido no pertenece a X-Plane.'
        );
      }

      this.status('Buscando X-Plane 11/12...');

      let detected;

      try {
        detected = await this.probeXPlane({
          timeoutMs: 2600
        });
      } catch (err) {
        if (this.track) {
          throw new Error(
            'Vuelo X-Plane interrumpido. Esperando el mismo simulador.'
          );
        }

        throw new Error(
          `X-Plane no disponible: ${err?.message || 'sin telemetria'}`
        );
      }

      if (sid !== this.sessionId) {
        try { await detected?.client?.stop?.(); } catch {}
        return;
      }

      const client = detected?.client;

      if (!client ||
          typeof client.stop !== 'function' ||
          !detected.telemetry) {
        try { await client?.stop?.(); } catch {}
        throw new Error('Deteccion X-Plane incompleta.');
      }

      this.simName = 'X-Plane';
      this.simKind = 'xplane';

      this.handle = {
        close() {
          void Promise.resolve()
            .then(() => client.stop())
            .catch(() => {});
        }
      };

      client.onTelemetry = telemetry => {
        if (sid !== this.sessionId ||
            this.state !== 'connected' ||
            !telemetry) return;

        try {
          this.onXPlaneData(telemetry);
        } catch (err) {
          this.failure(`X-Plane: ${err.message}`);
        }
      };

      client.onStatus = status => {
        if (sid !== this.sessionId ||
            this.state !== 'connected') return;

        if (status?.state === 'stale' ||
            status?.state === 'error') {
          this.onSimDisconnected(sid);
        }
      };

      this.state = 'connected';
      this.status('Conectado a X-Plane', 'ok');

      if (!this.onXPlaneData(detected.telemetry)) {
        throw new Error('Primera lectura X-Plane invalida.');
      }

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
    const interrupted = Boolean(this.track);
    const simulator = this.simName || 'Simulador';
    this.disconnect({ silent: true, preserveTrack: interrupted });
    this.status(interrupted
      ? `${simulator} desconectado. Reintentando; no se enviará PIREP automáticamente.`
      : `${simulator} desconectado. Esperando reconexión automática...`);
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
    const on = combustion1 > 0 || combustion2 > 0;

    return this.onFlightTelemetry({
      lat, lon, alt, heading, speed, onGround, on
    });
  }

  onXPlaneData(telemetry) {
    if (!telemetry || typeof telemetry !== 'object') {
      return false;
    }

    const fields = [
      'latitude', 'longitude', 'altitude',
      'heading', 'groundSpeed'
    ];

    if (!fields.every(key =>
      typeof telemetry[key] === 'number' &&
      Number.isFinite(telemetry[key])
    )) {
      return false;
    }

    if (Math.abs(telemetry.latitude) > 90 ||
        Math.abs(telemetry.longitude) > 180 ||
        telemetry.groundSpeed < 0 ||
        typeof telemetry.onGround !== 'boolean' ||
        typeof telemetry.enginesRunning !== 'boolean') {
      return false;
    }

    this.onFlightTelemetry({
      lat: telemetry.latitude,
      lon: telemetry.longitude,
      alt: Math.round(telemetry.altitude),
      heading: Math.round(telemetry.heading),
      speed: Math.round(telemetry.groundSpeed),
      onGround: telemetry.onGround,
      on: telemetry.enginesRunning,
      safety: telemetry
    });

    return true;
  }

  onFlightTelemetry({ lat, lon, alt, heading, speed, onGround, on, safety = {} }) {
    const now = Date.now();
    const validPosition = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if (on && !this.track && !this.getPending()) {
      this.track = { flightId: this.assignment.flightId,
        simKind: 'xplane',
        reportId: randomUUID(), startedAt: now,
        lastPosition: null, distanceKm: 0, hadEngineOn: true, hadAirborne: false };
      this.stopCandidateAt = null;
      const leg = this.assignment.tripLeg === 'return' ? 'regreso' : 'ida';
      this.emit('message', { level: 'ok', text: `Motor encendido. Vuelo de ${leg} iniciado.` });
      this.emit('notification', { type: 'start', title: 'MOTOR ENCENDIDO', detail: `Vuelo de ${leg} iniciado` });
    }
    this.landing.record({at:now,onGround,groundSpeed:speed,verticalSpeed:safety.verticalSpeed,
      gForce:safety.gForce,aglFeet:safety.aglFeet,pitchDeg:safety.pitchDeg,
      pitchRateDegSec:safety.pitchRateDegSec,paused:safety.paused===true,
      replay:safety.replay===true,slew:safety.slew===true,
      crashDetected:safety.crashDetected===true});
    if(this.track && validPosition)this.safety.record({flightId:this.assignment.flightId,
      licenseNumber:this.assignment.licenseNumber,apiBaseUrl:this.settings.apiBaseUrl},
      {at:now,latitude:lat,longitude:lon,altitude:alt,groundSpeed:speed,onGround,
       safetyReady:safety.safetyReady===true,gForce:safety.gForce,bank:safety.bank,
       verticalSpeed:safety.verticalSpeed,paused:safety.paused===true,replay:safety.replay===true,
       slew:safety.slew===true,...(typeof safety.crashDetected==='boolean'?{crashDetected:safety.crashDetected}:{})});
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
    const stoppedAtDestination = this.track && !safety.paused && !safety.replay && !safety.slew && !on && onGround &&
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
    if (!silent) this.status('Desconectado de X-Plane. No se envió ningún PIREP.');
    this.emit('telemetry', null);
    return true;
  }
}

module.exports = { FlightEngine };
