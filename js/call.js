import {
  ref,
  get,
  runTransaction,
  update,
  remove,
  push,
  onValue,
  onChildAdded,
  onDisconnect,
} from "../vendor/firebase.js";
import { db } from "./firebase.js";
import { APP, ICE_SERVERS, ICE_RESTART_LIMIT } from "./config.js";
import { CallDiagnostics } from "./diagnostics.js";
import { AppError } from "./util.js";

/**
 * Одна комната = одна сессия.
 *
 * Топология — full mesh: каждый участник держит RTCPeerConnection с каждым.
 * Сигналинг — Firebase Realtime Database:
 *   rooms/{code}/meta                 {createdAt, createdBy, maxParticipants}
 *   rooms/{code}/participants/{uid}   {nick, joinedAt, muted}
 *   rooms/{code}/signals/{to}/{msgId} {from, type, ...}
 *
 * Роли: участник с меньшим uid — «невежливый» (impolite) в терминах
 * perfect negotiation, с большим — «вежливый» (polite). Это разводит
 * одновременные offer'ы без дополнительного обмена.
 */
export class CallSession {
  constructor({ code, me, audio, handlers = {}, iceServers = null, diagnostics = null }) {
    this.code = code;
    this.me = { uid: me.uid, nick: me.nick };
    this.audio = audio;
    this.h = handlers;
    // ICE-серверы с подписанными TURN-кредами и объект диагностики
    // приходят из main.js до создания сессии.
    this.options = { iceServers, diagnostics };

    this.peers = new Map();
    this.participants = {};
    this.unsubs = [];
    this.disconnectOps = [];
    this.closed = false;
    this.joined = false;
    this.joining = null;
    this.startedAt = 0;
    this.leavePromise = null;
  }

  /* ------------------------------- утилиты ------------------------------- */

  /** Набор ICE-серверов, полученный до создания сессии (см. js/turn.js). */
  get iceConfig() {
    return this.options?.iceServers || ICE_SERVERS;
  }

  /** Объект диагностики или null. */
  get diagnostics() {
    return this.options?.diagnostics || null;
  }

  log(text, tone = "") {
    this.h.onLog?.(text, tone);
  }

  progress(key, params = {}, value = null) {
    this.h.onProgress?.({ key, params, value });
  }

  onDisconnectOf(path) {
    return onDisconnect(ref(db, path));
  }

  /* --------------------------------- вход --------------------------------- */

  join() {
    if (!this.joining) this.joining = this.doJoin();
    return this.joining;
  }

