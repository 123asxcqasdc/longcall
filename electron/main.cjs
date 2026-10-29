// Electron main process: обёртка LongCall 98 для Windows и Linux.
//
// В обёртке нет «рабочего стола» и панели задач: каждое окно приложения —
// настоящий BrowserWindow без системной рамки, а заголовок в стиле Win98
// служит drag-зоной (CSS -webkit-app-region: drag).
//
// Страницы отдаются по собственному стандартному защищённому протоколу
// app://longcall — так работают localStorage/IndexedDB, getUserMedia
// и буфер обмена, чего не бывает на file://.

const { app, BrowserWindow, dialog, Menu, ipcMain, protocol, session, shell, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");

const ROOT = path.join(__dirname, "..");
const SCHEME = "app";
const APP_HOST = "longcall";

// Схема для ссылок вида longcall://join?room=1234 — по ней система передаёт
// комнату уже запущенному приложению (или запускает его).
const JOIN_SCHEME = "longcall";
const ENTRY = path.join(ROOT, "index.html");

const HOME_SIZE = { width: 720, height: 720, minWidth: 460, minHeight: 420 };
const CALL_SIZE = { width: 560, height: 680, minWidth: 420, minHeight: 460 };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

// Регистрируется до app.whenReady(): схема должна быть standard + secure,
// иначе браузерный контекст не даст ни хранилищ, ни микрофона.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** @type {BrowserWindow | null} */
let homeWindow = null;
let pendingLink = null;
/** @type {Map<string, BrowserWindow>} */
const callWindows = new Map();
const allowClose = new Set();

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    const raw = fs.readFileSync(stateFile(), "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

let windowState = {};
let saveTimer = null;

function scheduleStateSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWindowState, 400);
}

function saveWindowState() {
  const payload = { ...windowState };
  for (const [key, win] of Object.entries(windowsByKey())) {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized()) continue;
    payload[key] = win.getBounds();
  }
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(payload, null, 2));
  } catch {
    /* состояние окон — не критично */
  }
}

function windowsByKey() {
  const map = {};
  if (homeWindow && !homeWindow.isDestroyed()) map.home = homeWindow;
  for (const [code, win] of callWindows) {
    if (win && !win.isDestroyed()) map[`call-${code}`] = win;
  }
  return map;
}

/** Рабочая область основного монитора (или его размеры, если области нет). */
function primaryArea() {
  try {
    const display = screen.getPrimaryDisplay();
    return display.workArea || display.bounds;
  } catch {
    return { x: 0, y: 0, width: 1024, height: 768 };
  }
}

/**
 * Видна ли шапка окна на каком-нибудь мониторе.
 *
 * Частая причина «пропавшей» панели окна на Linux: сохранённая позиция
 * осталась от другого монитора, от тайлового оконного менеджера или от
 * сессии Wayland, и окно открывается выше/левее экрана — контент виден,
 * а заголовок с кнопками обрезан, и сдвинуть окно нечем.
 */
function isTitleVisible(bounds) {
  const TITLE = 28; // высота шапки окна в приложении
  let displays = [];
  try {
    displays = screen.getAllDisplays();
  } catch {
    return true;
  }
  if (!displays.length) return true;

  return displays.some((display) => {
    const area = display.workArea || display.bounds;
    const overlapX =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    // шапка целиком в пределах рабочей области и окно заметно видно
    return (
      overlapX >= 120 &&
      overlapY >= TITLE &&
      bounds.y >= area.y - 2 &&
      bounds.y + TITLE <= area.y + area.height
    );
  });
}

/**
 * Возвращает пригодные границы окна: сохранённые, если они на экране,
 * иначе — по центру основного монитора. Размер всегда влезает в экран.
 */
function safeBounds(key, fallback) {
  const area = primaryArea();
  const saved = windowState[key];
  const fits = (value) =>
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    value.width >= fallback.minWidth &&
    value.height >= fallback.minHeight;

  if (fits(saved) && isTitleVisible(saved)) {
    // даже «видимое» окно не должно вылезать за край экрана
    return {
      x: Math.round(Math.min(Math.max(saved.x, area.x), area.x + area.width - 160)),
      y: Math.round(Math.min(Math.max(saved.y, area.y), area.y + area.height - 60)),
      width: Math.min(saved.width, area.width),
      height: Math.min(saved.height, area.height),
    };
  }

  // Позиции нет или она вне экрана — ставим по центру, чуть выше середины,
  // чтобы шапка точно была видна.
  const width = Math.min(fallback.width, area.width);
  const height = Math.min(fallback.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + Math.max(0, (area.height - height) / 2 - 20)),
    width,
    height,
  };
}

