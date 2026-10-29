import { t, getLang } from "./i18n.js";
import { APP } from "./config.js";
import { audioEngine } from "./audio.js";
import { $, el, svgUse, formatDuration, initials } from "./util.js";
import { colorFor } from "./store.js";

const LEVEL_SEGMENTS = 8;

/**
 * Всё, что происходит в окне звонка: плитки участников, индикаторы
 * речи, журнал, прогресс и статусная строка.
 */
export class CallView {
  constructor() {
    this.tilesEl = $("#callTiles");
    this.logEl = $("#callLog");
    this.progressEl = $("#callProgress");
    this.progressText = $("#callProgressText");
    this.statusEl = $("#callStatus");
    this.qualityEl = $("#callQuality");
    this.durationEl = $("#callDuration");
    this.codeEl = $("#callCode");
    this.titleEl = $("#callTitle");
    this.countEl = $("#callCount");
    this.micBtn = $("#btnMic");

    this.tiles = new Map();
    this.participants = {};
    this.peerStates = new Map();
    this.me = null;
    this.code = "";
    this.joinedAt = 0;
    this.timer = 0;
    this.raf = 0;
    this.lastLevelsAt = 0;
    this.muted = false;
    this.active = false;
    this.hideTimer = 0;
  }

  reset({ code, me }) {
    this.code = code;
    this.me = me;
    this.participants = { [me.uid]: { nick: me.nick, joinedAt: Date.now(), muted: false } };
    this.peerStates.clear();
    this.tilesEl.textContent = "";
    this.tiles.clear();
    this.logEl.textContent = "";
    this.codeEl.textContent = code;
    this.titleEl.textContent = t("call.title", { code });
    this.muted = false;
    this.joinedAt = 0;
    this.active = true;
    this.renderParticipants(this.participants);
    this.setMicState(false);
    clearTimeout(this.hideTimer);
    this.setProgress({ text: t("call.connecting"), indeterminate: true });
    this.progressEl.classList.remove("hidden");
    this.setStatus(t("call.status.connecting"));
    this.qualityEl.textContent = "0 / 0";
    this.durationEl.textContent = "00:00";
    this.startMeterLoop();
  }

  startTimer() {
    if (this.timer) return;
    this.joinedAt = Date.now();
    clearInterval(this.timer);
    this.durationEl.textContent = "00:00";
    this.timer = setInterval(() => {
      if (!this.joinedAt) return;
      this.durationEl.textContent = formatDuration(Date.now() - this.joinedAt);
    }, 1000);
  }

  stopTimer() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  stop() {
    this.active = false;
    this.stopTimer();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.progressDone = false;
    clearTimeout(this.hideTimer);
    this.tilesEl.textContent = "";
    this.tiles.clear();
    this.participants = {};
    this.peerStates.clear();
  }

  /* ----------------------------- прогресс ----------------------------- */

  setProgress({ text = "", key = null, params = {}, indeterminate = true, value = 0 } = {}) {
    const bar = this.progressEl.querySelector(".progress");
    const fill = this.progressEl.querySelector(".progress-fill");
    if (!bar) return;
    bar.classList.toggle("indeterminate", indeterminate);
    bar.classList.toggle("determinate", !indeterminate);
    if (!indeterminate) {
      fill.style.setProperty("--p", `${Math.max(0, Math.min(100, value))}%`);
    }
    if (key) this.progressText.textContent = t(key, params);
    else if (text) this.progressText.textContent = text;
  }

