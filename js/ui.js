import { t } from "./i18n.js";
import { $, $$, el, svgUse } from "./util.js";

/* ================================ тосты ================================ */

export function toast({ title, text, icon = "i-info", tone = "info", timeout = 4200 }) {
  const root = $("#toasts");
  if (!root) return () => {};
  const node = el("div", { class: `toast ${tone === "error" ? "err" : ""}` });
  node.append(svgUse(icon));
  const body = el("div");
  if (title) body.append(el("b", { text: title }));
  if (text) body.append(el("span", { text }));
  node.append(body);
  root.append(node);

  let timer = null;
  const close = () => {
    if (!node.isConnected) return;
    clearTimeout(timer);
    node.classList.add("out");
    setTimeout(() => node.remove(), 220);
  };
  timer = setTimeout(close, timeout);
  node.addEventListener("click", close);
  return close;
}

/* ================================ модалки ================================ */

const modalStack = [];

function syncModalStack() {
  document.body.classList.toggle("has-modal", modalStack.length > 0);
}

export function openModal({
  title,
  icon = "i-info",
  body,
  buttons = [],
  width = "",
  dismissible = true,
  onClose,
  titleSuffix,
}) {
  const layer = el("div", { class: "modal-layer" });
  const modal = el("div", { class: "modal" });
  if (width) modal.style.width = width;

  const titlebar = el("div", { class: "titlebar" });
  titlebar.append(el("span", { class: "titlebar-icon", html: `<svg><use href="#${icon}"/></svg>` }));
  const titleText = el("span", { class: "titlebar-text", text: title });
  titlebar.append(titleText);
  if (titleSuffix) titlebar.append(titleSuffix);
  const btnBox = el("span", { class: "titlebar-btns" });
  const closeBtn = el("button", { type: "button", class: "tb-btn tb-close", "aria-label": t("common.close") });
  btnBox.append(closeBtn);
  titlebar.append(btnBox);
  modal.append(titlebar);

  const bodyEl = el("div", { class: "modal-body" });
  if (icon) {
    const holder = el("div", { class: "modal-icon", html: `<svg><use href="#${icon}"/></svg>` });
    bodyEl.append(holder);
  }
  if (body instanceof Node) bodyEl.append(body);
  else if (typeof body === "string") bodyEl.append(el("div", { html: body }));

  modal.append(bodyEl);

  const api = {
    el: modal,
    body: bodyEl,
    layer,
    close(result) {
      const index = modalStack.indexOf(api);
      if (index === -1) return;
      modalStack.splice(index, 1);
      layer.remove();
      syncModalStack();
      document.removeEventListener("keydown", onKey);
      onClose?.(result);
    },
    setTitle(text) {
      titleText.textContent = text;
    },
  };

  if (buttons.length) {
    const foot = el("div", { class: "modal-foot" });
    for (const spec of buttons) {
      const btn = el("button", {
        type: "button",
        class: "btn",
        text: spec.label,
        disabled: spec.disabled ? "" : null,
      });
      if (spec.disabled) btn.disabled = true;
      btn.addEventListener("click", async () => {
        if (spec.busy !== false) btn.disabled = true;
        try {
          const keep = await spec.onClick?.(api);
          if (keep !== false) api.close(spec.value);
        } finally {
          if (spec.busy !== false && btn.isConnected) btn.disabled = false;
        }
      });
      foot.append(btn);
    }
    modal.append(foot);
  }

  const onKey = (event) => {
    if (event.key === "Escape" && dismissible && modalStack[modalStack.length - 1] === api) {
      event.preventDefault();
      api.close("cancel");
    }
  };

  closeBtn.addEventListener("click", () => api.close("cancel"));
  document.addEventListener("keydown", onKey);

  layer.append(modal);
  document.body.append(layer);
  modalStack.push(api);
  syncModalStack();

  const focusTarget = modal.querySelector("input, select, textarea, .modal-foot .btn");
  setTimeout(() => focusTarget?.focus(), 30);

  return api;
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  top?.close("cancel");
}

