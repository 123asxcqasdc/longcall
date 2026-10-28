import { STORAGE_KEYS } from "./config.js";

export const THEMES = ["win98", "symbian"];

const listeners = new Set();
let theme = "win98";

export function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEYS.theme);
  } catch {}
  theme = THEMES.includes(stored) ? stored : "win98";
  applyTheme();
  return theme;
}

export function getTheme() {
  return theme;
}

export function isSymbian() {
  return theme === "symbian";
}

export function setTheme(next) {
  if (!THEMES.includes(next) || next === theme) return theme;
  theme = next;
  try {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  } catch {}
  applyTheme();
  listeners.forEach((fn) => fn(theme));
  return theme;
}

export function toggleTheme() {
  return setTheme(theme === "symbian" ? "win98" : "symbian");
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function themeLabelKey(value = theme) {
  return value === "symbian" ? "theme.symbian" : "theme.win98";
}

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("theme-symbian", theme === "symbian");
  root.classList.toggle("theme-win98", theme === "win98");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "symbian" ? "#1b3f6b" : "#008080");
}
