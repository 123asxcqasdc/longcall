import { ref, onValue, push, query, limitToLast } from "../vendor/firebase.js";
import { db } from "./firebase.js";
import { APP } from "./config.js";
import { AppError } from "./util.js";

/**
 * Текстовый чат комнаты.
 *
 *   rooms/{code}/chat/{msgId}   {from, nick, text, at}
 *
 * Живёт в той же Realtime Database, что и сигналинг: отдельного сервиса
 * не нужно, а вместе с комнатой чат удаляется сам (rooms/{code} уходит
 * целиком, когда уходит последний участник).
 *
 * Зачем в звонке чат: у собеседника может не быть микрофона, он может
 * быть в шумном месте или просто стесняться говорить — раньше в такой
 * ситуации связаться было нечем.
 *
 * Слушаем только хвост переписки (limitToLast): комната на 80 сообщениях
 * не растёт бесконечно ни по трафику, ни по памяти.
 */

const CHAT = APP.chat;

/* ------------------------------ тексты -------------------------------- */

/**
 * Приводит ввод в порядок: убирает управляющие символы, схлопывает
 * пробелы, обрезает по лимиту. Переводы строк не поддерживаем — поле
 * ввода однострочное, а многострочные сообщения ломают вид списка.
 */
export function cleanMessage(raw) {
  const text = String(raw || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.slice(0, CHAT.maxLength);
}

/** Время сообщения — только часы и минуты: в звонке дата не нужна. */
export function shortTime(at, lang) {
  const date = new Date(Number(at) || Date.now());
  return date.toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------- класс -------------------------------- */

export class RoomChat {
  constructor({ code, me, onList = null, onNew = null, onError = null, diagnostics = null }) {
    this.code = code;
    this.me = { uid: me.uid, nick: me.nick };
    this.onList = onList;
    this.onNew = onNew;
    this.onError = onError;
    this.diagnostics = diagnostics;

    this.messages = [];
    this.known = new Set();
    this.first = true;
    this.unsub = null;
    this.closed = false;
    this.lastSentAt = 0;
    this.errorShown = false;
  }

  get path() {
    return `rooms/${this.code}/chat`;
  }

  watch() {
    if (this.unsub) return;
    // limitToLast без orderBy: Firebase считает порядок по ключу push(),
    // а он хронологический — этого достаточно и не требует индексов.
    const target = query(ref(db, this.path), limitToLast(CHAT.maxMessages));
    this.unsub = onValue(
      target,
      (snap) => this.handle(snap.val() || {}),
      (err) => {
        this.diagnostics?.record("chat.watch", { error: err?.message || "denied" });
        if (this.errorShown) return;
        this.errorShown = true;
        this.onError?.(new AppError("chatDenied"));
      }
    );
  }

  stop() {
    this.closed = true;
    try {
      this.unsub?.();
    } catch {}
    this.unsub = null;
  }

  handle(value) {
    if (this.closed) return;
    const list = Object.entries(value && typeof value === "object" ? value : {})
      .filter(([, data]) => data && typeof data === "object" && typeof data.text === "string")
      .map(([id, data]) => ({
        id,
        from: String(data.from || ""),
        nick: String(data.nick || ""),
        text: String(data.text || ""),
        at: Number(data.at) || 0,
      }))
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const previous = this.known;
    this.messages = list;

    if (!this.first) {
      for (const message of list) {
        if (previous.has(message.id)) continue;
        if (message.from === this.me.uid) continue; // своё не подсвечиваем
        this.onNew?.(message);
      }
    }
    this.known = new Set(list.map((message) => message.id));
    this.first = false;
    this.onList?.(list);
  }

  get canSend() {
    return !this.closed;
  }

  /** Отправляет сообщение. Возвращает очищенный текст. */
  async send(raw) {
    const text = cleanMessage(raw);
    if (!text) throw new AppError("chatEmpty");
    if (this.closed) throw new AppError("chatClosed");

    // Защита от «залипания» клавиши и от случайного спама: не чаще
    // одного сообщения в CHAT.minInterval миллисекунд.
    const now = Date.now();
    if (now - this.lastSentAt < CHAT.minInterval) throw new AppError("chatTooFast");
    this.lastSentAt = now;

    try {
      await push(ref(db, this.path), {
        from: this.me.uid,
        nick: this.me.nick,
        text,
        at: now,
      });
    } catch (err) {
      throw new AppError(err?.code === "PERMISSION_DENIED" ? "chatRules" : "chatFailed", {
        msg: err?.message || "",
      });
    }
    this.diagnostics?.record("chat.sent", { length: text.length });
    return text;
  }
}

export { CHAT as CHAT_LIMITS };
