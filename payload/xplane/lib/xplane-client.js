'use strict';

const dgram = require('node:dgram');
const {
  DATAREFS,
  requestPacket,
  parseResponse,
  normalizeTelemetry
} = require('./xplane-rref');

class XPlaneClient {
  constructor({
    host = '127.0.0.1',
    port = 49000,
    staleMs = 4500,
    onTelemetry = () => {},
    onStatus = () => {}
  } = {}) {
    if (host !== '127.0.0.1') {
      throw new Error('Este laboratorio solo admite localhost.');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Puerto UDP invalido.');
    }
    if (!Number.isInteger(staleMs) || staleMs < 100) {
      throw new Error('Tiempo de espera invalido.');
    }

    this.host = host;
    this.port = port;
    this.staleMs = staleMs;
    this.onTelemetry = onTelemetry;
    this.onStatus = onStatus;
    this.socket = null;
    this.timer = null;
    this.values = new Map();
    this.receivedAt = new Map();
    this.connected = false;
    this.lastValidAt = 0;
  }

  async start() {
    if (this.socket) {
      throw new Error('Cliente X-Plane ya iniciado.');
    }

    const socket = dgram.createSocket('udp4');
    this.socket = socket;

    socket.on('message', (packet, sender) => {
      if (this.socket !== socket) return;
      if (sender.address !== this.host ||
          (sender.port !== this.port &&
           sender.port !== this.port + 1)) return;

      const updates = parseResponse(packet);
      const now = Date.now();

      for (const [index, value] of updates) {
        if (value <= -998) continue;
        this.values.set(index, value);
        this.receivedAt.set(index, now);
      }

      const complete = DATAREFS.slice(0,10).every((_, index) => {
        const time = this.receivedAt.get(index);
        return Number.isFinite(time) &&
          now - time <= this.staleMs;
      });

      if (!complete) return;

      const fresh = new Map([...this.values].filter(([i])=>i<10 || now-this.receivedAt.get(i)<=750));
      const telemetry = normalizeTelemetry(fresh);
      if (!telemetry) return;

      this.lastValidAt = now;

      if (!this.connected) {
        this.connected = true;
        this.onStatus({
          state: 'connected',
          label: 'Telemetria X-Plane recibida'
        });
      }

      this.onTelemetry(telemetry);
    });

    try {
      await new Promise((resolve, reject) => {
        const failed = err => {
          socket.off('listening', ready);
          reject(err);
        };

        const ready = () => {
          socket.off('error', failed);
          resolve();
        };

        socket.once('error', failed);
        socket.once('listening', ready);
        socket.bind(0, '127.0.0.1');
      });
    } catch (err) {
      this.socket = null;
      try { socket.close(); } catch {}
      throw err;
    }

    socket.on('error', err => {
      this.onStatus({
        state: 'error',
        label: `Error UDP: ${err.message}`
      });
    });

    for (let i = 0; i < DATAREFS.length; i++) {
      socket.send(
        requestPacket(i, 5),
        this.port,
        this.host
      );
    }

    const interval = Math.min(
      500,
      Math.max(50, Math.floor(this.staleMs / 3))
    );

    this.timer = setInterval(() => {
      if (!this.connected) return;

      if (Date.now() - this.lastValidAt > this.staleMs) {
        this.connected = false;
        this.values.clear();
        this.receivedAt.clear();

        this.onTelemetry(null);
        this.onStatus({
          state: 'stale',
          label: 'Senal X-Plane perdida'
        });
      }
    }, interval);

    this.onStatus({
      state: 'waiting',
      label: 'Esperando telemetria X-Plane'
    });

    return {
      listeningPort: socket.address().port,
      simulatorPort: this.port
    };
  }

  async stop() {
    const socket = this.socket;
    if (!socket) return;

    this.socket = null;
    clearInterval(this.timer);
    this.timer = null;
    this.connected = false;

    await Promise.all(DATAREFS.map((_, i) =>
      new Promise(resolve => {
        try {
          socket.send(
            requestPacket(i, 0),
            this.port,
            this.host,
            () => resolve()
          );
        } catch {
          resolve();
        }
      })
    ));

    await new Promise(resolve => {
      try { socket.close(resolve); }
      catch { resolve(); }
    });

    this.values.clear();
    this.receivedAt.clear();
    this.onTelemetry(null);

    this.onStatus({
      state: 'stopped',
      label: 'Cliente X-Plane detenido'
    });
  }
}

module.exports = { XPlaneClient };