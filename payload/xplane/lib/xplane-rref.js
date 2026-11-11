'use strict';

// AVG ACARS - X-Plane 11/12 RREF
// Modulo independiente. No envia datos a AVG.

const DATAREFS = Object.freeze([
  'sim/flightmodel/position/latitude',
  'sim/flightmodel/position/longitude',
  'sim/flightmodel/position/elevation',
  'sim/flightmodel/position/true_psi',
  'sim/flightmodel/position/groundspeed',
  'sim/flightmodel/failures/onground_any',
  'sim/flightmodel/engine/ENGN_running[0]',
  'sim/flightmodel/engine/ENGN_running[1]',
  'sim/flightmodel/engine/ENGN_running[2]',
  'sim/flightmodel/engine/ENGN_running[3]',
  'sim/flightmodel/forces/g_nrml',
  'sim/flightmodel/position/phi',
  'sim/flightmodel/position/vh_ind_fpm',
  'sim/time/paused',
  'sim/operation/prefs/replay_mode',
  'sim/operation/override/override_planepath[0]',
  'sim/flightmodel2/misc/has_crashed',
  // Optional touchdown metrics, appended to keep all existing RREF indices stable.
  'sim/flightmodel/position/y_agl',
  'sim/flightmodel/position/theta',
  'sim/flightmodel/position/Q'
]);

const METERS_TO_FEET = 3.280839895;
const MPS_TO_KNOTS = 1.943844492;

function requestPacket(index, frequency = 2) {
  if (!Number.isInteger(index) ||
      index < 0 || index >= DATAREFS.length) {
    throw new RangeError('Indice RREF invalido.');
  }

  if (!Number.isInteger(frequency) ||
      frequency < 0 || frequency > 10) {
    throw new RangeError('Frecuencia RREF invalida.');
  }

  const packet = Buffer.alloc(413);
  packet.write('RREF', 0, 'ascii');
  packet[4] = 0;
  packet.writeInt32LE(frequency, 5);
  packet.writeInt32LE(index, 9);
  packet.write(DATAREFS[index], 13, 399, 'ascii');

  return packet;
}

function parseResponse(packet) {
  const values = new Map();

  if (!Buffer.isBuffer(packet) ||
      packet.length < 13 ||
      (packet.length - 5) % 8 !== 0) {
    return values;
  }

  const header = packet.toString('ascii', 0, 5);

  if (header !== 'RREF,' && header !== 'RREF\x00') {
    return values;
  }

  for (let offset = 5; offset < packet.length; offset += 8) {
    const index = packet.readInt32LE(offset);
    const value = packet.readFloatLE(offset + 4);

    if (index >= 0 &&
        index < DATAREFS.length &&
        Number.isFinite(value)) {
      values.set(index, value);
    }
  }

  return values;
}

function normalizeTelemetry(values) {
  if (!(values instanceof Map)) return null;

  for (let i = 0; i <= 5; i++) {
    if (!Number.isFinite(values.get(i))) return null;
  }

  const latitude = values.get(0);
  const longitude = values.get(1);
  const elevation = values.get(2);
  const heading = values.get(3);
  const speed = values.get(4);
  const onGroundValue = values.get(5);

  if (Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180 ||
      speed < 0 ||
      onGroundValue < 0 ||
      onGroundValue > 1) {
    return null;
  }

  const engines = [6, 7, 8, 9]
    .map(index => values.get(index))
    .filter(Number.isFinite);

  if (!engines.length) return null;

  return {
    latitude,
    longitude,
    altitude: Math.round(elevation * METERS_TO_FEET),
    heading: Math.round(((heading % 360) + 360) % 360) % 360,
    groundSpeed: Math.round(speed * MPS_TO_KNOTS),
    onGround: onGroundValue > 0.5,
    enginesRunning: engines.some(value => value > 0.5),
    // Optional safety data must never prevent basic tracking in older X-Plane versions.
    safetyReady: [10,11,12,13,14,15].every(i=>Number.isFinite(values.get(i))),
    gForce: values.get(10), bank: values.get(11), verticalSpeed: values.get(12),
    paused: values.get(13)>0.5, replay: values.get(14)!==0 && Number.isFinite(values.get(14)),
    slew: values.get(15)>0.5,
    ...(Number.isFinite(values.get(16))?{crashDetected:values.get(16)>0.5}:{}),
    ...(Number.isFinite(values.get(17))?{aglFeet:values.get(17)*METERS_TO_FEET}:{}),
    ...(Number.isFinite(values.get(18))?{pitchDeg:values.get(18)}:{}),
    ...(Number.isFinite(values.get(19))?{pitchRateDegSec:values.get(19)}:{})
  };
}

module.exports = {
  DATAREFS,
  requestPacket,
  parseResponse,
  normalizeTelemetry
};