import { initializeApp } from "../vendor/firebase.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  updateProfile,
  browserLocalPersistence,
  setPersistence,
} from "../vendor/firebase.js";
import {
  getDatabase,
  ref,
  get,
  update,
  remove,
  onValue,
} from "../vendor/firebase.js";
import { firebaseConfig, APP } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

let persistenceReady = null;

export function ensurePersistence() {
  if (!persistenceReady) {
    persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});
  }
  return persistenceReady;
}

/**
 * Локальный аккаунт: Firebase-аноним лишь транспорт для сигналинга,
 * профиль (ник) хранится в браузере. Пароля нет, восстановления нет.
 */
export async function signInLocal(nick) {
  await ensurePersistence();
  let user = auth.currentUser;
  if (!user) {
    const cred = await signInAnonymously(auth);
    user = cred.user;
  }
  if (nick && user.displayName !== nick) {
    await updateProfile(user, { displayName: nick }).catch(() => {});
  }
  return user;
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signOutLocal() {
  await signOut(auth).catch(() => {});
}

export function watchConnection(cb) {
  const conn = ref(db, ".info/connected");
  return onValue(conn, (snap) => cb(snap.val() === true));
}

/* --------------------------- недавние звонки (облако) --------------------------- */

export function recentRef(uid) {
  return ref(db, `users/${uid}/recent`);
}

export function watchRecent(uid, cb) {
  return onValue(
    recentRef(uid),
    (snap) => cb(snap.val() || {}),
    (err) => cb({}, err)
  );
}

export async function touchRecent(uid, code, extra = {}) {
  try {
    await update(ref(db, `users/${uid}/recent/${code}`), {
      code,
      lastAt: Date.now(),
      ...extra,
    });
  } catch {
    /* история не критична для звонка */
  }
}

export async function removeRecent(uid, code) {
  await remove(ref(db, `users/${uid}/recent/${code}`));
}

export async function saveUserProfile(uid, nick) {
  try {
    await update(ref(db, `users/${uid}/profile`), { nick, updatedAt: Date.now() });
  } catch {}
}

export async function roomSnapshot(code) {
  try {
    const snap = await get(ref(db, `rooms/${code}`));
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    return { error: err };
  }
}

export { APP };
