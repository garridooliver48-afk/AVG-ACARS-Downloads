
'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  dialog,
  screen,
} = require('electron');

const fs = require('node:fs');
const path = require('node:path');

const { normalizeBaseUrl, requestAvg } = require('./lib/network');
const { FlightEngine } = require('./lib/engine');
const { SafetyOutbox } = require('./lib/safety-outbox');
let safetyOutbox;
let safetyTimer;
const {createShutdown}=require('./lib/shutdown');
const shutdown=createShutdown({
  getEngine:()=>engine,
  stopBackground:()=>{
    clearInterval(safetyTimer);
    clearTimeout(overlayTimeout);
    overlayQueue.length=0;
  },
  getWindows:()=>BrowserWindow.getAllWindows(),
});
app.on('before-quit',shutdown);

const testDataDir = path.join(app.getPath('appData'), 'AVG-ACARS-v012-OFICIAL');
fs.mkdirSync(testDataDir, { recursive: true });
app.setPath('userData', testDataDir);
app.setAppUserModelId('com.avgairline.acars.test');

let win;
let overlayWin;
let overlayReady = false;
let overlayTimeout;
const overlayQueue = [];
let overlayShowing = false;
let engine;
let pending = null;
let settingsPath;
let pendingPath;
let loginBusy = false;
let pirepBusy = false;

const DEFAULT_AVG_URL =
  'https://aviacionvirtualgt.com';

// ========================================
// CONFIGURACIÓN LOCAL
// ========================================

function loadJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const temp = file + '.tmp';

  fs.writeFileSync(temp, JSON.stringify(data, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });

  fs.renameSync(temp, file);
}

function publicConfig() {
  const data = loadJson(settingsPath, {});

  const valid =
    Boolean(data.tokenEncrypted) &&
    (!data.expiresAt ||
      Date.parse(data.expiresAt) > Date.now() + 60_000);

  return {
    apiBaseUrl: data.apiBaseUrl || DEFAULT_AVG_URL,
    hasToken: valid,
    email: data.email || '',
    expiresAt: data.expiresAt || null,
  };
}

function privateConfig() {
  const data = loadJson(settingsPath, {});

  if (!data.tokenEncrypted) {
    throw new Error('Inicia sesión en AVG primero.');
  }

  if (
    data.expiresAt &&
    Date.parse(data.expiresAt) <= Date.now() + 60_000
  ) {
    throw new Error(
      'Sesión vencida. Ingresa de nuevo con tu cuenta AVG.'
    );
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Windows no permite descifrar el token en este equipo.'
    );
  }

  let token;

  try {
    token = safeStorage.decryptString(
      Buffer.from(data.tokenEncrypted, 'base64')
    );
  } catch {
    throw new Error(
      'No se pudo descifrar el token. Vuelve a guardarlo.'
    );
  }

  return {
    apiBaseUrl: normalizeBaseUrl(
      data.apiBaseUrl || DEFAULT_AVG_URL
    ),
    token,
    licenseNumber: data.licenseNumber,
  };
}

// ========================================
// EVENTOS DE LA APLICACIÓN
// ========================================

function send(event, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('avg:event', {
      event,
      payload,
    });
  }
}

// Notificaciones click-through; solo contenido local, nunca tokens ni credenciales.
function createOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) return;
  overlayWin = new BrowserWindow({
    width: 385, height: 92, frame: false, transparent: true, show: false,
    resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  overlayWin.setPosition(Math.round(x + (width - 385) / 2), y + 22);
  overlayWin.loadFile(path.join(__dirname, 'ui', 'overlay.html'));
  overlayWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlayWin.webContents.on('will-navigate', event => event.preventDefault());
  overlayWin.webContents.once('did-finish-load', () => {
    overlayReady = true;
    drainOverlay();
  });
  overlayWin.on('closed', () => { overlayWin = null; overlayReady = false; overlayShowing = false; if (overlayTimeout) clearTimeout(overlayTimeout); });
}

function drainOverlay() {
  if (!overlayReady || overlayShowing || !overlayWin || overlayWin.isDestroyed()) return;
  const payload = overlayQueue.shift();
  if (!payload) return;
  const landing = payload.type === 'landing';
  const w = landing ? 535 : 385;
  overlayWin.setSize(w, landing ? 162 : 92);
  const screenArea = screen.getPrimaryDisplay().workArea;
  overlayWin.setPosition(Math.round(screenArea.x+(screenArea.width-w)/2),screenArea.y+22);
  overlayShowing = true;
  overlayWin.webContents.send('avg:overlay', payload);
  overlayWin.showInactive();
  overlayTimeout = setTimeout(() => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
    overlayShowing = false;
    drainOverlay();
  }, payload.type === 'landing' ? 7_000 : 4_000);
}

