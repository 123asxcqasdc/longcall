// Диагностика звонков: собираем подробный отчёт и отправляем в Firebase.
//
// Зачем: когда звонок не устанавливается, по одному «не удалось соединиться»
// ничего не понять. Отчёт содержит версию, платформу, таймлайн ICE,
// типы собранных кандидатов, ошибки getUserMedia и результат getStats() —
// в том числе то, какая пара реально выбрана: прямой канал или ретранслятор.
//
// Приватность: пароли TURN, ник и uid в отчёт не попадают (uid хешируется),
// SDP и IP-адреса кандидатов не сохраняются — только типы и счётчики.

import { ref, push, set, serverTimestamp } from "../vendor/firebase.js";
import { db } from "./firebase.js";
import { APP } from "./config.js";
import { describeIceServers } from "./turn.js";

const MAX_EVENTS = 120;

/** Короткий необратимый идентификатор — чтобы отличать устройства, не храня uid. */
async function hashId(value) {
  const text = String(value || "anon");
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest).slice(0, 6))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* нет WebCrypto — обойдёмся без хеша */
  }
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16).slice(0, 8);
}

function envInfo() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const ua = String(nav.userAgent || "");
  const electron = /Electron\/([\d.]+)/.exec(ua);
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  const firefox = /Firefox\/([\d.]+)/.exec(ua);
  const safari = /Version\/([\d.]+).*Safari/.exec(ua);

  let platform = "web";
  if (electron) platform = "electron";

  return {
    platform,
    os: nav.platform || "",
    appVersion: APP.version,
    electron: electron ? electron[1] : "",
    chrome: chrome ? chrome[1] : "",
    firefox: firefox ? firefox[1] : "",
    safari: safari ? safari[1] : "",
    userAgent: ua.slice(0, 220),
    language: nav.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "",
    online: typeof navigator !== "undefined" ? navigator.onLine : null,
  };
}

export class CallDiagnostics {
  constructor({ code, uid, nick, ice = null } = {}) {
    this.code = code || "";
    this.uid = uid || "";
    this.startedAt = Date.now();
    this.startedIso = new Date(this.startedAt).toISOString();
    this.events = [];
    this.peers = new Map();
    this.ice = ice; // { servers, turn, reason }
    this.media = null;
    this.errors = [];
    this.sent = null;
  }

  /** Событие с отметкой времени от начала звонка. */
  record(kind, data = {}) {
    const at = Date.now() - this.startedAt;
    this.events.push({ t: at, kind, ...data });
    if (this.events.length > MAX_EVENTS) this.events.shift();
    return this;
  }

  error(where, error) {
    const message = error?.message || String(error || "unknown");
    this.errors.push({ at: Date.now() - this.startedAt, where, message: message.slice(0, 300) });
    return this.record("error", { where, message: message.slice(0, 300) });
  }

  setMedia(info) {
    this.media = info;
    return this.record("media", info);
  }

  /** Начальные данные о пире и полный набор ICE-серверов (без паролей). */
  peerCreated(uid, info = {}) {
    const key = String(uid);
    if (!this.peers.has(key)) {
      this.peers.set(key, {
        pc: info.pc || null,
        polite: Boolean(info.polite),
        createdAt: Date.now() - this.startedAt,
        candidates: { host: 0, srflx: 0, prflx: 0, relay: 0 },
        gatheringStates: [],
        iceStates: [],
        connectionStates: [],
        firstCandidateAt: null,
        selectedPair: null,
      });
    }
    return this.record("peer", { polite: Boolean(info.polite) });
  }

  candidate(uid, type) {
    const peer = this.peers.get(String(uid));
    if (!peer) return this;
    peer.candidates[type] = (peer.candidates[type] || 0) + 1;
    if (peer.firstCandidateAt === null) peer.firstCandidateAt = Date.now() - this.startedAt;
    return this;
  }

  gathering(uid, state) {
    const peer = this.peers.get(String(uid));
    if (!peer) return this;
    peer.gatheringStates.push(state);
    return this.record("gathering", { state });
  }

  iceState(uid, state) {
    const peer = this.peers.get(String(uid));
    if (!peer) return this;
    peer.iceStates.push(state);
    return this.record("ice", { state });
  }

