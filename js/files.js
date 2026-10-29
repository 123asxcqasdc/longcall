import { ref, get, set, remove, push, onValue } from "../vendor/firebase.js";
import { db } from "./firebase.js";
import { APP } from "./config.js";
import { AppError } from "./util.js";
import { getLang } from "./i18n.js";

/**
 * Передача файлов прямо в звонке.
 *
 * Хранилище — та же Realtime Database, что и сигналинг, поэтому ничего
 * дополнительно включать в консоли не нужно (Storage потребовал бы CORS
 * и отдельного деплоя). Файл режется на части и кодируется в base64:
 *
 *   rooms/{code}/fileparts/{fileId}/{part}   "…base64…"
 *   rooms/{code}/files/{fileId}              {name, size, type, from, nick, at, parts}
 *
 * Метаданные пишутся последними — получатель видит файл только целиком.
 * Всё лежит внутри комнаты, поэтому последний ушедший участник удаляет
 * комнату вместе с файлами (см. CallSession.leave).
 *
 * Ограничения: не больше APP.files.maxBytes на файл, APP.files.maxFiles
 * файлов на комнату и одна загрузка за раз.
 */

const FILES = APP.files;

// Что открывается во встроенном просмотрщике. Списки — на случай пустого
// MIME: браузеры часто не знают тип по расширению.
const VIDEO_EXT = ["mp4", "m4v", "webm", "ogv", "mov"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"];
const TEXT_EXT = ["txt", "md", "log", "json", "csv", "tsv", "ini", "conf", "yml", "yaml", "srt"];

// Больше этого в окно просмотра не выводим: DOM на несколько мегабайт
// текста подвешивает вкладку, а читать такое всё равно невозможно.
const TEXT_PREVIEW_LIMIT = 100 * 1024;

/* ------------------------------- base64 -------------------------------- */

function bytesToBase64(bytes) {
  let binary = "";
  // Кусок 0x8000 символов — String.fromCharCode не любит очень длинные списки.
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Текст без TextDecoder (его нет в старых движках и в jsdom): собираем
 * строку вручную. Каждая последовательность проверяется по длине и по
 * continuation-байтам, битые места заменяются на U+FFFD — иначе «FF FE»
 * съедало бы соседние символы и давало мусорные суррогаты.
 */
function decodeUtf8(bytes) {
  if (typeof TextDecoder === "function") {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {}
  }
  const out = [];
  const chunks = [];
  const push = (code) => {
    chunks.push(String.fromCharCode(code));
    if (chunks.length >= 8192) {
      out.push(chunks.join(""));
      chunks.length = 0;
    }
  };
  const cont = (index) => {
    const byte = bytes[index];
    return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
  };

  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      push(b0);
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf && cont(i + 1)) {
      push(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef && cont(i + 1) && cont(i + 2)) {
      const cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      // Перечёркиваем overlong-формы и суррогаты: их в UTF-8 быть не может.
      push(cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff) ? 0xfffd : cp);
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4 && cont(i + 1) && cont(i + 2) && cont(i + 3)) {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      if (cp < 0x10000 || cp > 0x10ffff) {
        push(0xfffd);
      } else {
        const offset = cp - 0x10000;
        push(0xd800 + (offset >> 10));
        push(0xdc00 + (offset & 0x3ff));
      }
      i += 4;
    } else {
      push(0xfffd);
      i += 1;
    }
  }
  out.push(chunks.join(""));
  return out.join("");
}

/**
 * Текст из байтов с разумным выбором кодировки. Блокнот Windows 9x
 * сохранял .txt в Windows-1251, и такой файл в UTF-8 выглядел бы
 * «ромашками». Если UTF-8 даёт много замен, пробуем cp1251.
 */
export function decodeText(bytes) {
  const utf8 = decodeUtf8(bytes);
  if (!bytes.length) return { text: "", encoding: "utf-8" };

  let broken = 0;
  for (let i = 0; i < utf8.length; i += 1) if (utf8.charCodeAt(i) === 0xfffd) broken += 1;
  if (broken === 0 || broken / utf8.length < 0.02) return { text: utf8, encoding: "utf-8" };

  if (typeof TextDecoder === "function") {
    for (const label of ["windows-1251", "windows-1252"]) {
      try {
        const cyrillic = new TextDecoder(label).decode(bytes);
        let cyr = 0;
        for (const ch of cyrillic) if (ch >= "\u0400" && ch <= "\u04ff") cyr += 1;
        if (cyrillic && (label === "windows-1251" ? cyr > 0 : true)) {
          return { text: cyrillic, encoding: label };
        }
      } catch {}
    }
  }
  return { text: utf8, encoding: "utf-8" };
}

