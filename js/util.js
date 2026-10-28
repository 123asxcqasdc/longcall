import { t } from "./i18n.js";

export class AppError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.params = params;
  }
}

export function errorText(err) {
  if (!err) return t("err.generic", { msg: "unknown" });
  if (err instanceof AppError) {
    const key = `err.${err.code}`;
    const text = t(key, err.params);
    if (text !== key) return text;
  }
  const name = err.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") return t("err.mic");
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return t("err.mic.none");
  if (name === "OverconstrainedError") return t("err.mic.none");
  if (name === "NotReadableError") return t("err.mic");
  if (name === "NetworkError" || err.code === "auth/network-request-failed") return t("err.network");
  if (err.code === "PERMISSION_DENIED" || err.code === "permission-denied") return t("err.rules");
  if (typeof err.code === "string" && err.code.startsWith("auth/")) {
    return t("err.auth", { host: location.host });
  }
  return t("err.generic", { msg: err.message || String(err) });
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "svg") {
      node.innerHTML = `<svg class="btn-ico"><use href="#${value}"/></svg>`;
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function svgUse(id, cls = "btn-ico") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function roomUrl(code) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}

export function debounce(fn, ms = 120) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function initials(nick) {
  const clean = String(nick || "?").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0].toUpperCase()).join("");
}
