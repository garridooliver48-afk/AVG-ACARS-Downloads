'use strict';

const { XPlaneClient } = require('./xplane-client');

function validTelemetry(t) {
  if (!t || typeof t !== 'object') return false;

  const fields = [
    'latitude', 'longitude', 'altitude',
    'heading', 'groundSpeed'
  ];

  if (!fields.every(key =>
    typeof t[key] === 'number' &&
    Number.isFinite(t[key])
  )) return false;

  return (
    Math.abs(t.latitude) <= 90 &&
    Math.abs(t.longitude) <= 180 &&
    t.groundSpeed >= 0 &&
    typeof t.onGround === 'boolean' &&
    typeof t.enginesRunning === 'boolean'
  );
}

async function probeXPlane({
  port = 49000,
  timeoutMs = 2500,
  createClient = options => new XPlaneClient(options)
} = {}) {
  if (!Number.isInteger(timeoutMs) ||
      timeoutMs < 50 ||
      timeoutMs > 30000) {
    throw new Error('Timeout de deteccion invalido.');
  }

  if (typeof createClient !== 'function') {
    throw new Error('Fabrica de cliente invalida.');
  }

  let resolveTelemetry;
  let active = true;
  let timer;

  const firstTelemetry = new Promise(resolve => {
    resolveTelemetry = resolve;
  });

  const client = createClient({
    port,
    onTelemetry: telemetry => {
      if (active && validTelemetry(telemetry)) {
        resolveTelemetry(telemetry);
      }
    },
    onStatus: () => {}
  });

  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        'X-Plane no entrego telemetria valida dentro del plazo.'
      ));
    }, timeoutMs);
  });

  try {
    await Promise.race([
      Promise.resolve().then(() => client.start()),
      deadline
    ]);

    const telemetry = await Promise.race([
      firstTelemetry,
      deadline
    ]);

    active = false;

    return {
      client,
      telemetry,
      simulator: 'X-Plane'
    };
  } catch (error) {
    active = false;

    try {
      await client.stop();
    } catch {}

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  validTelemetry,
  probeXPlane
};