  async doJoin() {
    const roomPath = `rooms/${this.code}`;
    const roomRef = ref(db, roomPath);
    this.progress("call.progress.join", { code: this.code }, 18);

    let snapshot;
    try {
      snapshot = await get(roomRef);
    } catch (err) {
      throw err?.code === "PERMISSION_DENIED" ? new AppError("rules") : new AppError("network");
    }

    if (!snapshot.exists()) {
      try {
        await runTransaction(roomRef, (current) => {
          if (current === null) {
            return {
              meta: {
                createdAt: Date.now(),
                createdBy: this.me.uid,
                maxParticipants: APP.maxParticipants,
                audioOnly: true,
              },
            };
          }
          return current;
        });
      } catch (err) {
        throw err?.code === "PERMISSION_DENIED" ? new AppError("rules") : new AppError("network");
      }
    } else {
      const value = snapshot.val();
      if (value?.closedAt) throw new AppError("room");
    }

    this.progress("call.progress.media", {}, 34);
    try {
      await this.audio.acquire();
    } catch (err) {
      this.audio.micBlocked = true;
      this.log(`microphone unavailable: ${err.message || err.name}`, "warn");
    }
    this.h.onSelfStream?.(this.audio.stream);

    /* --- атомарное подключение с проверкой лимита --- */
    const participantsRef = ref(db, `${roomPath}/participants`);
    let result;
    try {
      result = await runTransaction(participantsRef, (current) => {
        const participants = current || {};
        const others = Object.keys(participants).filter((uid) => uid !== this.me.uid);
        if (others.length >= APP.maxParticipants) return; // отмена транзакции
        const existing = participants[this.me.uid];
        return {
          ...participants,
          [this.me.uid]: {
            nick: this.me.nick,
            joinedAt: existing?.joinedAt || Date.now(),
            muted: this.audio.muted,
          },
        };
      });
    } catch (err) {
      throw err?.code === "PERMISSION_DENIED" ? new AppError("rules") : new AppError("network");
    }

    if (!result.committed) {
      throw new AppError("full", { max: APP.maxParticipants });
    }

    this.emitPeerProgress(true);

    /* --- присутствие: убираем себя при закрытии вкладки --- */
    const myParticipant = ref(db, `${roomPath}/participants/${this.me.uid}`);
    const myInbox = ref(db, `${roomPath}/signals/${this.me.uid}`);
    try {
      const partOff = this.onDisconnectOf(`${roomPath}/participants/${this.me.uid}`);
      const inboxOff = this.onDisconnectOf(`${roomPath}/signals/${this.me.uid}`);
      await partOff.remove();
      await inboxOff.remove();
      this.disconnectOps.push(partOff, inboxOff);
    } catch {
      /* не критично: соединение всё равно закроется, но запись останется */
    }

    /* --- подписки --- */
    this.unsubs.push(
      onValue(
        participantsRef,
        (snap) => this.handleParticipants(snap.val() || {}),
        () => this.h.onError?.(new AppError("network"))
      )
    );

    this.unsubs.push(
      onChildAdded(myInbox, (snap) => {
        const message = snap.val();
        remove(snap.ref).catch(() => {});
        this.handleSignal(message);
      })
    );

    this.unsubs.push(
      onValue(ref(db, `${roomPath}/meta`), (snap) => {
        if (!snap.exists() && this.joined && !this.closed) {
          this.log("room removed", "err");
          this.h.onRoomGone?.();
        }
      })
    );

    this.joined = true;
    this.startedAt = Date.now();
    this.h.onJoined?.({ code: this.code });
    this.log(`joined room ${this.code} as ${this.me.nick}`, "ok");
    return this;
  }

  otherParticipants() {
    return Object.keys(this.participants).filter((uid) => uid !== this.me.uid);
  }

  /* ----------------------------- участники ----------------------------- */

  handleParticipants(participants) {
    if (this.closed) return;
    const previous = this.participants;
    this.participants = participants;

    for (const uid of Object.keys(participants)) {
      if (uid === this.me.uid) continue;
      if (!this.peers.has(uid)) {
        this.ensurePeer(uid, participants[uid]?.nick);
      } else {
        const peer = this.peers.get(uid);
        if (participants[uid]?.nick) peer.nick = participants[uid].nick;
      }
    }

    for (const uid of Array.from(this.peers.keys())) {
      if (!participants[uid]) this.dropPeer(uid, true);
    }

    for (const uid of Object.keys(previous)) {
      if (!participants[uid] && uid !== this.me.uid) {
        const nick = previous[uid]?.nick || "…";
        this.log(`${nick} left`, "warn");
        this.h.onParticipantLeft?.(uid, nick);
      }
    }
    for (const uid of Object.keys(participants)) {
      if (!previous[uid] && uid !== this.me.uid) {
        this.log(`${participants[uid]?.nick || uid} joined`, "ok");
        this.h.onParticipantJoined?.(uid, participants[uid]?.nick);
      }
    }

    this.h.onParticipants?.(participants, this.peers);
    this.emitPeerProgress();
  }

  /** Прогресс «соединение с участниками» шлём только при реальном изменении. */
  emitPeerProgress(force = false) {
    const others = this.otherParticipants().length;
    const connected = this.connectedPeerCount();
    const signature = `${others}:${connected}`;
    if (!force && signature === this.progressSignature) return;
    this.progressSignature = signature;
    this.progress("call.progress.peers", { n: connected, total: others });
  }

  connectedPeerCount() {
    let n = 0;
    for (const peer of this.peers.values()) {
      if (peer.pc.connectionState === "connected") n += 1;
    }
    return n;
  }

  /* ------------------------------- пиры ------------------------------- */

  politeFor(uid) {
    // Меньший uid инициирует, больший уступает при столкновении offer'ов.
    return String(this.me.uid) > String(uid);
  }