export function confirmModal({ title, text, okLabel, cancelLabel, icon = "i-warn" }) {
  return new Promise((resolve) => {
    let answered = false;
    const api = openModal({
      title,
      icon,
      body: el("p", { text }),
      buttons: [
        {
          label: okLabel || t("common.ok"),
          onClick: () => {
            answered = true;
            resolve(true);
          },
        },
        {
          label: cancelLabel || t("common.cancel"),
          onClick: () => {
            answered = true;
            resolve(false);
          },
        },
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    api.el.querySelector(".modal-foot .btn")?.focus();
  });
}

/* ============================== менеджер окон ============================== */

export class WindowManager {
  constructor(desktop, tasksRoot) {
    this.desktop = desktop;
    this.tasksRoot = tasksRoot;
    this.wins = new Map();
    this.zIndex = 30;
    this.dragging = null;
    this.taskbarBuilt = false;
    window.addEventListener("resize", () => {
      for (const entry of this.wins.values()) {
        if (entry.el.classList.contains("maximized")) continue;
        this.clamp(entry.el);
      }
    });
  }

  register(key, winEl, { label, icon = "i-phone", onClose } = {}) {
    const entry = {
      key,
      el: winEl,
      label, // () => string
      icon,
      onClose,
      minimized: false,
      open: !winEl.classList.contains("hidden"),
    };
    this.wins.set(key, entry);

    const titlebar = winEl.querySelector(".titlebar");
    if (titlebar && titlebar.dataset.drag === key) this.makeDraggable(entry);

    winEl.addEventListener("pointerdown", () => this.focus(key), true);
    winEl.querySelectorAll("[data-win-min]").forEach((btn) =>
      btn.addEventListener("click", () => this.minimize(key))
    );
    winEl.querySelectorAll("[data-win-max]").forEach((btn) =>
      btn.addEventListener("click", () => this.toggleMax(key))
    );
    winEl.querySelectorAll("[data-win-close]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const allow = entry.onClose ? await entry.onClose() : true;
        if (allow !== false) this.close(key);
      })
    );
    return entry;
  }

  buildTaskbar() {
    this.tasksRoot.textContent = "";
    for (const entry of this.wins.values()) {
      if (!entry.open) continue;
      const btn = el("button", { type: "button", class: "btn task-btn" });
      btn.append(svgUse(entry.icon, ""));
      btn.append(el("span", { text: typeof entry.label === "function" ? entry.label() : entry.label || "" }));
      btn.addEventListener("click", () => {
        const active = this.activeKey === entry.key && !entry.minimized;
        if (entry.minimized) this.restore(entry.key);
        else if (active) this.minimize(entry.key);
        else this.focus(entry.key);
      });
      entry.taskBtn = btn;
      this.tasksRoot.append(btn);
    }
    this.syncTasks();
  }

  syncTasks() {
    for (const entry of this.wins.values()) {
      if (!entry.taskBtn) continue;
      const label = typeof entry.label === "function" ? entry.label() : entry.label || "";
      const span = entry.taskBtn.querySelector("span");
      if (span && span.textContent !== label) span.textContent = label;
      entry.taskBtn.classList.toggle(
        "active",
        this.activeKey === entry.key && !entry.minimized
      );
    }
  }

  focus(key) {
    const entry = this.wins.get(key);
    if (!entry || !entry.open) return;
    this.activeKey = key;
    this.zIndex += 1;
    entry.el.style.zIndex = String(this.zIndex);
    for (const other of this.wins.values()) {
      other.el.classList.toggle("focused", other.key === key);
      other.el.classList.toggle("inactive", other.key !== key);
    }
    this.syncTasks();
  }

  open(key) {
    const entry = this.wins.get(key);
    if (!entry) return;
    entry.open = true;
    entry.minimized = false;
    entry.el.classList.remove("hidden");
    this.buildTaskbar();
    this.focus(key);
    this.clamp(entry.el);
  }

  close(key) {
    const entry = this.wins.get(key);
    if (!entry) return;
    entry.open = false;
    entry.minimized = false;
    entry.el.classList.add("hidden");
    if (this.activeKey === key) this.activeKey = null;
    this.buildTaskbar();
  }

  minimize(key) {
    const entry = this.wins.get(key);
    if (!entry || !entry.open) return;
    entry.minimized = true;
    entry.el.classList.add("hidden");
    if (this.activeKey === key) this.activeKey = null;
    this.syncTasks();
  }

  restore(key) {
    const entry = this.wins.get(key);
    if (!entry) return;
    entry.minimized = false;
    entry.el.classList.remove("hidden");
    this.focus(key);
  }

  toggleMax(key) {
    const entry = this.wins.get(key);
    if (!entry) return;
    if (window.matchMedia("(max-width: 720px)").matches) return;
    entry.el.classList.toggle("maximized");
    if (entry.el.classList.contains("maximized")) {
      entry.prevInline = entry.el.getAttribute("style") || "";
      entry.el.style.left = "4px";
      entry.el.style.top = "4px";
      entry.el.style.right = "4px";
      entry.el.style.bottom = "4px";
      entry.el.style.width = "auto";
      entry.el.style.height = "auto";
      entry.el.style.transform = "none";
    } else if (entry.prevInline !== undefined) {
      entry.el.setAttribute("style", entry.prevInline);
    }
    this.focus(key);
  }

  clamp(winEl) {
    if (!this.desktop || winEl.classList.contains("hidden")) return;
    if (window.matchMedia("(max-width: 720px)").matches) return;
    if (winEl.classList.contains("maximized")) return;
    const desk = this.desktop.getBoundingClientRect();
    const rect = winEl.getBoundingClientRect();
    if (!rect.width) return;
    let left = rect.left - desk.left;
    let top = rect.top - desk.top;
    const maxLeft = desk.width - 60;
    const maxTop = desk.height - 30;
    const minLeft = 60 - rect.width;
    left = Math.min(Math.max(left, minLeft), maxLeft);
    top = Math.min(Math.max(top, 0), Math.max(0, maxTop));
    winEl.style.transform = "none";
    winEl.style.right = "auto";
    winEl.style.bottom = "auto";
    winEl.style.left = `${left}px`;
    winEl.style.top = `${top}px`;
  }

  makeDraggable(entry) {
    const titlebar = entry.el.querySelector(".titlebar");
    let start = null;

    titlebar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button")) return;
      if (window.matchMedia("(max-width: 720px)").matches) return;
      if (entry.el.classList.contains("maximized")) return;
      const desk = this.desktop.getBoundingClientRect();
      const rect = entry.el.getBoundingClientRect();
      start = {
        x: event.clientX,
        y: event.clientY,
        left: rect.left - desk.left,
        top: rect.top - desk.top,
        pointerId: event.pointerId,
      };
      entry.el.style.transform = "none";
      entry.el.style.right = "auto";
      entry.el.style.bottom = "auto";
      entry.el.style.left = `${start.left}px`;
      entry.el.style.top = `${start.top}px`;
      titlebar.setPointerCapture(event.pointerId);
      entry.el.classList.add("dragging");
      document.body.classList.add("is-dragging");
    });

    titlebar.addEventListener("pointermove", (event) => {
      if (!start || event.pointerId !== start.pointerId) return;
      const desk = this.desktop.getBoundingClientRect();
      const rect = entry.el.getBoundingClientRect();
      let left = start.left + (event.clientX - start.x);
      let top = start.top + (event.clientY - start.y);
      left = Math.min(Math.max(left, 60 - rect.width), desk.width - 60);
      top = Math.min(Math.max(top, 0), desk.height - 30);
      entry.el.style.left = `${left}px`;
      entry.el.style.top = `${top}px`;
    });

    const end = (event) => {
      if (!start) return;
      start = null;
      entry.el.classList.remove("dragging");
      document.body.classList.remove("is-dragging");
      try {
        titlebar.releasePointerCapture(event.pointerId);
      } catch {}
    };
    titlebar.addEventListener("pointerup", end);
    titlebar.addEventListener("pointercancel", end);

    titlebar.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      this.toggleMax(entry.key);
    });
  }
}

