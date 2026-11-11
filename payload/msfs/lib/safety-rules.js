'use strict';
// Same conservative classifier runs on the desktop and again on the server.
// An event is evidence for review; it never confirms damage or authorizes a charge.
function classifySafetyWindow(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const current = samples[samples.length - 1];
  const recent = samples.filter(s => current.at - s.at <= 8000);
  if (recent.length < 2 || recent.some(s => s.paused || s.replay || s.slew)) return null;
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1], b = recent[i], seconds = (b.at - a.at) / 1000;
    if (seconds <= 0 || seconds > 2) return null;
    const km = Math.hypot((b.latitude - a.latitude) * 111,
      (b.longitude - a.longitude) * 111 * Math.cos(b.latitude * Math.PI / 180));
    if (km > seconds * 0.35 + 0.02) return null;
  }
  const moving = recent.some(s => s.groundSpeed >= 30);
  if (!moving) return null;
  if (current.crashDetected === true)
    return {kind:'SIM_CRASH',reason:'El simulador indicó estado de accidente durante el vuelo o rodaje.'};
  if (current.onGround && current.groundSpeed >= 20 && current.gForce >= 4)
    return {kind:'GROUND_IMPACT',reason:'Contacto con el terreno con una fuerza de al menos 4 G.'};
  if (current.onGround && current.groundSpeed >= 20 && Math.abs(current.bank) >= 65)
    return {kind:'GROUND_BANK',reason:'Inclinación extrema en contacto con el terreno y en movimiento.'};
  const airborne = recent.filter(s => !s.onGround && s.groundSpeed >= 35 && current.at - s.at <= 2000);
  if (current.onGround && current.groundSpeed >= 25 && current.gForce >= 2.5 &&
      airborne.some(s => s.verticalSpeed <= -900))
    return {kind:'HARD_LANDING',reason:'Contacto con el terreno tras descenso de al menos 900 ft/min y carga de al menos 2.5 G.'};
  if (current.groundSpeed <= 10 && recent.some(s => current.at - s.at <= 4000 &&
      !s.onGround && s.groundSpeed >= 60 && s.verticalSpeed <= -1200 && s.altitude - current.altitude >= 30))
    return {kind:'ABRUPT_STOP',reason:'Descenso pronunciado seguido de detención brusca; posible impacto.'};
  return null;
}
module.exports = { classifySafetyWindow };
