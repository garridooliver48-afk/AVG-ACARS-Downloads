'use strict';
const $ = id => document.getElementById(id);
let connected = false;
let connecting = false;
let sending = false;
let discarding = false;
let loggingIn = false;
let pending = null;
let hasSession = false;

function log(text, level = 'info') {
  const events = $('events');
  const block = document.createElement('div');
  block.className = 'event ' + (level === 'ok' ? 'success' : level === 'error' ? 'danger' : '');
  const time = document.createElement('span');
  time.className = 'event-time';
  time.textContent = new Date().toLocaleTimeString('es-GT');
  const message = document.createElement('p');
  message.textContent = String(text);
  block.append(time, message);
  events.prepend(block);
  while (events.children.length > 8) events.lastElementChild.remove();
}
function showError(err) { log(err?.message || String(err), 'error'); }
function fmtNumber(num, digits = 0) { return Number.isFinite(num) ? num.toLocaleString('es-GT', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '---'; }
function fmtTime(sec) { const n = Math.max(0, Number(sec) || 0); return `${String(Math.floor(n/3600)).padStart(2, '0')}:${String(Math.floor(n%3600/60)).padStart(2, '0')}`; }
function updateButtons() {
  $('email').disabled = loggingIn || connected || connecting;
  $('password').disabled = loggingIn || connected || connecting;
  $('url').disabled = loggingIn || connected || connecting;
  $('login').disabled = loggingIn || connected || connecting;
  $('logout').disabled = loggingIn;
  $('submit').disabled = sending || discarding || !pending;
  $('discard').disabled = sending || discarding || !pending;
}
function setAuth(data) {
  hasSession = Boolean(data?.hasToken && !data?.required);
  $('loginFields').hidden = hasSession;
  $('signedInFields').hidden = !hasSession;
  $('accountTag').textContent = hasSession ? 'CONECTADA' : 'INGRESAR';
  $('accountEmail').textContent = data?.email || 'Cuenta AVG conectada';
  if (data?.apiBaseUrl) $('url').value = data.apiBaseUrl;
  if (data?.email) $('email').value = data.email;
  $('password').value = '';
  $('configPanel').open = !hasSession;
  if (!hasSession) {
    $('statusShort').textContent = 'Inicia sesión';
    $('simState').textContent = 'ESPERANDO CUENTA';
  }
  updateButtons();
}
function showPending(p) {
  pending = p;
  $('reportPanel').hidden = !p;
  if (p) {
    const f = p.flightData;
    $('reportRoute').textContent = `${f.origin} → ${f.destination}`;
    $('reportMetrics').textContent = `${f.durationMinutes} min · ${fmtNumber(f.distanceKm, 2)} km`;
  }
  updateButtons();
}
function updateStatus(data) {
  const isConnected =
    data?.state === 'connected' &&
    data?.simKind === 'xplane';

  const isConnecting = data?.state === 'connecting';

  $('statusMessage').textContent = data?.label || 'Listo';

  $('statusShort').textContent = isConnected
    ? 'X-Plane conectado'
    : isConnecting
      ? 'Conectando con X-Plane...'
      : hasSession
        ? 'Esperando X-Plane'
        : 'Inicia sesión';

  $('statusPill').className = 'connection ' +
    (isConnected ? 'ok' : data?.level === 'error' ? 'error' : '');

  $('simState').textContent = isConnected
    ? 'X-PLANE ACTIVO'
    : 'BUSCANDO X-PLANE';

  connected = isConnected;
  connecting = isConnecting;
  updateButtons();
}
function updateFlight(f) {
  $('pilotLicense').textContent = f.licenseNumber || 'SIN ASIGNAR';
  $('origin').textContent = f.origin || '----';
  $('destination').textContent = f.destination || '----';
  $('aircraft').textContent = f.aircraft || '—';
  $('registration').textContent = f.registration || '—';
  $('fuel').textContent = f.targetFuelLiters != null ? f.targetFuelLiters + ' L' : '—';
  $('weight').textContent = f.targetWeightKg != null ? f.targetWeightKg + ' kg' : '—';
  log(`Vuelo asignado: ${f.licenseNumber} · ${f.origin} → ${f.destination}`, 'ok');
}
function updateTelemetry(t) {
  $('speed').textContent = t ? fmtNumber(t.groundSpeed) : '---';
  $('altitude').textContent = t ? fmtNumber(t.altitude) : '---';
  $('heading').textContent = t ? fmtNumber(t.heading) : '---';
  $('distance').textContent = t ? fmtNumber(t.distanceKm, 1) : '0.0';
  $('duration').textContent = t ? fmtTime(t.durationSeconds) : '00:00';
  $('coords').textContent = t && t.latitude != null && t.longitude != null ? `Lat ${t.latitude.toFixed(5)} · Lon ${t.longitude.toFixed(5)}` : 'Lat — · Lon —';
  $('speedFill').style.width = `${Math.min(100, Math.max(0, (t?.groundSpeed || 0) / 300 * 100))}%`;
  $('engineState').textContent = t?.enginesRunning ? 'Motor encendido · registrando' : 'Motor detenido';
  $('engineDot').classList.toggle('on', Boolean(t?.enginesRunning));
}

$('login').addEventListener('click', async () => {
  if (loggingIn) return;
  loggingIn = true; updateButtons();
  try {
    const settings = {
      email: $('email').value.trim(),
      password: $('password').value,
      apiBaseUrl: $('url').value.trim(),
    };
    const result = await window.avg.login(settings);
    setAuth(result);
    log('Sesión AVG iniciada. Detección automática activada.', 'ok');
  } catch (err) { showError(err); }
  finally { $('password').value = ''; loggingIn = false; updateButtons(); }
});
$('password').addEventListener('keydown', event => { if (event.key === 'Enter') $('login').click(); });
$('logout').addEventListener('click', async () => {
  try { setAuth(await window.avg.logout()); log('Sesión cerrada.', 'ok'); }
  catch (err) { showError(err); }
});
$('portal').addEventListener('click', async () => { try { await window.avg.openPortal(); } catch (err) { showError(err); } });
$('submit').addEventListener('click', async () => {
  if (!pending || sending) return;
  const f = pending.flightData;
  if (!window.confirm(`¿Enviar PIREP oficial de ${f.origin} a ${f.destination}?\n\nDuración: ${f.durationMinutes} min\nDistancia: ${fmtNumber(f.distanceKm, 2)} km\n\nEsto completará el vuelo y actualizará las estadísticas del piloto.`)) return;
  sending = true; updateButtons();
  try { const result = await window.avg.sendPirep(); log(result.data?.message || 'PIREP registrado.', 'ok'); }
  catch (err) { showError(err); }
  finally { sending = false; updateButtons(); }
});
$('discard').addEventListener('click', async () => {
  if (!pending || sending || discarding) return;
  discarding = true; updateButtons();
  try {
    const result = await window.avg.discardPirep();
    if (result?.discarded) {
      showPending(null);
      log('PIREP de prueba descartado localmente. No se envió ningún reporte.', 'ok');
    }
  } catch (err) { showError(err); }
  finally { discarding = false; updateButtons(); }
});
window.avg.onEvent((event, payload) => {
  if (event === 'status') updateStatus(payload);
  else if (event === 'flight') updateFlight(payload);
  else if (event === 'telemetry') updateTelemetry(payload);
  else if (event === 'message') log(payload.text, payload.level);
  else if (event === 'pending') showPending(payload);
  else if (event === 'auth') {
    if (payload?.required) { setAuth({ hasToken: false }); log('Vuelve a iniciar sesión para conectar AVG ACARS.', 'error'); }
    else setAuth(payload);
  }
});
window.avg.getInitial().then(data => {
  setAuth(data);
  showPending(data.pending);
  updateStatus({ state: 'idle', label: data.hasToken ? 'Esperando vuelo asignado y X-Plane...' : 'Inicia sesión con tu cuenta AVG.' });
}).catch(showError);
