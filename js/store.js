import { STORAGE_KEYS, COOKIE_UID, APP } from "./config.js";

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function getProfile() {
  const p = readJSON(STORAGE_KEYS.profile, null);
  if (!p || typeof p.nick !== "string") return null;
  return p;
}

export function saveProfile(profile) {
  writeJSON(STORAGE_KEYS.profile, {
    nick: profile.nick,
    uid: profile.uid || null,
    createdAt: profile.createdAt || Date.now(),
  });
}

export function clearProfile() {
  try {
    localStorage.removeItem(STORAGE_KEYS.profile);
  } catch {}
  deleteCookie();
}

export function setCookie(name, value, days = 365) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; expires=${expires}; SameSite=Lax${secure}`;
}

export function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function deleteCookie(name = COOKIE_UID) {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

export function rememberUid(uid) {
  if (!uid) return;
  setCookie(COOKIE_UID, uid);
}

export function rememberedUid() {
  return getCookie(COOKIE_UID);
}

export function getPref(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {}
}

export function getSoundsEnabled() {
  return getPref(STORAGE_KEYS.sound, "1") === "1";
}

export function setSoundsEnabled(on) {
  setPref(STORAGE_KEYS.sound, on ? "1" : "0");
}

/* --------------------------- своё оформление ---------------------------- */

/**
 * CSS, который написал пользователь. Хранится строкой в localStorage:
 * это его собственный браузер, исполнять тут нечего, кроме стилей.
 */
export function getCustomCss() {
  return getPref(STORAGE_KEYS.css, "");
}

/**
 * Сохраняет css как есть, без обрезки: своего лимита у приложения нет.
 * Потолок один — квота localStorage в браузере (обычно ~5 МБ на сайт),
 * и о ней сообщаем вызывающему.
 */
export function setCustomCss(css) {
  const text = String(css || "");
  try {
    if (text.trim()) localStorage.setItem(STORAGE_KEYS.css, text);
    else localStorage.removeItem(STORAGE_KEYS.css);
  } catch {
    // Переполненное или запрещённое хранилище.
    const error = new Error("css-storage");
    error.size = text.length;
    throw error;
  }
  return text;
}

export function getPreferredMic() {
  return getPref(STORAGE_KEYS.mic, "") || "";
}

export function setPreferredMic(deviceId) {
  setPref(STORAGE_KEYS.mic, deviceId || "");
}

export function sanitizeNick(nick) {
  const clean = String(nick || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return clean.length >= 2 ? clean : "";
}

const ADJECTIVES = ["тихий", "быстрый", "синий", "ранний", "ласковый", "зоркий", "весёлый", "смелый"];
const NOUNS = ["модем", "пингвин", "кабель", "экран", "диск", "порт", "сигнал", "кит"];

export function suggestNick() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a} ${n} ${Math.floor(Math.random() * 90 + 10)}`;
}

const ROOM_CODE = APP.roomCode;

/**
 * Случайные индексы в алфавите.
 *
 * crypto.getRandomValues, а не Math.random: код комнаты — это фактически
 * приглашение, и предсказуемая последовательность тут ни к чему.
 * Отбраковка (rejection sampling) убирает перекос из-за остатка от деления.
 */
function randomIndexes(count, size) {
  const out = [];
  const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
  if (!cryptoObj?.getRandomValues || !Number.isInteger(size) || size < 2) {
    while (out.length < count) out.push(Math.floor(Math.random() * size));
    return out;
  }
  const limit = 256 - (256 % size);
  const buffer = new Uint8Array(count);
  while (out.length < count) {
    cryptoObj.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      out.push(byte % size);
      if (out.length === count) break;
    }
  }
  return out;
}

/** Новый код комнаты: буквы и цифры без похожих символов. */
export function randomRoomCode(length = ROOM_CODE.generateLength) {
  const alphabet = ROOM_CODE.alphabet;
  const size = Math.min(Math.max(length, ROOM_CODE.minLength), ROOM_CODE.maxLength);
  return randomIndexes(size, alphabet.length)
    .map((index) => alphabet[index])
    .join("");
}

/**
 * Приводит ввод к коду комнаты: убирает пробелы и мусор, поднимает регистр.
 *
 * Принимает и старые четырёхзначные коды, и новые — от 4 до 12 символов
 * из латиницы и цифр. Если после чистки длина не та, возвращает null.
 */
export function normalizeRoomCode(raw) {
  const code = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  // Длиннее предела — это не наш код, а не «обрежем и сойдёт»: иначе опечатка
  // в ссылке тихо приводила бы в чужую комнату.
  if (code.length < ROOM_CODE.minLength || code.length > ROOM_CODE.maxLength) return null;
  return code;
}

/** Код подходит для ссылки и адреса — той же проверкой, что и ручной ввод. */
export function isRoomCode(raw) {
  return normalizeRoomCode(raw) !== null;
}

export function initialOf(nick) {
  const clean = String(nick || "?").trim();
  return clean ? clean[0].toUpperCase() : "?";
}

const AVATAR_COLORS = ["#000080", "#006400", "#8b0000", "#4b0082", "#8b4513", "#006666", "#5c4033"];
export function colorFor(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function isSecureContextOk() {
  return (
    window.isSecureContext ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1"
  );
}
