// TURN-креды для звонков через строгие сети.
//
// История вопроса: раньше в конфиге был публичный статический логин
// openrelayproject/openrelayproject. Metered его отключил — сервер
// openrelay.metered.ca теперь отвечает отказом, relay-кандидатов нет,
// и звонок между разными сетями не устанавливается.
//
// Рабочий бесплатный вариант без аккаунта — их же shared-secret схема:
//   1. username = "<время истечения>:<метка>"
//   2. credential = base64(HMAC-SHA1(secret, username))
// Подпись считается прямо в браузере через WebCrypto, секрет публичный.
//
// Если WebCrypto недоступен (старый движок, небезопасный контекст),
// остаются статические серверы из config.js — звонок не ломается.

import { STUN_SERVERS, TURN_STATICAUTH, TURN_FALLBACK } from "./config.js";

const HOUR = 3600;
let cache = null;

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * UTF-8 байты строки. TextEncoder есть не везде (например, в старых
 * движках и в тестовом окружении), поэтому есть запасной путь —
 * логин и секрет у нас ASCII, этого достаточно.
 */
function utf8(text) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** Есть ли в окружении WebCrypto с HMAC — от этого зависит подпись. */
export function canSign() {
  try {
    return Boolean(globalThis.crypto?.subtle?.importKey && globalThis.crypto?.subtle?.sign);
  } catch {
    return false;
  }
}

/**
 * Подписывает временный логин для staticauth.openrelay.metered.ca.
 * Возвращает { username, credential, expiresAt } или null.
 */
export async function mintTurnCredential({ ttlHours = TURN_STATICAUTH.ttlHours } = {}) {
  if (!canSign()) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + Math.round(ttlHours * HOUR);
  const username = `${expiresAt}:${TURN_STATICAUTH.userPrefix}`;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      utf8(TURN_STATICAUTH.secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, utf8(username));
    return {
      username,
      credential: toBase64(new Uint8Array(signature)),
      expiresAt,
    };
  } catch {
    return null;
  }
}

function staticauthServers({ username, credential }) {
  const host = TURN_STATICAUTH.host;
  return {
    urls: [
      `turn:${host}:80`,
      `turn:${host}:80?transport=tcp`,
      `turn:${host}:443`,
      `turn:${host}:443?transport=tcp`,
      `turns:${host}:443?transport=tcp`,
    ],
    username,
    credential,
  };
}

/**
 * Полный набор ICE-серверов для RTCPeerConnection.
 *
 * @returns {Promise<{servers: object[], turn: "signed"|"static"|"none", reason: string|null}>}
 */
export async function resolveIceServers({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.value;

  const servers = [...STUN_SERVERS];
  let turn = "none";
  let reason = null;

  // Подпись живёт ttlHours, кэш держим на час — запас на смену часов.
  const signed = await mintTurnCredential();
  if (signed) {
    servers.push(staticauthServers(signed));
    turn = "signed";
  } else if (!canSign()) {
    reason = "webcrypto-unavailable";
  } else {
    reason = "sign-failed";
  }

  // Статические серверы — запасной путь. Даже если основной провайдер
  // недоступен, часть сетей проходит через них.
  for (const entry of TURN_FALLBACK) servers.push(entry);
  if (turn === "none" && TURN_FALLBACK.length) turn = "static";

  const value = { servers, turn, reason };
  cache = { value, expiresAt: now + 60 * 60 * 1000 };
  return value;
}

/** Сбросить кэш — например, после неудачного звонка. */
export function resetIceCache() {
  cache = null;
}

/** Короткое описание ICE-серверов для логов (без паролей). */
export function describeIceServers(servers = []) {
  return servers.map((entry) => {
    const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    return {
      urls,
      auth: entry.username ? "static" : "none",
    };
  });
}