  ensurePeer(uid, nick = "") {
    const existing = this.peers.get(uid);
    if (existing) {
      if (nick) existing.nick = nick;
      return existing;
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceConfig,
      // все типы кандидатов: host, srflx (STUN) и relay (TURN).
      // Прямой канал пробуем первым, ретранслятор — как запасной путь.
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
      bundlePolicy: "max-bundle",
    });

    const peer = {
      uid,
      nick: nick || uid.slice(0, 6),
      pc,
      polite: this.politeFor(uid),
      stream: null,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      restartTimer: null,
      iceCounts: { host: 0, srflx: 0, prflx: 0, relay: 0 },
      iceReported: false,
      restartCount: 0,
      pendingCandidates: [],
      state: "new",
    };
    this.peers.set(uid, peer);

    if (this.audio.stream) {
      for (const track of this.audio.stream.getAudioTracks()) {
        pc.addTrack(track, this.audio.stream);
      }
    } else {
      try {
        pc.addTransceiver("audio", { direction: "recvonly" });
      } catch {}
    }

    pc.addEventListener("track", (event) => {
      const [stream] = event.streams;
      const remote = stream || new MediaStream([event.track]);
      peer.stream = remote;
      this.audio.attachRemoteStream(uid, remote);
      this.h.onStream?.(uid, remote);
    });

    pc.addEventListener("icecandidate", (event) => {
      if (!event.candidate || this.closed) return;
      // Считаем типы кандидатов: relay означает, что TURN доступен и
      // звонок пройдёт даже через строгий NAT.
      const type = event.candidate.type || "host";
      peer.iceCounts[type] = (peer.iceCounts[type] || 0) + 1;
      this.diagnostics?.candidate(uid, type);
      this.sendSignal(uid, {
        type: "ice",
        candidate: event.candidate.toJSON(),
      }).catch(() => {});
    });

    pc.addEventListener("icegatheringstatechange", () => {
      this.diagnostics?.gathering(uid, pc.iceGatheringState);
      if (pc.iceGatheringState !== "complete" || this.closed) return;
      this.reportIce(peer);
    });

    pc.addEventListener("negotiationneeded", () => {
      if (this.closed) return;
      if (peer.polite && !pc.remoteDescription) return; // ждём инициатора
      this.negotiate(peer).catch((err) => this.log(`negotiate: ${err.message}`, "err"));
    });

    pc.addEventListener("connectionstatechange", () => {
      this.diagnostics?.connectionState(uid, pc.connectionState);
      this.updatePeerState(peer);
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      this.diagnostics?.iceState(uid, pc.iceConnectionState);
      if (pc.iceConnectionState === "failed") this.scheduleRestart(peer);
    });

    this.diagnostics?.peerCreated(uid, { polite: peer.polite, pc });

    this.log(`peer ${peer.nick}: ${peer.polite ? "polite" : "impolite"}`, "");
    this.h.onPeer?.(uid, this.peerInfo(peer));