/* ============================== меню и мелочи ============================== */

export function initMenus(root = document) {
  const menus = $$(".menu", root);
  const closeAll = () => menus.forEach((m) => m.classList.remove("open"));

  for (const menu of menus) {
    const btn = menu.querySelector(".menu-btn");
    if (!btn) continue;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = menu.classList.contains("open");
      closeAll();
      if (!isOpen) menu.classList.add("open");
    });
    btn.addEventListener("pointerenter", () => {
      if (menus.some((m) => m.classList.contains("open")) && !menu.classList.contains("open")) {
        closeAll();
        menu.classList.add("open");
      }
    });
  }

  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
}

export function setStatus(node, text, tone = "") {
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

export function setProgress(container, { indeterminate = true, value = 0, text = "" } = {}) {
  const bar = container.querySelector(".progress");
  const fill = container.querySelector(".progress-fill");
  const label = container.querySelector(".progress-text");
  if (bar) {
    bar.classList.toggle("indeterminate", indeterminate);
    bar.classList.toggle("determinate", !indeterminate);
    if (fill && !indeterminate) fill.style.setProperty("--p", `${Math.max(0, Math.min(100, value))}%`);
  }
  if (label && text) label.textContent = text;
}

export function autoLockBodyScroll() {
  document.body.classList.add("no-scroll");
}
