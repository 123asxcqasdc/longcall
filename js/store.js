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

export function randomRoomCode() {
  // 4 цифры, первая не ноль — как «внутренний номер».
  const first = Math.floor(Math.random() * 9) + 1;
  const rest = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `${first}${rest}`;
}

export function normalizeRoomCode(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, APP.roomCodeLength);
  return digits.length === APP.roomCodeLength ? digits : null;
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