function showOverlay(payload) {
  if (!payload || !['start', 'complete', 'ready', 'landing'].includes(payload.type)) return;
  overlayQueue.push({
    type: payload.type,
    title: String(payload.title || '').slice(0, 55),
    detail: String(payload.detail || '').slice(0, 110),
    ...(payload.type === 'landing' ? {
      verticalSpeedFpm: Number.isFinite(payload.verticalSpeedFpm) ? payload.verticalSpeedFpm : null,
      gForce: Number.isFinite(payload.gForce) ? payload.gForce : null,
      noseRateDegSec: Number.isFinite(payload.noseRateDegSec) ? payload.noseRateDegSec : null,
      floatSeconds: Number.isFinite(payload.floatSeconds) ? payload.floatSeconds : null,
      verdict: String(payload.verdict || 'LANDING').slice(0, 35)
    } : {}),
  });
  if (overlayQueue.length > 4) overlayQueue.shift();
  drainOverlay();
}

// ========================================
// VENTANA PRINCIPAL
// ========================================

function createWindow() {
  win = new BrowserWindow({
    width: 1160,
    height: 790,
    minWidth: 880,
    minHeight: 650,
    backgroundColor: '#080f1c',
    title: 'AVG ACARS',
    autoHideMenuBar: true,
    show: false,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu();

  win.loadFile(
    path.join(__dirname, 'ui', 'index.html')
  );

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', event => {
    if (engine?.track) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: [
          'Seguir volando',
          'Cerrar de todos modos',
        ],
        defaultId: 0,
        cancelId: 0,
        title: 'Vuelo en curso',
        message: 'Todavía estás registrando un vuelo.',
        detail:
          'Si cierras ahora, no se creará un PIREP de este vuelo y podrías perder el tiempo y la distancia acumulados.',
      });

      if (choice === 0) {
        event.preventDefault();
      }
    }
  });

  win.on('closed',()=>{
    win=null;
    shutdown();
    app.quit();
  });

  win.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));

  win.webContents.on('will-navigate', event => {
    event.preventDefault();
  });

  win.webContents.on('did-finish-load', () => {
    send('status', {
      state: 'idle',
      label: 'Preparando detección automática de MSFS...',
    });

    send('pending', pending);

    if (publicConfig().hasToken) {
      try {
        engine.startAuto(privateConfig());
      } catch (err) {
        send('message', {
          level: 'error',
          text: err.message,
        });
      }
    }
  });
}

// ========================================
// COMUNICACIÓN CON LA INTERFAZ
// ========================================