    // Инициатор сразу готовит offer, чтобы не ждать случайного события.
    if (!peer.polite) {
      this.negotiate(peer).catch(() => {});
    }
    return peer;
  }

  /** Сохраняем в диагностику, какая пара реально выбрана (direct или relay). */
  async recordSelectedPair(peer) {
    const stats = await CallDiagnostics.readStats(peer.pc);
    if (!stats?.selected) return;
    peer.selectedPair = stats.selected;
    this.diagnostics?.setSelectedPair(peer.uid, stats.selected);
    const via = stats.selected.localType === "relay" || stats.selected.remoteType === "relay"
      ? "relay"
      : "direct";
    this.log(`канал: ${via} (${stats.selected.protocol || "?"})`, "");
    this.h.onChannel?.(peer.uid, { via, ...stats.selected });
  }

  /**
   * Пишет в журнал звонка, какие кандидаты удалось собрать.
   * Если relay = 0, значит TURN недоступен и звонок держится только на
   * прямом канале — при строгом NAT он не установится.
   */
  reportIce(peer, { failed = false } = {}) {
    if (peer.iceReported && !failed) return;
    peer.iceReported = true;
    const c = peer.iceCounts;
    const summary = `host ${c.host || 0} · srflx ${c.srflx || 0} · relay ${c.relay || 0}`;
    const noRelay = !c.relay;
    this.log(`ICE ${peer.nick}: ${summary}`, noRelay ? "warn" : "");

    if (failed && noRelay) {
      this.log("no relay candidates: TURN is unavailable", "err");
      this.h.onIceProblem?.({ peer: peer.nick, counts: { ...c } });
    }
  }

  peerInfo(peer) {
    return {
      uid: peer.uid,
      nick: peer.nick,
      state: peer.state,
      connectionState: peer.pc.connectionState,
      iceState: peer.pc.iceConnectionState,
      hasStream: Boolean(peer.stream),
    };
  }

  updatePeerState(peer) {
    const pc = peer.pc;
    let state = "connecting";
    if (pc.connectionState === "connected") state = "connected";
    else if (pc.connectionState === "failed") state = "failed";
    else if (pc.connectionState === "disconnected") state = "disconnected";
    else if (pc.connectionState === "closed") state = "closed";

    const changed = peer.state !== state;
    peer.state = state;
    this.h.onPeer?.(peer.uid, this.peerInfo(peer));

    if (state === "connected" && changed) {
      peer.restartCount = 0;
      clearTimeout(peer.restartTimer);
      this.log(`connected: ${peer.nick}`, "ok");
      this.recordSelectedPair(peer);
      this.h.onPeerConnected?.(peer.uid, peer.nick);
    }
    if (state === "failed") {
      this.log(`connection failed: ${peer.nick}`, "err");
      this.reportIce(peer, { failed: true });
      this.scheduleRestart(peer);
    }
    if (state === "disconnected") {
      clearTimeout(peer.restartTimer);
      peer.restartTimer = setTimeout(() => {
        if (peer.pc.connectionState !== "connected" && !this.closed) {
          this.log(`still disconnected: ${peer.nick}, restarting ICE`, "warn");
          this.restartPeer(peer);
        }
      }, 7000);
    }
    if (state === "connected") {
      this.emitPeerProgress();
    }
    this.h.onStateChange?.();
  }

  scheduleRestart(peer) {
    if (peer.restartCount >= ICE_RESTART_LIMIT || this.closed) return;
    clearTimeout(peer.restartTimer);
    peer.restartTimer = setTimeout(() => {
      if (this.closed) return;
      if (peer.pc.connectionState === "connected") return;
      this.restartPeer(peer);
    }, 1200 + peer.restartCount * 1500);
  }

  async restartPeer(peer) {
    peer.restartCount += 1;
    try {
      if (typeof peer.pc.restartIce === "function") peer.pc.restartIce();
      await this.negotiate(peer);
    } catch (err) {
      this.log(`restart failed: ${err.message}`, "err");
    }
  }

  async negotiate(peer) {
    const pc = peer.pc;
    if (this.closed || peer.makingOffer) return;
    if (pc.signalingState !== "stable") return;
    peer.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      if (pc.signalingState !== "stable") return;
      await pc.setLocalDescription(offer);
      await this.sendSignal(peer.uid, {
        type: "description",
        sdpType: pc.localDescription.type,
        sdp: pc.localDescription.sdp,
      });
    } catch (err) {
      this.log(`offer error: ${err.message}`, "err");
    } finally {
      peer.makingOffer = false;
    }
  }

  /* ----------------------------- сигналинг ----------------------------- */

  async sendSignal(toUid, payload) {
    if (this.closed || !toUid) return;
    try {
      await push(ref(db, `rooms/${this.code}/signals/${toUid}`), {
        ...payload,
        from: this.me.uid,
        at: Date.now(),
      });
    } catch {
      /* адресат мог уйти — молча игнорируем */
    }
  }

  async handleSignal(message) {
    if (!message || this.closed) return;
    const from = message.from;
    if (!from || from === this.me.uid) return;

    if (message.type === "bye") {
      this.dropPeer(from, false);
      return;
    }

    const peer = this.ensurePeer(from);
    const pc = peer.pc;

    try {
      if (message.type === "description") {
        const description = { type: message.sdpType, sdp: message.sdp };
        if (!description.sdp || !description.type) return;

        const readyForOffer =
          !peer.makingOffer &&
          (pc.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
        const offerCollision = description.type === "offer" && !readyForOffer;

        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        if (offerCollision && peer.polite) {
          try {
            await pc.setLocalDescription({ type: "rollback" });
          } catch {}
        }

        peer.isSettingRemoteAnswerPending = description.type === "answer";
        await pc.setRemoteDescription(description);
        peer.isSettingRemoteAnswerPending = false;

        while (peer.pendingCandidates.length) {
          const candidate = peer.pendingCandidates.shift();
          try {
            await pc.addIceCandidate(candidate);
          } catch {}
        }

        if (description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await this.sendSignal(from, {
            type: "description",
            sdpType: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          });
          this.updatePeerState(peer);
        }
      } else if (message.type === "ice") {
        if (!message.candidate) return;
        if (peer.ignoreOffer) return;
        if (!pc.remoteDescription) {
          peer.pendingCandidates.push(message.candidate);
          if (peer.pendingCandidates.length > 60) peer.pendingCandidates.shift();
          return;
        }
        try {
          await pc.addIceCandidate(message.candidate);
        } catch (err) {
          this.log(`ice: ${err.message}`, "warn");
        }
      }
    } catch (err) {
      this.log(`signal error: ${err.message}`, "err");
    }
  }

  /* ----------------------------- управление ----------------------------- */

  async setNick(nick) {
    const clean = String(nick || "").trim().slice(0, 24);
    if (!clean) return;
    this.me.nick = clean;
    try {
      await update(ref(db, `rooms/${this.code}/participants/${this.me.uid}`), { nick: clean });
    } catch {}
  }

  async setMuted(muted) {
    this.audio.setMuted(muted);
    try {
      await update(ref(db, `rooms/${this.code}/participants/${this.me.uid}`), {
        muted: Boolean(muted),
      });
    } catch {}
    return muted;
  }

  async switchMic(deviceId) {
    const stream = await this.audio.acquire(deviceId);
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    const wasMuted = this.audio.muted;
    track.enabled = !wasMuted;

    for (const peer of this.peers.values()) {
      const senders = peer.pc.getSenders().filter((s) => s.track?.kind === "audio");
      if (senders.length) {
        await Promise.all(
          senders.map((sender) => sender.replaceTrack(track).catch(() => {}))
        );
      } else {
        try {
          peer.pc.addTrack(track, stream);
        } catch {}
      }
    }
    this.h.onSelfStream?.(stream);
    return stream;
  }

  dropPeer(uid, notify = true) {
    const peer = this.peers.get(uid);
    if (!peer) return;
    clearTimeout(peer.restartTimer);
    try {
      peer.pc.onnegotiationneeded = null;
      peer.pc.close();
    } catch {}
    this.audio.detachRemoteStream(uid);
    this.peers.delete(uid);
    this.h.onPeerGone?.(uid);
    if (notify) remove(ref(db, `rooms/${this.code}/signals/${uid}`)).catch(() => {});
  }

  async leave() {
    if (this.leavePromise) return this.leavePromise;
    this.closed = true;
    this.leavePromise = (async () => {
      for (const unsub of this.unsubs.splice(0)) {
        try {
          unsub();
        } catch {}
      }
      for (const peer of this.peers.values()) {
        clearTimeout(peer.restartTimer);
        try {
          peer.pc.close();
        } catch {}
      }
      this.peers.clear();
      this.audio.detachAllRemote();

      for (const op of this.disconnectOps.splice(0)) {
        try {
          await op.cancel();
        } catch {}
      }

      const roomPath = `rooms/${this.code}`;
      try {
        await remove(ref(db, `${roomPath}/participants/${this.me.uid}`));
        await remove(ref(db, `${roomPath}/signals/${this.me.uid}`));
      } catch {}

      // Последний участник убирает комнату, чтобы не копить мусор.
      try {
        const snap = await get(ref(db, `${roomPath}/participants`));
        const remaining = snap.exists() ? Object.keys(snap.val()).length : 0;
        if (remaining === 0) {
          await remove(ref(db, roomPath));
        }
      } catch {}

      this.audio.stopLocal();
      this.h.onClosed?.();
    })();
    return this.leavePromise;
  }
}

export { APP };