/** Расширение в нижнем регистре, без точки: "song.MP3" → "mp3". */
export function fileExt(name) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(String(name || "").trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Что можно показать прямо в приложении: видео, звук или текст.
 * Сначала смотрим MIME, потом расширение — браузеры часто отдают
 * пустой type для mp4 с нестандартным именем.
 */
export function previewKind(entry) {
  const type = String(entry?.type || "").toLowerCase();
  const ext = fileExt(entry?.name);

  if (type.startsWith("video/") || VIDEO_EXT.includes(ext)) return "video";
  if (type.startsWith("audio/") || AUDIO_EXT.includes(ext)) return "audio";
  if (type.startsWith("text/") || TEXT_EXT.includes(ext)) return "text";
  return null;
}

/* ------------------------------ утилиты -------------------------------- */

/** Размер в человеческом виде: 512 Б, 12,4 КБ, 3,1 МБ. */
export function formatSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  const ru = getLang() === "ru";
  if (size < 1024) return `${size} ${ru ? "Б" : "B"}`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} ${ru ? "КБ" : "KB"}`;
  return `${(size / (1024 * 1024)).toFixed(1)} ${ru ? "МБ" : "MB"}`;
}

/** Имя без пути и управляющих символов — оно попадает в атрибут download. */
export function cleanFileName(raw) {
  const name = String(raw || "")
    .replace(/[\\/]+/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "_")
    .trim()
    .slice(0, 96);
  return name || "file";
}

/* ------------------------------- класс -------------------------------- */

export class RoomFiles {
  constructor({ code, me, onList = null, onNew = null, onError = null, diagnostics = null }) {
    this.code = code;
    this.me = { uid: me.uid, nick: me.nick };
    this.onList = onList;
    this.onNew = onNew;
    this.onError = onError;
    this.diagnostics = diagnostics;

    this.files = {};
    this.known = new Set();
    this.first = true;
    this.busy = false;
    this.cancelRequested = false;
    this.unsub = null;
    this.closed = false;
  }

  get path() {
    return `rooms/${this.code}/files`;
  }

  partsPath(id) {
    return `rooms/${this.code}/fileparts/${id}`;
  }

  get limit() {
    return FILES;
  }

  /* ------------------------------ подписка ------------------------------ */

  watch() {
    if (this.unsub) return;
    this.unsub = onValue(
      ref(db, this.path),
      (snap) => this.handleList(snap.val() || {}),
      (err) => {
        this.diagnostics?.record("files.watch", { error: err?.message || "denied" });
        this.onError?.(new AppError("filesDenied"));
      }
    );
  }

  stop() {
    this.closed = true;
    this.cancelRequested = true;
    try {
      this.unsub?.();
    } catch {}
    this.unsub = null;
  }

  handleList(value) {
    if (this.closed) return;
    const previous = this.known;
    this.files = value && typeof value === "object" ? value : {};
    const list = this.list();

    if (!this.first) {
      for (const entry of list) {
        if (previous.has(entry.id)) continue;
        if (entry.from === this.me.uid) continue;
        this.onNew?.(entry);
      }
    }
    this.known = new Set(list.map((entry) => entry.id));
    this.first = false;
    this.onList?.(list);
  }

  /** Список файлов комнаты, старые сверху. */
  list() {
    return Object.entries(this.files || {})
      .filter(([, data]) => data && typeof data === "object" && data.name)
      .map(([id, data]) => ({
        id,
        name: String(data.name),
        size: Number(data.size) || 0,
        type: String(data.type || "application/octet-stream"),
        from: String(data.from || ""),
        nick: String(data.nick || ""),
        at: Number(data.at) || 0,
        parts: Math.max(0, Number(data.parts) || 0),
      }))
      .sort((a, b) => a.at - b.at);
  }

  get listCount() {
    return this.list().length;
  }

  /* ------------------------------- отправка ------------------------------ */

  canSend(file) {
    if (!file) return new AppError("fileEmpty");
    if (this.busy) return new AppError("fileBusy");
    const size = Number(file.size) || 0;
    if (!size) return new AppError("fileEmpty");
    if (size > FILES.maxBytes) {
      return new AppError("fileBig", { max: formatSize(FILES.maxBytes) });
    }
    if (this.listCount >= FILES.maxFiles) {
      return new AppError("fileLimit", { max: FILES.maxFiles });
    }
    return null;
  }

  cancel() {
    if (this.busy) this.cancelRequested = true;
  }

  /**
   * Отправляет один файл. Возвращает {id, name, size}.
   * onProgress({sent, total, part, parts}) вызывается после каждой части.
   */
  async send(file, { onProgress = null } = {}) {
    const problem = this.canSend(file);
    if (problem) throw problem;

    const size = Number(file.size) || 0;
    const name = cleanFileName(file.name);
    const total = Math.max(1, Math.ceil(size / FILES.chunkBytes));
    const id = push(ref(db, this.path)).key || `f${Date.now().toString(36)}`;

    this.busy = true;
    this.cancelRequested = false;
    let written = 0;
    const startedAt = Date.now();

    try {
      for (let index = 0; index < total; index += 1) {
        if (this.cancelRequested || this.closed) throw new AppError("fileCancelled");
        const slice = file.slice(index * FILES.chunkBytes, (index + 1) * FILES.chunkBytes);
        // arrayBuffer(), а не FileReader: работает и в браузере, и в обёртке.
        const bytes = new Uint8Array(await slice.arrayBuffer());
        if (!bytes.length) break;
        await set(ref(db, `${this.partsPath(id)}/${index}`), bytesToBase64(bytes));
        written = index + 1;
        onProgress?.({
          sent: Math.min(size, written * FILES.chunkBytes),
          total: size,
          part: written,
          parts: total,
        });
      }

      // Метаданные последними: пока их нет, файла для остальных не существует.
      await set(ref(db, `${this.path}/${id}`), {
        name,
        size,
        type: String(file.type || "application/octet-stream").slice(0, 120),
        from: this.me.uid,
        nick: this.me.nick,
        at: Date.now(),
        parts: written,
      });

      this.diagnostics?.record("files.sent", {
        size,
        parts: written,
        ms: Date.now() - startedAt,
      });
      return { id, name, size };
    } catch (err) {
      await this.cleanup(id);
      if (err instanceof AppError) throw err;
      // PERMISSION_DENIED и обрывы сети приводим к понятному тексту.
      throw new AppError(err?.code === "PERMISSION_DENIED" ? "filesRules" : "fileFailed", {
        msg: err?.message || "",
      });
    } finally {
      this.busy = false;
      this.cancelRequested = false;
    }
  }

  async cleanup(id) {
    try {
      await remove(ref(db, this.partsPath(id)));
    } catch {}
    try {
      await remove(ref(db, `${this.path}/${id}`));
    } catch {}
  }

  /* ------------------------------- загрузка ------------------------------ */

  /** Собирает файл из частей в Blob. Общая часть скачивания и просмотра. */
  async read(entry) {
    if (!entry?.id) throw new AppError("fileFailed", { msg: "no id" });
    let snap;
    try {
      snap = await get(ref(db, this.partsPath(entry.id)));
    } catch (err) {
      throw new AppError(err?.code === "PERMISSION_DENIED" ? "filesRules" : "fileFailed", {
        msg: err?.message || "",
      });
    }
    const parts = snap.val() || {};
    const chunks = [];
    const count = entry.parts || Object.keys(parts).length;
    for (let index = 0; index < count; index += 1) {
      const chunk = parts[index];
      if (typeof chunk !== "string") throw new AppError("fileBroken");
      chunks.push(base64ToBytes(chunk));
    }
    if (!chunks.length) throw new AppError("fileBroken");
    return new Blob(chunks, { type: entry.type || "application/octet-stream" });
  }

  /**
   * Данные для окна просмотра: видео и звук отдаём как blob-URL,
   * текст — строкой (первые TEXT_PREVIEW_LIMIT байт).
   * dispose() освобождает URL, его обязательно вызывать при закрытии окна.
   */
  async preview(entry) {
    const kind = previewKind(entry);
    if (!kind) throw new AppError("fileNoPreview");
    const blob = await this.read(entry);
    const name = cleanFileName(entry.name);
    const base = { kind, name, size: blob.size, dispose: () => {} };

    if (kind === "text") {
      const limit = Math.min(blob.size, TEXT_PREVIEW_LIMIT);
      const bytes = new Uint8Array(await blob.slice(0, limit).arrayBuffer());
      const { text, encoding } = decodeText(bytes);
      return {
        ...base,
        text,
        encoding,
        truncated: blob.size > limit,
        shown: limit,
      };
    }

    const url = URL.createObjectURL(blob);
    return { ...base, url, dispose: () => URL.revokeObjectURL(url) };
  }

  async download(entry) {
    const blob = await this.read(entry);
    const name = cleanFileName(entry.name);

    // В обёртке Electron просим системный диалог «Сохранить как»: иначе
    // Chromium молча положил бы файл в «Загрузки».
    const saveFile = globalThis.longcallDesktop?.saveFile;
    if (typeof saveFile === "function") {
      let result = null;
      try {
        result = await saveFile({ name, data: await blob.arrayBuffer() });
      } catch {
        result = null;
      }
      if (result?.ok) {
        this.diagnostics?.record("files.downloaded", { size: blob.size, via: "desktop" });
        return name;
      }
      // Отмена в диалоге — не ошибка и не повод открывать браузерный путь.
      if (result?.canceled) return null;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.diagnostics?.record("files.downloaded", { size: blob.size, via: "browser" });
    return name;
  }

  /** Удалить файл комнаты (свой — сразу, чужой — по кнопке в списке). */
  async removeFile(entry) {
    if (!entry?.id) return;
    if (this.busy) throw new AppError("fileBusy");
    try {
      await remove(ref(db, `${this.path}/${entry.id}`));
    } catch (err) {
      throw new AppError(err?.code === "PERMISSION_DENIED" ? "filesRules" : "fileFailed", {
        msg: err?.message || "",
      });
    }
    // Части убираем следом: даже если не получится, комната унесёт их с собой.
    try {
      await remove(ref(db, this.partsPath(entry.id)));
    } catch {}
  }
}

export { FILES as FILE_LIMITS };