function bindIpc() {

  // ----------------------------------------
  // OBTENER CONFIGURACIÓN INICIAL
  // ----------------------------------------

  ipcMain.handle('avg:getInitial', () => ({
    ...publicConfig(),
    pending,
    trainingMode: engine?.testMode === true,
  }));

  // ----------------------------------------
  // INICIAR SESIÓN AVG
  // ----------------------------------------

  ipcMain.handle('avg:login', async (_event, payload) => {
    if (loginBusy) {
      throw new Error(
        'Ya hay un inicio de sesión en curso.'
      );
    }

    if (engine.state !== 'idle' || engine.track) {
      throw new Error(
        'No cambies de cuenta durante un vuelo.'
      );
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('Datos inválidos.');
    }

    const apiBaseUrl = normalizeBaseUrl(
      payload.apiBaseUrl || DEFAULT_AVG_URL
    );

    const email =
      typeof payload.email === 'string'
        ? payload.email.trim().toLowerCase()
        : '';

    const password = payload.password;

    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 254 ||
      typeof password !== 'string' ||
      !password ||
      password.length > 1024
    ) {
      throw new Error(
        'Escribe un correo y una contraseña válidos.'
      );
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'No está disponible el cifrado de Windows.'
      );
    }

    loginBusy = true;

    try {
      // La contraseña se utiliza únicamente
      // durante el inicio de sesión.

      const result = await requestAvg(
        apiBaseUrl,
        null,
        '/api/acars/desktop-login',
        'POST',
        { email, password }
      );

      const {
        token,
        expiresAt,
        licenseNumber,
      } = result.data || {};

      if (
        typeof token !== 'string' ||
        !token.startsWith('avgacars.v1.') ||
        typeof expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= Date.now() ||
        typeof licenseNumber !== 'string'
      ) {
        throw new Error(
          'El servidor no devolvió una sesión ACARS válida.'
        );
      }

      // Guardar el token cifrado en Windows.

      const tokenEncrypted = safeStorage
        .encryptString(token)
        .toString('base64');

      saveJson(settingsPath, {
        apiBaseUrl,
        tokenEncrypted,
        licenseNumber,
        expiresAt,
        email,
      });

      // Iniciar detección automática de MSFS.

      engine.startAuto(privateConfig());
      void safetyOutbox.flush();

      const publicData = publicConfig();

      send('auth', publicData);

      return publicData;

    } finally {
      loginBusy = false;
    }
  });

  // ----------------------------------------
  // CERRAR SESIÓN AVG DE FORMA SEGURA
  // ----------------------------------------

  ipcMain.handle('avg:logout', async () => {

    if (engine.track) {
      throw new Error(
        'No cierres sesión durante un vuelo.'
      );
    }

    if (pending) {
      throw new Error(
        'Envía o descarta el PIREP pendiente antes de cerrar sesión.'
      );
    }

    const current = loadJson(settingsPath, {});

    const apiBaseUrl = normalizeBaseUrl(
      current.apiBaseUrl || DEFAULT_AVG_URL
    );

    // Si existe un token guardado, revocarlo en Neon
    // antes de eliminarlo de Windows.

    if (current.tokenEncrypted) {

      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'Windows no permite descifrar la sesión.'
        );
      }

      let token;

      try {
        token = safeStorage.decryptString(
          Buffer.from(current.tokenEncrypted, 'base64')
        );
      } catch {
        throw new Error(
          'No se pudo descifrar la sesión guardada.'
        );
      }

      try {
        await requestAvg(
          apiBaseUrl,
          token,
          '/api/acars/logout',
          'POST'
        );
      } catch (error) {

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        // HTTP 401 significa que el servidor
        // ya no reconoce este token.
        // En ese caso se puede borrar localmente.

        if (!/^HTTP 401:/.test(message)) {
          throw new Error(
            'No se pudo revocar la sesión en AVG: ' +
            message
          );
        }
      }
    }

    // Detener la conexión automática.

    engine.stopAuto();

    // Borrar únicamente la credencial local.
    // Conservar la dirección del servidor.

    saveJson(settingsPath, {
      apiBaseUrl,
    });

    const data = publicConfig();

    send('auth', data);

    return data;
  });

  // ----------------------------------------
  // ENTRENAMIENTO DE ATERRIZAJES (SIN CUENTA / SIN PIREP)
  // ----------------------------------------
  ipcMain.handle('avg:startTraining', async () => {
    if (!engine) throw new Error('ACARS no está preparado.');
    if (engine.testMode) return { enabled:true };
    if (pending || engine.track || engine.reportBusy || engine.autoSending) {
      throw new Error('Hay una misión o PIREP pendiente. No se puede iniciar entrenamiento.');
    }
    // Desconectar la sesión de misión, incluso los reintentos; no cerrar la cuenta.
    engine.stopAuto();
    try {
      await engine.connect(null, { testMode:true });
      send('training', {enabled:true});
      send('message', {level:'ok',text:'ENTRENAMIENTO ACTIVO: sin misión, sin radar y sin PIREP.'});
      return { enabled:true };
    } catch (error) {
      send('training', {enabled:false});
      throw error;
    }
  });
  ipcMain.handle('avg:stopTraining', () => {
    if (engine?.testMode) engine.stopAuto();
    send('training', {enabled:false});
    send('flight', {licenseNumber:'SIN ASIGNAR',origin:'----',destination:'----',
      aircraft:'—',registration:'—',targetFuelLiters:null,targetWeightKg:null});
    send('status', {state:'idle',label:'Prueba terminada. Para activar misiones oficiales, reinicia AVG ACARS.'});
    return {enabled:false};
  });

  // ----------------------------------------
  // ENVIAR PIREP
  // ----------------------------------------

  ipcMain.handle('avg:sendPirep', async () => {

    if (pirepBusy) {
      throw new Error(
        'Ya se está procesando un PIREP.'
      );
    }

    pirepBusy = true;

    try {
      return await engine.submitPending(
        privateConfig()
      );
    } finally {
      pirepBusy = false;
    }
  });

  // ----------------------------------------
  // DESCARTAR PIREP PENDIENTE
  // ----------------------------------------

  ipcMain.handle('avg:discardPirep', () => {

    if (engine.track) {
      throw new Error(
        'No puedes descartar el PIREP durante un vuelo en curso.'
      );
    }

    if (pirepBusy) {
      throw new Error(
        'Espera a que termine la operación del PIREP.'
      );
    }

    if (!pending) {
      throw new Error(
        'No hay ningún PIREP pendiente.'
      );
    }

    const f = pending.flightData || {};

    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [
        'Cancelar',
        'Descartar PIREP',
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Descartar PIREP de prueba',
      message:
        '¿Descartar definitivamente este PIREP pendiente?',
      detail:
        `${f.origin || '----'} → ${f.destination || '----'} · ` +
        `${f.durationMinutes ?? 0} min · ` +
        `${f.distanceKm ?? 0} km.\n\n` +
        'Se eliminará solamente el reporte guardado en este equipo. ' +
        'No se enviará como vuelo completado ni se modificarán estadísticas. ' +
        'Las posiciones ya enviadas al radar no se borrarán.',
    });

    if (choice !== 1) {
      return {
        discarded: false,
      };
    }

    // Eliminar únicamente el PIREP local.

    if (fs.existsSync(pendingPath)) {
      fs.unlinkSync(pendingPath);
    }

    pending = null;

    send('pending', null);

    return {
      discarded: true,
    };
  });

  // ----------------------------------------
  // ABRIR PÁGINA WEB AVG
  // ----------------------------------------

  ipcMain.handle('avg:openPortal', async () => {

    const url = new URL(
      normalizeBaseUrl(
        publicConfig().apiBaseUrl
      )
    );

    await shell.openExternal(
      `${url.origin}/generar`
    );
  });
}

