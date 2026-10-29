// Конфигурация проекта. Ключи Firebase публичны по своей природе:
// они лишь идентифицируют проект, доступ ограничивается правилами БД.
// Рекомендуется ограничить API-ключ по HTTP-referrer в Google Cloud Console.
export const firebaseConfig = {
  apiKey: "AIzaSyAvkVJPz7F_R6wnrgWEgVk5ncqSPnEPYxo",
  authDomain: "longcall.firebaseapp.com",
  databaseURL: "https://longcall-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "longcall",
  storageBucket: "longcall.firebasestorage.app",
  messagingSenderId: "814934416407",
  appId: "1:814934416407:web:470271da7f8bbed6241052",
  measurementId: "G-QLF4VCK240",
};

// Публичный адрес приложения. Ссылки на комнаты всегда собираются от него,
// даже когда страница открыта из настольного приложения по app://longcall —
// иначе в буфер обмена попадал бы внутренний адрес Electron, бесполезный
// для получателя.
export const SITE_URL = "https://123asxcqasdc.github.io/longcall/";

// Схема, по которой операционная система передаёт ссылку настольному
// приложению: longcall://join?room=1234
export const APP_SCHEME = "longcall";

export const APP = {
  name: "LongCall 98",
  version: "1.1.0",
  maxParticipants: 4,
  maxRecent: 12,
  roomCodeLength: 4,
  // Передача файлов в звонке. Файлы лежат в Realtime Database рядом с
  // комнатой (base64, кусками) и удаляются вместе с ней — отдельного
  // хранилища и его настройки CORS не нужно.
  files: {
    maxBytes: 8 * 1024 * 1024,
    maxFiles: 12,
    // 96 КБ в base64 — это ~128 КБ строки: заметно меньше лимита в 10 МБ
    // на одну запись и достаточно мелко, чтобы прогресс шёл плавно.
    chunkBytes: 96 * 1024,
  },
  // Звонки только звуковые: видео не запрашивается и не принимается.
  mediaConstraints: {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    video: false,
  },
};

// STUN бесплатный и без ключа: по нему браузер узнаёт свой публичный адрес.
// Несколько независимых серверов — чтобы падение одного не ломало звонок.
export const STUN_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:openrelay.metered.ca:80" },
];

// TURN — ретранслятор. Нужен там, где прямой канал невозможен: симметричный
// NAT, CGNAT мобильного оператора, корпоративный файрвол. Без него звонок
// между разными городами не устанавливается.
//
// Публичный статический логин openrelayproject/openrelayproject больше не
// работает: Metered его отключил. Сейчас используются временные подписанные
// креды их же схемы (см. js/turn.js) — аккаунт не нужен.
export const TURN_STATICAUTH = {
  host: "staticauth.openrelay.metered.ca",
  // Публичный секрет shared-secret схемы Open Relay, не путать с ключом
  // аккаунта Metered. Подпись считается в браузере через WebCrypto.
  secret: "openrelayprojectsecret",
  userPrefix: "longcall",
  ttlHours: 12,
};

// Запасные статические ретрансляторы (без подписи). Используются, если
// основная схема недоступна; часть сетей проходит и через них.
export const TURN_FALLBACK = [
  {
    urls: ["turn:freeturn.net:3478", "turn:freeturn.net:3478?transport=tcp"],
    username: "free",
    credential: "free",
  },
];

// Синхронный набор на случай, если подпись недоступна: STUN + запасной TURN.
// Основной путь — resolveIceServers() из js/turn.js.
export const ICE_SERVERS = [...STUN_SERVERS, ...TURN_FALLBACK];

// Сколько раз пробовать перезапуск ICE, прежде чем показать подсказку про сеть.
export const ICE_RESTART_LIMIT = 4;

// Ключи localStorage и cookie (используются store.js и i18n.js).
export const STORAGE_KEYS = {
  lang: "lc.lang",
  sound: "lc.sound",
  mic: "lc.mic",
  profile: "lc.profile",
  volume: "lc.volume.",
};

export const COOKIE_UID = "lc_uid";