/** Показ окна с подстраховкой: ready-to-show может не сработать. */
function showWhenReady(win) {
  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once("ready-to-show", show);
  // на всякий случай: если событие не пришло, окно всё равно показываем
  setTimeout(show, 4000);
  return win;
}

/* ------------------------------- протокол ------------------------------- */

async function serveAppFile(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (url.host !== APP_HOST) {
    return new Response("Not found", { status: 404 });
  }

  let rel = decodeURIComponent(url.pathname || "/");
  if (rel === "/" || rel === "") rel = "/index.html";

  const target = path.normalize(path.join(ROOT, rel));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  // служебные каталоги наружу не отдаём
  const blocked = ["node_modules", ".git", "electron", "release", "tools"].map((dir) =>
    path.join(ROOT, dir) + path.sep
  );
  if (blocked.some((dir) => target.startsWith(dir))) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const buf = await fsp.readFile(target);
    const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    return new Response(buf, { status: 200, headers: { "content-type": type } });
  } catch (err) {
    return new Response(`Not found: ${path.basename(target)}`, { status: 404 });
  }
}

/* -------------------------------- окна -------------------------------- */

function buildUrl(kind, { code, nick } = {}) {
  const url = new URL(`${SCHEME}://${APP_HOST}/index.html`);
  url.searchParams.set("view", kind);
  if (code) url.searchParams.set("room", code);
  if (nick) url.searchParams.set("nick", nick);
  return url.toString();
}

function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${SCHEME}://${APP_HOST}/`)) event.preventDefault();
  });
}

function trackMaximize(win) {
  const send = (value) => {
    if (!win.isDestroyed()) win.webContents.send("desktop:maximized", value);
  };
  win.on("maximize", () => send(true));
  win.on("unmaximize", () => send(false));
}

function applyCommonWindowOptions(options) {
  return {
    show: false,
    frame: false,
    backgroundColor: "#c0c0c0",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // звонок не должен «засыпать», когда окно не в фокусе
      backgroundThrottling: false,
    },
    ...options,
  };
}

function createHomeWindow() {
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.show();
    homeWindow.focus();
    return homeWindow;
  }

  const saved = safeBounds("home", HOME_SIZE);
  const win = new BrowserWindow(
    applyCommonWindowOptions({
      ...HOME_SIZE,
      ...(saved || {}),
      title: "LongCall 98",
      minWidth: HOME_SIZE.minWidth,
      minHeight: HOME_SIZE.minHeight,
    })
  );

  hardenWindow(win);
  trackMaximize(win);

  win.on("resize", scheduleStateSave);
  win.on("move", scheduleStateSave);
  showWhenReady(win);
  win.on("closed", () => {
    stopDrag();
    homeWindow = null;
    scheduleStateSave();
  });

  win.loadURL(buildUrl("home"));
  homeWindow = win;
  return win;
}

function createCallWindow(code, { nick } = {}) {
  const room = String(code || "").replace(/\D/g, "").slice(0, 4);
  if (room.length !== 4) return null;

  const existing = callWindows.get(room);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const saved = safeBounds(`call-${room}`, CALL_SIZE);
  const win = new BrowserWindow(
    applyCommonWindowOptions({
      ...CALL_SIZE,
      ...(saved || {}),
      title: `LongCall 98 — ${room}`,
      minWidth: CALL_SIZE.minWidth,
      minHeight: CALL_SIZE.minHeight,
    })
  );

  hardenWindow(win);
  trackMaximize(win);

  // Даём странице аккуратно выйти из комнаты перед закрытием окна.
  win.on("close", (event) => {
    if (allowClose.has(win.id) || app.isQuitting) return;
    event.preventDefault();
    if (win.webContents.isDestroyed()) return;
    win.webContents.send("desktop:before-close");
    setTimeout(() => {
      if (!win.isDestroyed()) {
        allowClose.add(win.id);
        win.close();
      }
    }, 1500);
  });

  win.on("resize", scheduleStateSave);
  win.on("move", scheduleStateSave);
  showWhenReady(win);
  win.on("closed", () => {
    stopDrag();
    callWindows.delete(room);
    allowClose.delete(win.id);
    scheduleStateSave();
  });

  win.loadURL(buildUrl("call", { code: room, nick }));
  callWindows.set(room, win);
  return win;
}

/* ------------------------------- IPC ------------------------------- */

function windowFromEvent(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win : null;
}