// ========================================
// INICIALIZACIÓN DE AVG ACARS
// ========================================

if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(() => {

  settingsPath = path.join(
    app.getPath('userData'),
    'config.json'
  );

  pendingPath = path.join(
    app.getPath('userData'),
    'pirep-pendiente.json'
  );

  pending = loadJson(pendingPath);

  try {
    safetyOutbox = new SafetyOutbox({file:path.join(app.getPath('userData'),'evidencia-pendiente.json'),
      getSettings:privateConfig,request:requestAvg,
      onStatus:text=>send('message',{level:'info',text})});
  } catch(error) {
    dialog.showErrorBox('AVG: evidencia pendiente',error.message);
    app.quit();return;
  }
  safetyTimer=setInterval(()=>void safetyOutbox.flush(),15000);
  safetyTimer.unref();
  void safetyOutbox.flush();
  engine = new FlightEngine({
    recordSafety:event=>safetyOutbox.enqueue(event),

    emit: (name, data) => {

      // Si el servidor rechaza la credencial,
      // eliminar solamente el token guardado.

      if (name === 'auth' && data?.required) {

        const old = loadJson(settingsPath, {});

        saveJson(settingsPath, {
          apiBaseUrl:
            old.apiBaseUrl || DEFAULT_AVG_URL,
          email: old.email || '',
        });
      }

      // No mostrar tokens ni contraseñas.

      if (name === 'notification') showOverlay(data);
      if (name !== 'snapshot' && name !== 'notification') send(name, data);
    },

    getPending: () => pending,

    savePending: report => {

      if (pending) {
        throw new Error(
          'Ya hay un PIREP pendiente.'
        );
      }

      saveJson(pendingPath, report);

      pending = report;
    },

    // En esta versión preliminar, la escritura automática sigue desactivada.
    // Se habilitará únicamente después de instalar y probar la API compatible.
    autoPirep: true,

    clearPending: () => {

      if (fs.existsSync(pendingPath)) {
        fs.unlinkSync(pendingPath);
      }

      pending = null;
    },
  });

  bindIpc();
  createWindow();
  createOverlay();

  app.on('activate', () => {

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// ========================================
// CIERRE DE LA APLICACIÓN
// ========================================

app.on('window-all-closed', () => {
  shutdown();
  app.quit();
});
