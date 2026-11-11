'use strict';
const http = require('node:http');
const https = require('node:https');

function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Ingresa la dirección de AVG.');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('La dirección del servidor no es válida.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Usa HTTPS. Solo localhost admite HTTP para pruebas.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Escribe solo la dirección principal, por ejemplo https://avg.example.com.');
  }
  return url.origin;
}

function requestAvg(baseUrl, token, pathname, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, normalizeBaseUrl(baseUrl));
    // AVG_DISTRIBUTION_HTTPS_GUARD
    const approvedRemoteOrigin = "https://aviacionvirtualgt.com";
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!localHost && (
        url.protocol !== 'https:' ||
        url.origin !== approvedRemoteOrigin
    )) {
      return reject(new Error('AVG: servidor remoto no autorizado.'));
    }
    if (url.origin !== normalizeBaseUrl(baseUrl)) return reject(new Error('Destino no autorizado.'));
    const body = data === null ? null : JSON.stringify(data);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'application/json',
        ...(body === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
      }
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
        if (text.length > 1_000_000) req.destroy(new Error('Respuesta demasiado grande.'));
      });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(text); }
        catch { return reject(new Error(`Respuesta no válida del servidor (HTTP ${res.statusCode}).`)); }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ httpStatus: res.statusCode, data: parsed });
        } else {
          const detail = typeof parsed?.error === 'string' ? parsed.error : 'Solicitud rechazada';
          reject(new Error(`HTTP ${res.statusCode}: ${detail}`));
        }
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error('No respondió el servidor en 15 segundos.')));
    req.on('error', reject);
    req.end(body === null ? undefined : body);
  });
}

function haversineKm(a, b) {
  const rad = v => v * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

module.exports = { normalizeBaseUrl, requestAvg, haversineKm };
