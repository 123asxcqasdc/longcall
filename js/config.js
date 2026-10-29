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
  version: "1.0.1",
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

// STUN бесплатный и без ключа. TURN нужен там, где NAT симметричный
// (часть мобильных сетей, корпоративные сети) — без него соединение
// между такими участниками не установится.
export const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
  // { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
];

export const STORAGE_KEYS = {
  lang: "lc.lang",
  sound: "lc.sound",
  mic: "lc.mic",
  profile: "lc.profile",
  volume: "lc.volume.",
};

export const COOKIE_UID = "lc_uid";
