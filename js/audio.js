import { APP } from "./config.js";
import { AppError } from "./util.js";
import { getSoundsEnabled, isSecureContextOk } from "./store.js";

const SOUNDS = {
  boot: [
    { f: 523.25, t: 0, d: 0.14, type: "triangle" },
    { f: 659.25, t: 0.15, d: 0.14, type: "triangle" },
    { f: 783.99, t: 0.3, d: 0.16, type: "triangle" },
    { f: 1046.5, t: 0.47, d: 0.5, type: "triangle" },
  ],
  join: [
    { f: 660, t: 0, d: 0.08, type: "square" },
    { f: 880, t: 0.1, d: 0.12, type: "square" },
  ],
  leave: [
    { f: 660, t: 0, d: 0.08, type: "square" },
    { f: 440, t: 0.1, d: 0.16, type: "square" },
  ],
  error: [
    { f: 220, t: 0, d: 0.14, type: "sawtooth" },
    { f: 165, t: 0.16, d: 0.2, type: "sawtooth" },
  ],
  toggle: [{ f: 1100, t: 0, d: 0.04, type: "square" }],
  message: [
    { f: 1000, t: 0, d: 0.06, type: "triangle" },
    { f: 1300, t: 0.08, d: 0.07, type: "triangle" },
  ],
};

function mapGetUserMediaError(err) {
  if (!err) return new AppError("mic");
  if (err.name === "NotAllowedError" || err.name === "SecurityError") return new AppError("mic");
  if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") return new AppError("mic.none");
  if (err.name === "OverconstrainedError") return new AppError("mic.none");
  if (err.name === "NotReadableError") return new AppError("mic");
  return err;
}

/**
 * Всё, что связано со звуком: микрофон, удалённые потоки, индикаторы
 * уровня и синтезированные «системные» звуки (без внешних файлов).
 */
export class AudioEngine {
  constructor() {
    this.stream = null;
    this.deviceId = "";
    this.ctx = null;
    this.meters = new Map();
    this.remoteEls = new Map();
    this.sinkRoot = document.body;
    this.unlocked = false;
  }

  get supported() {
    return Boolean(
      navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia &&
        window.RTCPeerConnection
    );
  }

  assertSupported() {
    if (!this.supported) throw new AppError("unsupported");
    if (!isSecureContextOk()) throw new AppError("insecure");
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try {
        this.ctx = new Ctx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {}
    }
    return this.ctx;
  }

  /** Разблокировка звука по первому жесту пользователя (требование браузеров). */
  async unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    await this.ensureContext();
    for (const el of this.remoteEls.values()) {
      el.play?.().catch(() => {});
    }
  }

  async listInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === "audioinput");
    } catch {
      return [];
    }
  }

  /** Запрос микрофона. Повторный вызов меняет устройство. */
  async acquire(deviceId = this.deviceId) {
    this.assertSupported();
    const baseAudio = { ...APP.mediaConstraints.audio };
    let stream = null;
    let usedId = deviceId;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...baseAudio, deviceId: { exact: deviceId } } : baseAudio,
        video: false,
      });
    } catch (err) {
      if (
        deviceId &&
        (err.name === "OverconstrainedError" ||
          err.name === "NotFoundError" ||
          err.name === "DevicesNotFoundError")
      ) {
        usedId = "";
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: baseAudio,
            video: false,
          });
        } catch (err2) {
          throw mapGetUserMediaError(err2);
        }
      } else {
        throw mapGetUserMediaError(err);
      }
    }

    this.stopLocal();
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    this.deviceId = track?.getSettings?.().deviceId || usedId || "";
    if (track) {
      track.addEventListener("ended", () => {
        if (this.stream === stream) this.stream = null;
      });
    }
    await this.ensureContext();
    this.ensureMeter("self", stream);
    return stream;
  }

  stopLocal() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.dropMeter("self");
  }

  get track() {
    return this.stream ? this.stream.getAudioTracks()[0] || null : null;
  }

  setMuted(muted) {
    const track = this.track;
    if (track) track.enabled = !muted;
    return Boolean(track);
  }

  get muted() {
    const track = this.track;
    return track ? !track.enabled : true;
  }

  /* ------------------------------- индикаторы уровня ------------------------------- */

  ensureMeter(key, stream) {
    if (!this.ctx || !stream) return null;
    this.dropMeter(key);
    try {
      const source = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      const silent = this.ctx.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(this.ctx.destination);
      this.meters.set(key, {
        source,
        analyser,
        silent,
        buffer: new Float32Array(analyser.fftSize),
        value: 0,
      });
      return analyser;
    } catch {
      return null;
    }
  }

  dropMeter(key) {
    const meter = this.meters.get(key);
    if (!meter) return;
    try {
      meter.source.disconnect();
      meter.analyser.disconnect();
      meter.silent.disconnect();
    } catch {}
    this.meters.delete(key);
  }

  /** RMS 0…1 (с усилением для наглядности). */
  readLevel(key) {
    const meter = this.meters.get(key);
    if (!meter) return 0;
    meter.analyser.getFloatTimeDomainData(meter.buffer);
    let sum = 0;
    for (let i = 0; i < meter.buffer.length; i++) sum += meter.buffer[i] * meter.buffer[i];
    const rms = Math.sqrt(sum / meter.buffer.length);
    const scaled = Math.min(1, rms * 6.5);
    meter.value = meter.value * 0.55 + scaled * 0.45;
    return meter.value;
  }

  /* --------------------------------- удалённый звук -------------------------------- */

  attachRemoteStream(uid, stream) {
    let el = this.remoteEls.get(uid);
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.playsInline = true;
      el.dataset.peer = uid;
      el.className = "hidden";
      this.sinkRoot.append(el);
      this.remoteEls.set(uid, el);
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    el.play?.().catch(() => {});
    this.ensureMeter(`peer:${uid}`, stream);
  }

  detachRemoteStream(uid) {
    const el = this.remoteEls.get(uid);
    if (el) {
      try {
        el.pause();
        el.srcObject = null;
      } catch {}
      el.remove();
      this.remoteEls.delete(uid);
    }
    this.dropMeter(`peer:${uid}`);
  }

  detachAllRemote() {
    Array.from(this.remoteEls.keys()).forEach((uid) => this.detachRemoteStream(uid));
  }

  /* -------------------------------- системные звуки -------------------------------- */

  async playSound(name) {
    if (!getSoundsEnabled()) return;
    const notes = SOUNDS[name];
    if (!notes) return;
    const ctx = await this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + 0.02;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type || "square";
      osc.frequency.setValueAtTime(note.f, now + note.t);
      const start = now + note.t;
      const end = start + note.d;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.055, start + Math.min(0.012, note.d / 3));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }
}

export const audioEngine = new AudioEngine();
