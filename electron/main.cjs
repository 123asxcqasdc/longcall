// Electron main process: обёртка LongCall 98 для Windows и Linux.
//
// В обёртке нет «рабочего стола» и панели задач: каждое окно приложения —
// настоящий BrowserWindow без системной рамки, а заголовок в стиле Win98
// служит drag-зоной (CSS -webkit-app-region: drag).
//
// Страницы отдаются по собственному стандартному защищённому протоколу
// app://longcall — так работают localStorage/IndexedDB, getUserMedia
// и буфер обмена, чего не бывает на file://.

const { app, BrowserWindow, Menu, ipcMain, protocol, session, shell } = require("electron");
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

function safeBounds(key, fallback) {
  const saved = windowState[key];
  if (!saved || typeof saved.width !== "number" || typeof saved.height !== "number") return null;
  const ok =
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y) &&
    saved.width >= fallback.minWidth &&
    saved.height >= fallback.minHeight;
  return ok ? saved : null;
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
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
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
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
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

ipcMain.on("desktop:ready-to-close", (event) => {
  const win = windowFromEvent(event);
  if (!win) return;
  allowClose.add(win.id);
  win.close();
});

/* ------------------------ ссылки longcall://join?room= ------------------------ */

/**
 * Достаёт 4-значный код комнаты из аргументов командной строки,
 * deep link вида longcall://join?room=1234 или из старого --room=1234.
 * @param {string[]} argv
 * @returns {string|null}
 */
function roomFromArgv(argv = []) {
  for (const arg of argv) {
    if (typeof arg !== "string") continue;
    if (!arg.toLowerCase().startsWith(`${JOIN_SCHEME}://`)) {
      const legacy = /^--room=(\d{4})$/.exec(arg);
      if (legacy) return legacy[1];
      continue;
    }
    try {
      const url = new URL(arg);
      const code = (url.searchParams.get("room") || "").trim();
      if (/^\d{4}$/.test(code)) return code;
    } catch {
      // битая ссылка — просто игнорируем
    }
  }
  return null;
}

/** Открывает комнату из ссылки и поднимает окно на передний план. */
function focusFromLink(argv) {
  const room = roomFromArgv(argv);
  if (room) return createCallWindow(room);
  if (homeWindow) {
    if (homeWindow.isMinimized()) homeWindow.restore();
    homeWindow.show();
    homeWindow.focus();
    return homeWindow;
  }
  return createHomeWindow();
}

/** Регистрирует схему longcall:// в системе. */
function registerProtocol() {
  if (process.defaultApp) {
    // запуск из исходников: electron . — нужен и путь к приложению
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(JOIN_SCHEME, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
    return;
  }
  app.setAsDefaultProtocolClient(JOIN_SCHEME);
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