ipcMain.handle("desktop:window-action", (event, action) => {
  const win = windowFromEvent(event);
  if (!win) return false;
  switch (action) {
    case "minimize":
      win.minimize();
      return true;
    case "maximize":
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return win.isMaximized();
    case "close":
      win.close();
      return true;
    default:
      return false;
  }
});

/* ----------------------------- перетаскивание окна ----------------------------- */

// На Linux (особенно Wayland/XWayland) CSS -webkit-app-region: drag часто не
// работает, и окно нечем сдвинуть. Поэтому шапка дополнительно тянет окно
// вручную: рендерер сообщает о начале и конце перетаскивания, а позицию
// окна пересчитываем по положению курсора.
let dragState = null;

function stopDrag() {
  if (!dragState) return;
  clearInterval(dragState.timer);
  dragState = null;
}

ipcMain.on("desktop:drag-start", (event) => {
  const win = windowFromEvent(event);
  if (!win || win.isDestroyed()) return;
  stopDrag();

  let cursor;
  try {
    cursor = screen.getCursorScreenPoint();
  } catch {
    return;
  }
  const [wx, wy] = win.getPosition();
  const offsetX = cursor.x - wx;
  const offsetY = cursor.y - wy;

  const timer = setInterval(() => {
    if (!dragState || win.isDestroyed()) {
      stopDrag();
      return;
    }
    try {
      if (win.isMaximized()) return;
      const point = screen.getCursorScreenPoint();
      win.setPosition(Math.round(point.x - offsetX), Math.round(point.y - offsetY));
    } catch {
      stopDrag();
    }
  }, 16);

  dragState = { win, timer };
  event.returnValue = true;
});

ipcMain.on("desktop:drag-end", () => {
  stopDrag();
  scheduleStateSave();
});

ipcMain.handle("desktop:is-maximized", (event) => {
  const win = windowFromEvent(event);
  return Boolean(win && win.isMaximized());
});

ipcMain.handle("desktop:open-call", (event, payload = {}) => {
  const win = createCallWindow(payload.code, { nick: payload.nick });
  if (!win) return { ok: false };
  win.show();
  win.focus();
  return { ok: true, code: String(payload.code) };
});

