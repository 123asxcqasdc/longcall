// Единственная точка, из которой собирается vendor/firebase.js.
// Бандл кладётся в репозиторий, чтобы сайт не зависел от внешнего CDN.
export { initializeApp } from 'firebase/app';
export {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
export {
  getDatabase,
  ref,
  child,
  set,
  get,
  update,
  remove,
  push,
  onValue,
  onChildAdded,
  onDisconnect,
  serverTimestamp,
  off,
  query,
  limitToLast,
  orderByChild,
  runTransaction,
  goOffline,
  goOnline,
} from 'firebase/database';