  finishProgress() {
    this.progressDone = true;
    this.setProgress({ text: t("call.progress.done"), indeterminate: false, value: 100 });
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.active) this.progressEl.classList.add("hidden");
    }, 900);
  }

  /**
   * Показывает полосу загрузки.
   *
   * После finishProgress() поздние события прогресса (например, «все
   * участники на связи», приходящее сразу после подключения) не должны
   * возвращать полосу на экран — иначе она висит до конца звонка.
   * Для нового участника полоса показывается заново: force = true.
   */
  showProgress(text, { force = false } = {}) {
    if (this.progressDone && !force) return;
    this.progressDone = false;
    clearTimeout(this.hideTimer);
    this.progressEl.classList.remove("hidden");
    this.setProgress({ text, indeterminate: true });
  }

  /* -------------------------------- журнал -------------------------------- */

  log(message, tone = "") {
    const row = el("div", { class: tone });
    const time = new Date().toLocaleTimeString(getLang() === "ru" ? "ru-RU" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    row.textContent = `[${time}] ${message}`;
    this.logEl.append(row);
    while (this.logEl.childElementCount > 120) this.logEl.firstElementChild.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /* ------------------------------- плитки ------------------------------- */

  ensureTile(uid, data = {}) {
    let tile = this.tiles.get(uid);
    if (tile) {
      if (data.nick && tile.name.textContent !== data.nick) tile.name.textContent = data.nick;
      return tile;
    }

    const self = uid === this.me?.uid;
    const nick = data.nick || (self ? this.me?.nick : "…");
    const root = el("div", { class: "tile", dataset: { uid, state: "connecting" } });

    const head = el("div", { class: "tile-head" });
    const avatar = el("div", { class: "avatar", text: initials(nick) });
    avatar.style.background = colorFor(uid);
    const name = el("span", { class: "tile-name", text: nick });
    head.append(avatar, name);
    if (self) head.append(el("span", { class: "tile-self", text: t("call.you") }));

    const body = el("div", { class: "tile-body" });
    const level = el("div", { class: "level" });
    const bars = [];
    for (let i = 0; i < LEVEL_SEGMENTS; i++) {
      const bar = el("i");
      level.append(bar);
      bars.push(bar);
    }
    const stateBox = el("div", { class: "tile-state" });
    body.append(level, stateBox);
    root.append(head, body);

    const conn = el("div", { class: "tile-conn", text: self ? "" : t("call.peer.connecting") });
    root.append(conn);

    this.tilesEl.append(root);
    tile = { root, name, avatar, level, bars, stateBox, conn, uid, self };
    this.tiles.set(uid, tile);
    return tile;
  }

  updateTile(uid) {
    const tile = this.tiles.get(uid);
    if (!tile) return;
    const self = tile.self;
    const participant = this.participants[uid];
    const peer = this.peerStates.get(uid);
    const muted = self ? this.muted : Boolean(participant?.muted);

    tile.level.classList.toggle("muted", muted);
    tile.stateBox.textContent = "";

    let stateText = "";
    if (muted) {
      tile.stateBox.append(svgUse("i-mic-off", "btn-ico"));
      stateText = t("call.peer.muted");
    } else if (!self) {
      const state = peer?.state || "connecting";
      stateText = t(
        state === "connected"
          ? "call.peer.connected"
          : state === "failed"
          ? "call.peer.failed"
          : state === "disconnected"
          ? "call.peer.disconnected"
          : "call.peer.connecting"
      );
    }
    if (stateText) tile.stateBox.append(el("span", { text: stateText }));

    if (self) {
      tile.conn.textContent = "";
      tile.root.dataset.state = "connected";
    } else {
      const state = peer?.state || "connecting";
      tile.root.dataset.state = state;
      tile.conn.textContent = t(
        state === "connected"
          ? "call.peer.connected"
          : state === "failed"
          ? "call.peer.failed"
          : state === "disconnected"
          ? "call.peer.disconnected"
          : "call.peer.connecting"
      );
    }
  }

  renderParticipants(participants) {
    if (!this.active || !this.me) return;
    this.participants = participants || {};
    const others = Object.values(this.participants).filter((p) => p && p.nick);
    const self = this.participants[this.me.uid] || { nick: this.me.nick, joinedAt: Date.now() };

    // порядок: я, затем по времени входа
    const ordered = [
      [this.me.uid, self],
      ...Object.entries(this.participants)
        .filter(([uid]) => uid !== this.me.uid)
        .sort((a, b) => (a[1]?.joinedAt || 0) - (b[1]?.joinedAt || 0)),
    ];

    const waiting = this.tilesEl.querySelector(".tile-waiting");
    if (waiting) waiting.remove();

    for (const [uid, data] of ordered) {
      this.ensureTile(uid, data);
    }
    for (const uid of Array.from(this.tiles.keys())) {
      if (!this.participants[uid]) {
        this.tiles.get(uid)?.root.remove();
        this.tiles.delete(uid);
      }
      this.updateTile(uid);
    }

    if (others.length === 0) {
      const waitingTile = el("div", { class: "tile tile-waiting" });
      waitingTile.append(el("b", { text: t("call.waiting") }));
      waitingTile.append(el("span", { text: t("call.waitingHint", { code: this.code }) }));
      const linkBtn = el("button", { type: "button", class: "btn btn-sm", text: t("call.waitingHintLink") });
      linkBtn.dataset.action = "copy-link";
      waitingTile.append(el("div", { class: "row" }, [linkBtn]));
      this.tilesEl.append(waitingTile);
    }

    this.tilesEl.dataset.count = String(Math.max(1, others.length + 1));
    if (this.othersCount === 0 && others.length > 0) {
      this.startTimer();
    }
    this.othersCount = others.length;
    this.updateCount();
    this.updateStatus();
  }

  updateCount() {
    const total = Object.keys(this.participants).length || 1;
    this.countEl.textContent = `${total} / ${APP.maxParticipants}`;
  }

  removePeerTile(uid) {
    const tile = this.tiles.get(uid);
    if (!tile) return;
    tile.root.remove();
    this.tiles.delete(uid);
    this.peerStates.delete(uid);
  }

  setPeerState(uid, info) {
    this.peerStates.set(uid, info);
    this.updateTile(uid);
    this.updateStatus();
  }

  setMicState(muted) {
    this.muted = muted;
    const use = this.micBtn?.querySelector("use");
    if (use) use.setAttribute("href", muted ? "#i-mic-off" : "#i-mic");
    this.micBtn?.classList.toggle("on", muted);
    if (this.me) this.updateTile(this.me.uid);
    this.updateStatus();
  }

  /* ------------------------------- статус ------------------------------- */

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  updateStatus() {
    if (!this.active) return;
    const peerCount = Object.keys(this.peerStates).length;
    const connected = Array.from(this.peerStates.values()).filter(
      (p) => p.state === "connected"
    ).length;
    const others = Math.max(0, Object.keys(this.participants).length - 1);
    this.qualityEl.textContent = `${connected} / ${others}`;

    if (!navigator.onLine) {
      this.statusEl.textContent = t("call.status.offline");
      return;
    }
    if (others === 0) {
      this.statusEl.textContent = t("call.status.solo");
      return;
    }
    if (connected >= others && peerCount >= others) {
      this.statusEl.textContent = t("call.status.ready", {
        n: connected + 1,
        max: APP.maxParticipants,
      });
    } else {
      this.statusEl.textContent = t("call.status.connecting");
    }
  }

  /* ------------------------------- уровни ------------------------------- */

  startMeterLoop() {
    if (this.raf) return;
    const tick = (time) => {
      this.raf = requestAnimationFrame(tick);
      if (!this.active) return;
      if (time - this.lastLevelsAt < 60) return;
      this.lastLevelsAt = time;
      for (const [uid, tile] of this.tiles) {
        if (!tile?.root?.isConnected) continue;
        const self = uid === this.me?.uid;
        if (self && this.muted) {
          tile.bars.forEach((b) => b.classList.remove("on"));
          tile.root.classList.remove("speaking");
          continue;
        }
        const level = audioEngine.readLevel(self ? "self" : `peer:${uid}`);
        const lit = Math.round(level * LEVEL_SEGMENTS);
        tile.bars.forEach((bar, index) => bar.classList.toggle("on", index < lit));
        tile.root.classList.toggle("speaking", level > 0.09);
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  /* -------------------------- смена языка и т.п. -------------------------- */

  refreshLabels() {
    if (!this.code) return;
    this.titleEl.textContent = t("call.title", { code: this.code });
    if (this.me) {
      const selfTile = this.tiles.get(this.me.uid);
      if (selfTile) {
        const you = selfTile.root.querySelector(".tile-self");
        if (you) you.textContent = t("call.you");
      }
    }
    const waiting = this.tilesEl.querySelector(".tile-waiting");
    if (waiting) {
      const parts = waiting.querySelectorAll("b, span");
      if (parts[0]) parts[0].textContent = t("call.waiting");
      if (parts[1]) parts[1].textContent = t("call.waitingHint", { code: this.code });
      const btn = waiting.querySelector("button");
      if (btn) btn.textContent = t("call.waitingHintLink");
    }
    for (const uid of this.tiles.keys()) this.updateTile(uid);
    this.updateStatus();
  }
}
