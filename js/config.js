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
  version: "1.0.2",
  maxParticipants: 4,
  maxRecent: 12,
  roomCodeLength: 4,
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
// между разными городами часто не устанавливается вообще.
//
// Используем публичный бесплатный Open Relay Project (Metered): 20 ГБ
// ретрансляции в месяц, регистрация не нужна, работает на 80/443, включая
// TCP и TLS — это важно, потому что многие сети пропускают только 443/TCP.
// Документация и свои ключи: https://www.metered.ca/tools/openrelay/
//
// Если понадобится свой сервер, сюда же добавляется ещё один объект:
//   { urls: ["turn:МОЙ.СЕРВЕР:3478", "turns:МОЙ.СЕРВЕР:5349?transport=tcp"],
//     username: "…", credential: "…" }
// TURN-серверы перечисляются от лучшего к запасному: браузер сам выберет
// тот, который ответит.
export const TURN_SERVERS = [
  // порт 80: проходит почти везде
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:80?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  // 443/TCP и TLS: для сетей, где разрешён только HTTPS
  {
    urls: [
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
      "turns:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export const ICE_SERVERS = [...STUN_SERVERS, ...TURN_SERVERS];

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