// Сохранение файла из звонка: системный диалог «Сохранить как» вместо
// молчаливого складывания в «Загрузки». Данные приходят из страницы уже
// собранным Blob-ом (файл лежит в Firebase частями).
ipcMain.handle("desktop:save-file", async (event, payload = {}) => {
  const win = windowFromEvent(event) || BrowserWindow.getFocusedWindow() || null;
  const raw = String(payload.name || "file").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 96);
  const name = raw || "file";
  let target = null;
  try {
    const result = await dialog.showSaveDialog(win, {
      title: name,
      defaultPath: path.join(app.getPath("downloads"), name),
      buttonLabel: "Сохранить",
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    target = result.filePath;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
  try {
    // Через IPC приходит ArrayBuffer (structured clone) или Uint8Array.
    const data = payload.data;
    let buffer;
    if (data instanceof ArrayBuffer) buffer = Buffer.from(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else buffer = Buffer.from(String(data || ""), "utf8");
    await fsp.writeFile(target, buffer);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.on("desktop:ready-to-close", (event) => {
  const win = windowFromEvent(event);
  if (!win) return;
  allowClose.add(win.id);
  win.close();
});

/* ---------------------------- ссылки longcall:// ---------------------------- */

/**
 * Достаёт 4-значный код комнаты из ссылки или аргумента.
 *
 * Поддерживаются все разумные формы, чтобы открывались и ссылки из старых
 * сообщений:
 *   longcall://join?room=1234
 *   longcall://join/1234
 *   longcall://room/1234
 *   longcall://1234
 * а также прежний аргумент --room=1234.
 *
 * @param {string} value
 * @returns {string|null}
 */
function roomFromLink(value) {
  if (typeof value !== "string") return null;
  const arg = value.trim();
  if (!arg) return null;

  const legacy = /^--room=(\d{4})$/.exec(arg);
  if (legacy) return legacy[1];

  if (!arg.toLowerCase().startsWith(`${JOIN_SCHEME}://`)) return null;

  // «двоеточие-слэш-слэш» ломает разбор через new URL для longcall://1234,
  // поэтому хост и путь достаём вручную.
  let rest = arg.slice(JOIN_SCHEME.length + 3);
  rest = rest.replace(/^\/+/, "");
  const [pathPart, queryPart = ""] = rest.split("?", 2);

  const fromQuery = new URLSearchParams(queryPart).get("room");
  if (fromQuery && /^\d{4}$/.test(fromQuery.trim())) return fromQuery.trim();

  const digits = pathPart.match(/(\d{4})(?!\d)/);
  if (digits) return digits[1];

  return null;
}

/** Ищет ссылку на комнату в аргументах командной строки. */
function roomFromArgv(argv = []) {
  for (const arg of argv) {
    const room = roomFromLink(arg);
    if (room) return room;
  }
  return null;
}

/** Поднимает окно на передний план (в том числе из свёрнутого состояния). */
function revealWindow(win) {
  if (!win || win.isDestroyed()) return null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

/** Открывает комнату из ссылки и поднимает окно на передний план. */
function focusFromLink(argv) {
  const room = roomFromArgv(argv);
  if (room) {
    const win = createCallWindow(room);
    // окно этой комнаты могло быть уже открыто — поднимаем его
    return revealWindow(win);
  }
  return revealWindow(homeWindow) || createHomeWindow();
}

/**
 * Регистрирует схему longcall:// в системе.
 *
 * Windows/macOS: setAsDefaultProtocolClient (на Windows запись в реестр
 * делает ещё и установщик NSIS, на portable-сборке помогает этот вызов).
 * Linux: Electron этот вызов игнорирует, поэтому .desktop-файл и
 * xdg-mime создаём сами — иначе AppImage не открывает ссылки.
 */
function registerProtocol() {
  try {
    if (process.defaultApp) {
      // запуск из исходников: electron . — нужен и путь к приложению
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(JOIN_SCHEME, process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient(JOIN_SCHEME);
    }
  } catch {
    // регистрация не критична: приложение работает и без неё
  }

  if (process.platform === "linux") registerLinuxProtocol();
}

/** Linux: свой .desktop с обработчиком схемы + xdg-mime default. */
function registerLinuxProtocol() {
  try {
    const { execFile } = require("node:child_process");
    const appsDir = path.join(app.getPath("home"), ".local", "share", "applications");
    const desktopFile = path.join(appsDir, "longcall98.desktop");
    const exec = process.defaultApp
      ? `"${process.execPath}" "${path.resolve(process.argv[1] || ".")}" %u`
      : `"${process.execPath}" %u`;

    const body = [
      "[Desktop Entry]",
      "Type=Application",
      "Name=LongCall 98",
      "Comment=Аудиозвонки в стиле Windows 9x",
      `Exec=${exec}`,
      "Terminal=false",
      "Categories=Network;AudioVideo;",
      `MimeType=x-scheme-handler/${JOIN_SCHEME};`,
      "",
    ].join("\n");

    fs.mkdirSync(appsDir, { recursive: true });
    const current = fs.existsSync(desktopFile) ? fs.readFileSync(desktopFile, "utf8") : "";
    if (current !== body) fs.writeFileSync(desktopFile, body, { mode: 0o644 });

    execFile(
      "xdg-mime",
      ["default", "longcall98.desktop", `x-scheme-handler/${JOIN_SCHEME}`],
      { timeout: 5000 },
      () => {} // нет xdg-mime — молча живём дальше
    );
  } catch {
    // нет прав на ~/.local/share/applications — не повод падать
  }
}

/* ------------------------------ жизненный цикл ------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // Сюда приходит и повторный запуск, и клик по ссылке longcall://join?room=…
    focusFromLink(argv);
  });

  // macOS присылает deep link событием, а не аргументом
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) focusFromLink([url]);
    else pendingLink = url;
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
  });

  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("io.github.longcall98");
    windowState = loadWindowState();

    protocol.handle(SCHEME, serveAppFile);

    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      if (permission === "media") {
        const types = details?.mediaTypes || [];
        callback(types.length === 0 || types.includes("audio"));
        return;
      }
      callback(permission === "clipboard-sanitized-write" || permission === "clipboard-read");
    });
    ses.setPermissionCheckHandler((_wc, permission) => {
      return (
        permission === "media" ||
        permission === "clipboard-sanitized-write" ||
        permission === "clipboard-read"
      );
    });

    if (process.platform === "darwin") {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "windowMenu" },
        ])
      );
    } else {
      Menu.setApplicationMenu(null);
    }

    registerProtocol();

    createHomeWindow();

    // Запуск по ссылке: longcall://join?room=1234 или --room=1234
    const argv = pendingLink ? [...process.argv, pendingLink] : process.argv;
    pendingLink = null;
    const startRoom = roomFromArgv(argv);
    if (startRoom) createCallWindow(startRoom);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createHomeWindow();
    });
  });

  app.on("window-all-closed", () => {
    saveWindowState();
    if (process.platform !== "darwin") app.quit();
  });
}

module.exports = { ENTRY };