  connectionState(uid, state) {
    const peer = this.peers.get(String(uid));
    if (!peer) return this;
    peer.connectionStates.push(state);
    return this.record("connection", { state });
  }

  /** Что реально выбрал ICE: direct (host/srflx) или relay. */
  setSelectedPair(uid, info) {
    const peer = this.peers.get(String(uid));
    if (!peer) return this;
    peer.selectedPair = info;
    return this.record("selected-pair", info);
  }

  /**
   * Снимок getStats(): какие пары есть и какая выбрана.
   * Возвращает объект для отчёта, ничего не отправляя.
   */
  static async readStats(pc) {
    if (!pc || typeof pc.getStats !== "function") return null;
    try {
      const report = await pc.getStats();
      let selected = null;
      const pairs = [];
      const candidates = new Map();

      report.forEach((stat) => {
        if (stat.type === "local-candidate" || stat.type === "remote-candidate") {
          candidates.set(stat.id, {
            type: stat.candidateType || "unknown",
            protocol: stat.protocol || "",
          });
        }
      });

      report.forEach((stat) => {
        if (stat.type !== "candidate-pair") return;
        const local = candidates.get(stat.localCandidateId) || {};
        const remote = candidates.get(stat.remoteCandidateId) || {};
        const pair = {
          state: stat.state || "",
          localType: local.type || "",
          remoteType: remote.type || "",
          protocol: local.protocol || remote.protocol || "",
          nominated: Boolean(stat.nominated),
        };
        pairs.push(pair);
        if (stat.selected || stat.nominated) selected = pair;
      });

      return { selected, pairs: pairs.slice(0, 12), total: pairs.length };
    } catch {
      return null;
    }
  }

  /** Собирает отчёт. */
  async snapshot() {
    const peerList = [];
    for (const [uid, peer] of this.peers) {
      const stats = await CallDiagnostics.readStats(peer.pc);
      peerList.push({
        peer: await hashId(uid),
        polite: peer.polite,
        candidates: peer.candidates,
        firstCandidateMs: peer.firstCandidateAt,
        gathering: peer.gatheringStates.slice(-4),
        ice: peer.iceStates.slice(-6),
        connection: peer.connectionStates.slice(-6),
        selectedPair: stats?.selected || peer.selectedPair || null,
        pairs: stats?.pairs || [],
      });
    }

    return {
      v: APP.version,
      createdAt: serverTimestamp(),
      startedAt: this.startedIso,
      durationMs: Date.now() - this.startedAt,
      code: this.code,
      device: await hashId(`${this.uid}:${globalThis.navigator?.userAgent || ""}`),
      env: envInfo(),
      ice: {
        turn: this.ice?.turn || "unknown",
        reason: this.ice?.reason || null,
        servers: describeIceServers(this.ice?.servers || []),
      },
      media: this.media,
      peers: peerList,
      errors: this.errors.slice(0, 20),
      events: this.events.slice(-MAX_EVENTS),
    };
  }

  /**
   * Отправляет отчёт в базу.
   *
   * Основной путь — logs/{room}/{pushId}: его удобно смотреть в консоли
   * Firebase по одной комнате. Если правила не разрешают запись, кладём
   * в users/{uid}/diagnostics/{pushId} — этот путь разрешён текущими
   * правилами и доступен владельцу аккаунта.
   *
   * @returns {Promise<{ok: boolean, id: string|null, path: string|null, error: string|null}>}
   */
  async send({ manual = false } = {}) {
    if (this.sent?.ok) return this.sent;

    const payload = await this.snapshot();
    payload.manual = Boolean(manual);

    const attempts = [
      this.code ? `logs/${this.code}` : null,
      this.uid ? `users/${this.uid}/diagnostics` : null,
    ].filter(Boolean);

    let lastError = null;
    for (const path of attempts) {
      try {
        const node = push(ref(db, path));
        await set(node, payload);
        this.sent = { ok: true, id: node.key || null, path, error: null };
        return this.sent;
      } catch (err) {
        lastError = err?.message || String(err);
      }
    }

    this.sent = { ok: false, id: null, path: null, error: lastError || "unknown" };
    return this.sent;
  }
}
