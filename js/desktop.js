// Мост «веб-приложение ↔ Electron».
//
// В браузере (GitHub Pages) все функции — no-op, приложение работает как раньше:
// рабочий стол, панель задач, окна внутри страницы.
// В обёртке (Electron) каждое окно приложения — отдельный BrowserWindow,
// поэтому «рабочий стол» прячется, а управление окном уходит в главный процесс.

const bridge = typeof window !== "undefined" ? window.longcallDesktop : undefined;

export const isDesktop = Boolean(bridge);
export const platform = bridge?.platform || "web";

function readView() {
  try {
    const value = new URLSearchParams(location.search).get("view");
    return value === "call" ? "call" : "home";
  } catch {
    return "home";
  }
}

export const desktopView = isDesktop ? readView() : "home";

/* ------------------------- управление окном ------------------------- */

export async function windowAction(action) {
  if (!bridge) return false;
  try {
    return await bridge.windowAction(action);
  } catch {
    return false;
  }
}

export const minimizeWindow = () => windowAction("minimize");
export const toggleMaximizeWindow = () => windowAction("maximize");
export const closeWindow = () => windowAction("close");

export async function isMaximizedNow() {
  if (!bridge) return false;
  try {
    return Boolean(await bridge.isMaximized());
  } catch {
    return false;
  }
}

/* --------------------------- открытие звонка --------------------------- */

/**
 * В обёртке звонок открывается отдельным настоящим окном.
 * @returns {Promise<boolean>} true, если окно создано
 */
export async function openCallWindow(code, { nick } = {}) {
  if (!bridge) return false;
  try {
    const result = await bridge.openCall({ code, nick });
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

/* --------------------------- закрытие окна --------------------------- */

/**
 * Главный процесс спрашивает «можно закрывать?» — даём странице
 * корректно выйти из комнаты и отвечаем.
 */
export function onBeforeClose(handler) {
  if (!bridge?.onBeforeClose) return () => {};
  return bridge.onBeforeClose(async () => {
    try {
      await handler?.();
    } finally {
      bridge.readyToClose();
    }
  });
}

/* ----------------------- системные кнопки заголовка ----------------------- */

let maxUnsubscribe = null;

/**
 * Вешает на заголовок окна настоящие системные действия:
 * свернуть, развернуть/восстановить, закрыть. Перетаскивание окна делает
 * CSS (-webkit-app-region: drag), поэтому слушателей drag здесь нет.
 */
export function bindNativeControls(root) {
  if (!bridge || !root) return;

  const titlebar = root.querySelector(".titlebar");
  const minBtn = root.querySelector("[data-win-min]");
  const maxBtn = root.querySelector("[data-win-max]");
  const closeBtn = root.querySelector("[data-win-close]");

  minBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    minimizeWindow();
  });
  maxBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleMaximizeWindow();
  });
  closeBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    closeWindow();
  });

  titlebar?.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    toggleMaximizeWindow();
  });

  const applyMaximized = (value) => {
    document.documentElement.classList.toggle("is-maximized", Boolean(value));
  };

  isMaximizedNow().then(applyMaximized);
  maxUnsubscribe?.();
  maxUnsubscribe = bridge.onMaximized?.(applyMaximized) || null;
}
