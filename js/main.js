import {
  t,
  initLang,
  applyI18n,
  setLang,
  getLang,
  toggleLang,
  onLangChange,
  formatDate,
} from "./i18n.js";
import { APP } from "./config.js";
import { audioEngine } from "./audio.js";
import { CallSession } from "./call.js";
import { resolveIceServers, resetIceCache } from "./turn.js";
import { CallDiagnostics } from "./diagnostics.js";
import { RoomFiles, formatSize, previewKind } from "./files.js";
import { RoomChat, cleanMessage, shortTime } from "./chat.js";
import { CallView } from "./callui.js";
import {
  $,
  $$,
  el,
  svgUse,
  AppError,
  errorText,
  copyText,
  roomUrl,
  appRoomUrl,
  initials,
  sleep,
} from "./util.js";
import {
  getProfile,
  saveProfile,
  clearProfile,
  rememberUid,
  rememberedUid,
  getSoundsEnabled,
  setSoundsEnabled,
  getPreferredMic,
  setPreferredMic,
  sanitizeNick,
  suggestNick,
  randomRoomCode,
  normalizeRoomCode,
  colorFor,
  getCustomCss,
  setCustomCss,
} from "./store.js";
import {
  signInLocal,
  signOutLocal,
  watchRecent,
  touchRecent,
  removeRecent,
  saveUserProfile,
  roomSnapshot,
} from "./firebase.js";
import { WindowManager, openModal, confirmModal, toast, initMenus } from "./ui.js";
import {
  isDesktop,
  desktopView,
  openCallWindow,
  closeWindow,
  onBeforeClose,
} from "./desktop.js";

const state = {
  uid: null,
  nick: "",
  authOk: false,
  session: null,
  activeCode: "",
  recent: {},
  selectedCode: "",
  recentUnsub: null,
  recentLoading: false,
  settingsApi: null,
  meterRaf: 0,
  booted: false,
  // передача файлов в текущем звонке
  files: null,
  filesList: [],
  // чат текущего звонка
  chat: null,
  chatOpen: false,
  chatUnread: 0,
};

const callView = new CallView();
let wm = null;
// true, когда окно закрывает система (кнопка ×, Alt+F4, выход из приложения)
let systemClosing = false;
const inCallWindow = () => isDesktop && desktopView === "call";
// Открытое окно «Файлы звонка»: { rerender, refreshLabels } или null.
let filesUi = null;
// Последний отправленный диагностический отчёт: { id, path, ok }
let lastReport = null;

/* =========================================================================
   Загрузка и «вход»
   ========================================================================= */

async function boot() {
  initLang();
  document.documentElement.lang = getLang();
  applyI18n();
  document.title = t("app.name");

  setupWindowManager();
  setupChrome();
  syncLangButtons();
  updateSoundUI();
  const year = new Date().getFullYear();
  const copy = $(".splash-foot");
  if (copy) copy.textContent = t("boot.copyright", { year });
  const ver = $(".splash-logo small");
  if (ver) ver.textContent = t("boot.version", { v: APP.version });

  // Загрузка показывается и в браузере, и в обёртке: главный экран
  // появляется не сразу, а после подключения аккаунта.
  await runBootSplash();

  if (!audioEngine.supported) {
    finishBoot();
    openModal({
      title: t("err.title"),
      icon: "i-warn",
      body: el("p", { text: t("err.unsupported") }),
      buttons: [{ label: t("common.close"), onClick: () => {} }],
    });
    return;
  }

  let profile = getProfile();
  let nick = profile?.nick ? sanitizeNick(profile.nick) : "";

  // В отдельном окне звонка имя берём из localStorage или из ссылки,
  // модалку знакомства там не показываем.
  if (!nick && inCallWindow()) {
    nick = sanitizeNick(new URLSearchParams(location.search).get("nick")) || "";
  }

  if (!nick) {
    const entered = await askNickname({ first: true });
    nick = entered || suggestNick();
    saveProfile({ nick });
    profile = getProfile();
  }

  state.nick = nick;
  renderProfile();

  let user = null;
  try {
    user = await authenticate(nick);
  } catch (err) {
    finishBoot();
    showFatal(err);
    return;
  }

  state.uid = user.uid;
  state.authOk = true;
  rememberUid(user.uid);
  saveProfile({ nick, uid: user.uid });
  await saveUserProfile(user.uid, nick);
  renderProfile();
  updateHomeStatus();
  finishBoot();
  audioEngine.playSound("boot").catch(() => {});

  if (inCallWindow()) {
    // Окно звонка сразу подключается к своей комнате.
    const code = normalizeRoomCode(new URLSearchParams(location.search).get("room"));
    if (!code) {
      closeWindow();
      return;
    }
    await openCall(code);
    return;
  }

  watchRecentCalls();
  await refreshRecentFromCache();

  const params = new URLSearchParams(location.search);
  const invited = normalizeRoomCode(params.get("room"));
  if (invited) {
    history.replaceState({}, "", location.pathname);
    await handleInvite(invited);
  }
}

async function runBootSplash() {
  const stage = $("#bootStage");
  const bar = $("#winSplash .progress");
  const fill = $("#winSplash .progress-fill");
  const splash = $("#winSplash");
  if (bar) {
    bar.classList.remove("indeterminate");
    bar.classList.add("determinate");
  }
  const steps = [
    { key: "boot.stage1", value: 18, delay: 260 },
    { key: "boot.stage2", value: 42, delay: 300 },
    { key: "boot.stage3", value: 64, delay: 260 },
    { key: "boot.stage4", value: 86, delay: 240 },
  ];
  const remembered = rememberedUid();
  for (const step of steps) {
    if (stage) stage.textContent = t(step.key);
    if (fill) fill.style.setProperty("--p", `${step.value}%`);
    void splash;
    await sleep(step.delay);
  }
  if (stage && remembered) stage.textContent = t("boot.stage3");
}

function finishBoot() {
  const splash = $("#winSplash");
  const fill = $("#winSplash .progress-fill");
  if (fill) fill.style.setProperty("--p", "100%");
  if (splash) {
    splash.classList.add("done");
    setTimeout(() => splash.remove(), 360);
  }
  document.body.classList.remove("is-booting");
  wm?.focus("home");
  state.booted = true;
}

function showFatal(err) {
  openModal({
    title: t("err.title"),
    icon: "i-warn",
    dismissible: false,
    body: el("p", { text: errorText(err) }),
    buttons: [{ label: t("common.retry"), onClick: () => location.reload() }],
  });
}

function askNickname({ first = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const wrap = document.createElement("div");
    wrap.append(el("p", { text: t("modal.welcome.text") }));

    const field = el("div", { class: "field" });
    const id = "nickInput";
    field.append(el("label", { for: id, text: t("modal.welcome.nick") }));
    const input = el("input", {
      class: "input",
      id,
      maxlength: "24",
      autocomplete: "off",
      value: state.nick || suggestNick(),
    });
    const error = el("small", { class: "form-error" });
    field.append(input, el("small", { text: t("modal.welcome.nickHint") }), error);
    wrap.append(field);

    openModal({
      title: t("modal.welcome.title"),
      icon: "i-user",
      body: wrap,
      dismissible: !first,
      buttons: [
        {
          label: t("modal.welcome.start"),
          onClick: () => {
            const nick = sanitizeNick(input.value);
            if (!nick) {
              error.textContent = t("modal.welcome.err");
              input.focus();
              return false;
            }
            done(nick);
          },
        },
      ],
      onClose: () => done(null),
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 40);
  });
}

async function authenticate(nick) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await signInLocal(nick);
    } catch (err) {
      const retry = await new Promise((resolve) => {
        let answered = false;
        openModal({
          title: t("err.title"),
          icon: "i-warn",
          dismissible: false,
          body: el("p", { text: errorText(err) }),
          buttons: [
            {
              label: t("common.retry"),
              onClick: () => {
                answered = true;
                resolve(true);
              },
            },
          ],
          onClose: () => {
            if (!answered) resolve(false);
          },
        });
      });
      if (!retry) throw err;
    }
  }
  throw new AppError("auth", { host: location.host });
}

/* =========================================================================
   Профиль и история
   ========================================================================= */

function renderProfile() {
  const nick = state.nick || "…";
  $("#homeNick").textContent = nick;
  $("#homeUid").textContent = state.uid ? `ID ${state.uid.slice(0, 12)}` : t("home.status.local");
  const avatar = $("#homeAvatar");
  avatar.textContent = initials(nick);
  avatar.style.background = colorFor(state.uid || nick);
}

function updateHomeStatus(extra = "") {
  const status = $("#homeStatus");
  if (!status) return;
  if (!state.authOk) {
    status.textContent = t("home.status.local");
    return;
  }
  status.textContent = extra || `${t("home.ready")} · ${t("home.status.local")}`;
}

async function updateMicCell() {
  const cell = $("#homeMicState");
  if (!cell) return;
  if (audioEngine.stream) cell.textContent = t("home.mic.ok");
  else if (audioEngine.micBlocked) cell.textContent = t("home.mic.denied");
  else cell.textContent = t("home.mic.none");
}

function watchRecentCalls() {
  if (state.recentUnsub) state.recentUnsub();
  state.recentUnsub = watchRecent(
    state.uid,
    (data, err) => {
      if (err) {
        state.recent = {};
        renderRecent([], err);
        return;
      }
      state.recent = data || {};
      refreshRecentFromCache();
    }
  );
}

async function refreshRecentFromCache() {
  const entries = Object.values(state.recent || {})
    .filter((entry) => entry && entry.code)
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
    .slice(0, APP.maxRecent);

  if (!entries.length) {
    renderRecent([], null);
    return;
  }

  state.recentLoading = true;
  showRecentProgress(true);
  const infos = await Promise.all(
    entries.map(async (entry) => {
      const room = await roomSnapshot(entry.code);
      if (!room || room.error) return { entry, live: 0, exists: false };
      const participants = room.participants ? Object.keys(room.participants).length : 0;
      return { entry, live: participants, exists: true };
    })
  );
  state.recentLoading = false;
  showRecentProgress(false);
  renderRecent(infos, null);
}

function showRecentProgress(show) {
  let bar = $("#homeRecentProgress");
  const list = $("#recentList");
  if (!list) return;
  if (show && !bar) {
    bar = el("div", { class: "progress indeterminate home-progress", id: "homeRecentProgress" });
    bar.append(el("div", { class: "progress-fill" }));
    list.before(bar);
  } else if (!show && bar) {
    bar.remove();
  }
}

function renderRecent(infos, err) {
  const list = $("#recentList");
  if (!list) return;
  list.textContent = "";
  const keepSelection = state.selectedCode;
  state.selectedCode = "";
  updateRecentButtons();

  if (err) {
    list.append(
      el("div", { class: "empty-state" }, [
        el("b", { text: t("recent.loadError") }),
        el("span", { text: errorText(err) }),
      ])
    );
    return;
  }

  if (!infos.length) {
    list.append(
      el("div", { class: "empty-state" }, [
        el("b", { text: t("recent.empty.title") }),
        el("span", { text: t("recent.empty.text") }),
      ])
    );
    return;
  }

  for (const info of infos) {
    const { entry, live, exists } = info;
    const row = el("div", { class: "list-row", dataset: { code: entry.code }, tabindex: "0" });
    row.append(svgUse("i-phone", "btn-ico"));
    row.append(el("b", { text: entry.code }));
    row.append(el("span", { class: "dim recent-time", text: formatDate(entry.lastAt || Date.now()) }));

    const badge = el("span", {
      class: `recent-badge ${exists && live > 0 ? "live" : "dead"}`,
      text: !exists
        ? t("recent.gone")
        : live > 0
        ? `${t("recent.live")} · ${t("recent.members", { n: live, max: APP.maxParticipants })}`
        : t("recent.empty"),
    });
    row.append(badge);

    row.addEventListener("click", () => selectRecent(entry.code));
    row.addEventListener("dblclick", () => joinRecent(entry.code));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        joinRecent(entry.code);
      }
    });
    list.append(row);
  }

  if (keepSelection && infos.some((info) => info.entry.code === keepSelection)) {
    selectRecent(keepSelection);
  }
}

function selectRecent(code) {
  state.selectedCode = code;
  $$("#recentList .list-row").forEach((row) => {
    row.classList.toggle("sel", row.dataset.code === code);
  });
  updateRecentButtons();
}

function updateRecentButtons() {
  const has = Boolean(state.selectedCode);
  const join = $("#btnJoinSelected");
  const del = $("#btnDeleteRecent");
  if (join) join.disabled = !has;
  if (del) del.disabled = !has;
}

async function joinRecent(code) {
  if (!code) return;
  selectRecent(code);
  await joinRoom(code, { source: "recent" });
}

async function deleteSelectedRecent() {
  if (!state.selectedCode) return;
  const code = state.selectedCode;
  try {
    await removeRecent(state.uid, code);
    state.selectedCode = "";
    toast({ title: t("toast.recentDeleted"), icon: "i-trash" });
  } catch (err) {
    toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
  }
}

/* =========================================================================
   Комнаты и звонок
   ========================================================================= */

async function generateFreeCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomRoomCode();
    const room = await roomSnapshot(code);
    if (!room || room.error) return code;
  }
  return randomRoomCode();
}

/**
 * В браузере звонок открывается внутри «рабочего стола»,
 * в обёртке — отдельным настоящим окном с тем же номером комнаты.
 */
async function startCall(code) {
  if (isDesktop) {
    const ok = await openCallWindow(code, { nick: state.nick });
    if (!ok) {
      toast({
        title: t("err.title"),
        text: t("err.callFailed"),
        icon: "i-warn",
        tone: "error",
      });
      return false;
    }
    if (state.uid) {
      touchRecent(state.uid, code, { nick: state.nick, joinedAt: Date.now() }).catch(() => {});
    }
    audioEngine.playSound("join").catch(() => {});
    return true;
  }
  await openCall(code);
  return true;
}

async function createCall() {
  if (!ensureReady()) return;
  if (state.session) {
    await hangup({ silent: true });
  }
  const code = await generateFreeCode();
  await startCall(code);
}

async function joinRoom(code, { source = "manual", prompted = false } = {}) {
  if (!ensureReady()) return;
  const room = await roomSnapshot(code);

  if (room && room.error) {
    toast({ title: t("err.title"), text: errorText(room.error), icon: "i-warn", tone: "error" });
    return;
  }

  if (!room) {
    if (source === "recent") {
      toast({ title: t("toast.noRoom"), icon: "i-info" });
    } else if (!prompted) {
      const create = await new Promise((resolve) => {
        let answered = false;
        openModal({
          title: t("modal.notfound.title"),
          icon: "i-warn",
          body: el("p", { text: t("modal.notfound.text", { code }) }),
          buttons: [
            {
              label: t("modal.notfound.create"),
              onClick: () => {
                answered = true;
                resolve(true);
              },
            },
            {
              label: t("common.cancel"),
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
      });
      if (!create) return;
    }
  }

  if (state.session) {
    await hangup({ silent: true });
  }
  await startCall(code);
}

function ensureReady() {
  if (!state.authOk || !state.uid) {
    toast({
      title: t("err.title"),
      text: t("err.auth", { host: location.host }),
      icon: "i-warn",
      tone: "error",
    });
    return false;
  }
  return true;
}

async function openCall(code) {
  state.activeCode = code;
  state.selectedCode = "";
  callView.reset({ code, me: { uid: state.uid, nick: state.nick } });
  wm.open("call");
  wm.focus("call");
  document.body.classList.add("in-call");
  document.title = t("call.title", { code });
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  history.replaceState({}, "", url);

  // TURN-креды подписываются в браузере (WebCrypto), поэтому набор
  // ICE-серверов получаем заранее. При сбое подписи звонок не ломается:
  // остаются STUN и запасные серверы.
  let ice = null;
  try {
    ice = await resolveIceServers();
  } catch (err) {
    ice = { servers: null, turn: "none", reason: err?.message || "resolve-failed" };
  }
  if (ice?.turn === "none") {
    callView.log(`TURN: ${ice.reason || "недоступен"}`, "warn");
  }

  const diagnostics = new CallDiagnostics({
    code,
    uid: state.uid,
    nick: state.nick,
    ice,
  });

  const session = new CallSession({
    code,
    me: { uid: state.uid, nick: state.nick },
    audio: audioEngine,
    iceServers: ice?.servers || undefined,
    diagnostics,
    handlers: {
      onLog: (text, tone) => callView.log(text, tone),
      // Прямой канал не установился и relay-кандидатов нет: почти наверняка
      // TURN недоступен или сеть блокирует UDP. Объясняем это человеку.
      onIceProblem: ({ peer } = {}) => {
        if (state.session?.iceHintShown) return;
        if (state.session) state.session.iceHintShown = true;
        toast({
          title: t("err.iceTitle"),
          text: t("err.iceText", { peer: peer || "" }),
          icon: "i-warn",
          tone: "error",
        });
        // Автоматически отправляем подробный отчёт в базу, чтобы понять
        // причину: какие кандидаты собрались и что ответил TURN.
        sendDiagnostics({ auto: true });
      },
      onProgress: ({ key, params }) => {
        // «Все на связи» приходит сразу после onPeerConnected, то есть уже
        // после finishProgress. Если снова показать полосу, она останется
        // висеть: новых событий прогресса по этой комнате больше не будет.
        if (key === "call.progress.peers") {
          const total = params?.total || 0;
          const connected = params?.n || 0;
          if (!total) return;
          if (connected >= total) {
            callView.finishProgress();
            return;
          }
          // Новый участник ещё подключается — полосу показываем заново.
          callView.showProgress(t(key, params), { force: true });
          callView.setProgress({
            key,
            params,
            indeterminate: false,
            value: 45 + Math.round((connected / total) * 50),
          });
          return;
        }
        callView.showProgress(t(key, params));
      },
      onParticipants: (participants) => {
        callView.renderParticipants(participants);
        updateCallWindowTitle();
      },
      onPeer: (uid, info) => callView.setPeerState(uid, info),
      onPeerGone: (uid) => callView.removePeerTile(uid),
      onPeerConnected: () => {
        audioEngine.playSound("message").catch(() => {});
        callView.startTimer();
        const sessionNow = state.session;
        if (sessionNow) {
          const others = Math.max(0, Object.keys(sessionNow.participants).length - 1);
          const connected = Array.from(sessionNow.peers.values()).filter(
            (peer) => peer.pc.connectionState === "connected"
          ).length;
          if (others > 0 && connected >= others) callView.finishProgress();
        }
      },
      onStream: () => {},
      onSelfStream: () => updateMicCell(),
      onParticipantJoined: (uid, nick) => {
        toast({ title: t("call.joined", { nick: nick || "…" }), icon: "i-users" });
        audioEngine.playSound("message").catch(() => {});
      },
      onParticipantLeft: (uid, nick) => {
        toast({ title: t("call.left", { nick: nick || "…" }), icon: "i-users" });
        callView.log(t("call.left", { nick: nick || "…" }), "warn");
      },
      onRoomGone: () => {
        callView.log("room is gone", "err");
        toast({ title: t("err.title"), text: t("err.room"), icon: "i-warn", tone: "error" });
        hangup({ silent: true });
      },
      onError: (err) => {
        toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
      },
      onStateChange: () => callView.updateStatus(),
      onClosed: () => {},
    },
  });

  state.session = session;

  // Файлы живут в той же комнате: watch() подписывается на rooms/{code}/files.
  const files = new RoomFiles({
    code,
    me: { uid: state.uid, nick: state.nick },
    diagnostics,
    onList: (list) => handleFilesList(list),
    onNew: (entry) => {
      callView.log(t("files.log.incoming", { nick: entry.nick || "…", name: entry.name }), "ok");
      toast({
        title: t("files.incoming", { nick: entry.nick || "…" }),
        text: `${entry.name} · ${formatSize(entry.size)}`,
        icon: "i-folder",
      });
      audioEngine.playSound("message").catch(() => {});
    },
    onError: () => callView.log(t("files.err.watch"), "warn"),
  });
  state.files = files;
  state.filesList = [];
  updateFilesBadge();
  files.watch();

  // Чат комнаты: короткие сообщения на случай, когда микрофон недоступен
  // или говорить неудобно.
  const chat = new RoomChat({
    code,
    me: { uid: state.uid, nick: state.nick },
    diagnostics,
    onList: (list) => renderChat(list),
    onNew: (message) => {
      if (state.chatOpen) return;
      state.chatUnread += 1;
      updateChatBadge();
      audioEngine.playSound("message").catch(() => {});
    },
    onError: () => callView.log(t("chat.err.watch"), "warn"),
  });
  state.chat = chat;
  state.chatUnread = 0;
  chat.watch();
  renderChat([]);
  updateChatBadge();

  try {
    await session.join();
    callView.startTimer();
    callView.finishProgress();
    callView.setMicState(audioEngine.muted);
    updateMicCell();
    await touchRecent(state.uid, code, {
      nick: state.nick,
      joinedAt: Date.now(),
    });
    audioEngine.playSound("join").catch(() => {});
    toast({
      title: t("toast.joinTitle", { code }),
      text: t("toast.joinText"),
      icon: "i-phone",
    });
    if (!audioEngine.stream) {
      toast({
        title: t("err.title"),
        text: t("err.mic"),
        icon: "i-warn",
        tone: "error",
        timeout: 6500,
      });
    }
  } catch (err) {
    callView.log(errorText(err), "err");
    const failed = state.session;
    state.session = null;
    await failed?.leave().catch(() => {});
    document.body.classList.remove("in-call");
    wm.close("call");
    document.title = t("app.name");
    const url2 = new URL(location.href);
    url2.searchParams.delete("room");
    history.replaceState({}, "", url2);

    const closeAfterModal = () => {
      if (inCallWindow()) closeWindow();
    };

    if (err instanceof AppError && err.code === "full") {
      openModal({
        title: t("modal.full.title"),
        icon: "i-warn",
        body: el("p", { text: t("modal.full.text", { code, max: APP.maxParticipants }) }),
        buttons: [{ label: t("common.close"), onClick: () => {} }],
        onClose: closeAfterModal,
      });
    } else if (err instanceof AppError && err.code === "mic") {
      const listenOnly = await new Promise((resolve) => {
        let answered = false;
        openModal({
          title: t("err.title"),
          icon: "i-warn",
          body: el("p", { text: errorText(err) }),
          buttons: [
            { label: t("common.retry"), onClick: () => { answered = true; resolve("retry"); } },
            { label: t("common.cancel"), onClick: () => { answered = true; resolve(null); } },
          ],
          onClose: () => {
            if (!answered) resolve(null);
            closeAfterModal();
          },
        });
      });
      if (listenOnly === "retry") await audioEngine.acquire(getPreferredMic()).catch(() => {});
    } else {
      toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
      closeAfterModal();
    }
    if (!isDesktop) refreshRecentFromCache();
  }
}

function updateCallWindowTitle() {
  const title = $("#callTitle");
  if (title && state.activeCode) title.textContent = t("call.title", { code: state.activeCode });
  wm?.syncTasks();
}

async function hangup({ silent = false } = {}) {
  const session = state.session;
  state.session = null;
  // Подписки снимаем сразу: комната сейчас закроется.
  state.files?.stop();
  state.files = null;
  state.filesList = [];
  filesUi = null;
  updateFilesBadge();

  state.chat?.stop();
  state.chat = null;
  state.chatOpen = false;
  state.chatUnread = 0;
  closeChatPanel();
  state.activeCode = "";
  callView.stop();
  wm?.close("call");
  document.body.classList.remove("in-call");
  document.title = t("app.name");
  const url = new URL(location.href);
  if (url.searchParams.has("room")) {
    url.searchParams.delete("room");
    history.replaceState({}, "", url);
  }
  if (session) {
    await session.leave().catch(() => {});
  }
  audioEngine.stopLocal();
  audioEngine.detachAllRemote();
  updateMicCell();
  if (!silent) {
    toast({ title: t("toast.leftTitle"), text: t("toast.leftText", { code: session?.code || "" }), icon: "i-phone" });
    audioEngine.playSound("leave").catch(() => {});
  }
  if (!isDesktop) refreshRecentFromCache();

  // Окно звонка в обёртке закрывается вместе с комнатой.
  if (inCallWindow() && !systemClosing) closeWindow();
}

async function handleInvite(code) {
  const answer = await new Promise((resolve) => {
    let answered = false;
    openModal({
      title: t("modal.join.title"),
      icon: "i-phone",
      body: el("div", {}, [
        el("p", { text: t("modal.join.text", { code }) }),
        // В браузере предлагаем открыть приложение, если оно установлено.
        // В обёртке ссылка уже открыта приложением — кнопка не нужна.
        isDesktop ? null : el("p", { class: "modal-hint", text: t("modal.join.hint") }),
      ]),
      buttons: [
        {
          label: t("home.join"),
          onClick: () => {
            answered = true;
            resolve(true);
          },
        },
        ...(isDesktop
          ? []
          : [
              {
                // Система сама выберет приложение, зарегистрированное
                // на схему longcall:// — если его нет, ничего не произойдёт.
                label: t("modal.join.app"),
                onClick: () => {
                  answered = true;
                  resolve(false);
                  location.href = appRoomUrl(code);
                },
              },
            ]),
        {
          label: t("common.cancel"),
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
  });
  if (answer) await joinRoom(code, { source: "invite" });
}

async function copyRoomLink() {
  if (!state.activeCode) return;
  const ok = await copyText(roomUrl(state.activeCode));
  toast({
    title: ok ? t("call.linkCopied") : t("err.title"),
    text: ok ? roomUrl(state.activeCode) : "",
    icon: "i-copy",
    tone: ok ? "info" : "error",
  });
}

/**
 * Отправляет диагностический отчёт в Firebase.
 *
 * Вызывается автоматически при сбое соединения и вручную из меню «Справка».
 * В журнал звонка и в тост попадает короткий код отчёта — по нему легко
 * найти запись в консоли Firebase.
 */
async function sendDiagnostics({ auto = false } = {}) {
  const diagnostics = state.session?.options?.diagnostics;
  if (!diagnostics) {
    if (!auto) toast({ title: t("diag.noneTitle"), text: t("diag.noneText"), icon: "i-info" });
    return null;
  }

  const result = await diagnostics.send({ manual: !auto });
  lastReport = result;

  if (result.ok) {
    const code = result.id || "ok";
    callView.log(t("diag.sent", { id: code }), "ok");
    if (!auto || state.session?.diagnosticsNotified !== true) {
      toast({
        title: t("diag.sentTitle"),
        text: t("diag.sentText", { id: code }),
        icon: "i-copy",
        tone: "info",
      });
      if (state.session) state.session.diagnosticsNotified = true;
    }
  } else {
    callView.log(t("diag.failed", { err: result.error || "" }), "err");
    if (!auto) {
      toast({
        title: t("diag.failedTitle"),
        text: t("diag.failedText", { err: result.error || "" }),
        icon: "i-warn",
        tone: "error",
      });
    }
  }
  return result;
}

/**
 * Передаёт комнату настольному приложению по схеме longcall://.
 * Если приложение не установлено, браузер просто ничего не откроет —
 * звонок остаётся в браузере, поэтому сначала показываем подсказку.
 */
function openInApp() {
  if (!state.activeCode) return;
  const go = () => {
    location.href = appRoomUrl(state.activeCode);
  };
  openModal({
    title: t("call.openAppTitle"),
    icon: "i-phone",
    body: el("p", { text: t("call.openAppHint") }),
    buttons: [
      { label: t("call.openApp"), onClick: go },
      { label: t("common.cancel"), onClick: () => {} },
    ],
  });
}

/* =========================================================================
   Микрофон
   ========================================================================= */

async function toggleMic() {
  const session = state.session;
  if (!session) return;
  try {
    if (!audioEngine.stream) {
      await session.switchMic(getPreferredMic());
      const silent = !audioEngine.muted;
      if (!silent) {
        /* микрофон включён по умолчанию */
      }
    }
    const nextMuted = !audioEngine.muted;
    await session.setMuted(nextMuted);
    callView.setMicState(nextMuted);
    updateMicCell();
    toast({
      title: nextMuted ? t("call.mutedToast") : t("call.unmutedToast"),
      icon: nextMuted ? "i-mic-off" : "i-mic",
      timeout: 1800,
    });
    audioEngine.playSound("toggle").catch(() => {});
  } catch (err) {
    audioEngine.micBlocked = true;
    updateMicCell();
    openModal({
      title: t("err.title"),
      icon: "i-warn",
      body: el("p", { text: errorText(err) }),
      buttons: [{ label: t("common.close"), onClick: () => {} }],
    });
  }
}

/* =========================================================================
   Диалоги
   ========================================================================= */

function openProfile() {
  const wrap = document.createElement("div");
  const field = el("div", { class: "field" });
  field.append(el("label", { for: "profileNick", text: t("modal.profile.nick") }));
  const input = el("input", { class: "input", id: "profileNick", maxlength: "24", value: state.nick });
  const error = el("small", { class: "form-error" });
  field.append(input, error);
  wrap.append(field);

  const uidBlock = el("div", { class: "field" });
  uidBlock.append(el("label", { text: t("modal.profile.uid") }));
  uidBlock.append(el("div", { class: "mono small-dim", text: state.uid || "—" }));
  wrap.append(uidBlock);
  wrap.append(el("p", { class: "small-dim", text: t("modal.profile.hint") }));

  openModal({
    title: t("modal.profile.title"),
    icon: "i-user",
    body: wrap,
    buttons: [
      {
        label: t("common.save"),
        onClick: async () => {
          const nick = sanitizeNick(input.value);
          if (!nick) {
            error.textContent = t("err.nick");
            return false;
          }
          state.nick = nick;
          saveProfile({ nick, uid: state.uid });
          await saveUserProfile(state.uid, nick);
          if (state.session) {
            try {
              await state.session.setNick?.(nick);
            } catch {}
          }
          renderProfile();
          toast({ title: t("toast.profileSaved"), icon: "i-user" });
        },
      },
      { label: t("common.cancel"), onClick: () => {} },
    ],
  });
}

async function openSettings() {
  const wrap = document.createElement("div");

  const micField = el("div", { class: "field" });
  micField.append(el("label", { for: "micSelect", text: t("modal.settings.mic") }));
  const select = el("select", { class: "input", id: "micSelect" });
  const hint = el("small", { class: "small-dim", text: t("modal.settings.hint") });
  micField.append(select, hint);
  wrap.append(micField);

  const levelField = el("div", { class: "field" });
  levelField.append(el("label", { text: t("modal.settings.level") }));
  const meter = el("div", { class: "meter" });
  const segments = [];
  for (let i = 0; i < 14; i++) {
    const seg = el("i");
    meter.append(seg);
    segments.push(seg);
  }
  levelField.append(meter);
  const testBtn = el("button", { type: "button", class: "btn btn-sm", text: t("modal.settings.test") });
  const testRow = el("div", { class: "row" }, [testBtn]);
  levelField.append(testRow);
  wrap.append(levelField);

  const sounds = el("label", { class: "checkbox" });
  const soundsInput = el("input", { type: "checkbox" });
  soundsInput.checked = getSoundsEnabled();
  sounds.append(soundsInput, el("span", { class: "box" }), el("span", { text: t("modal.settings.sounds") }));
  wrap.append(sounds);

  const langField = el("div", { class: "field" });
  langField.append(el("label", { for: "langSelect", text: t("modal.settings.lang") }));
  const langSelect = el("select", { class: "input", id: "langSelect" });
  langSelect.append(el("option", { value: "ru", text: "Русский" }));
  langSelect.append(el("option", { value: "en", text: "English" }));
  langSelect.value = getLang();
  langField.append(langSelect);
  wrap.append(langField);

  let testing = false;
  let testStream = null;
  let raf = 0;

  const stopMeter = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const startMeter = () => {
    stopMeter();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const level = audioEngine.readLevel("self");
      const lit = Math.round(level * segments.length);
      segments.forEach((seg, index) => {
        seg.style.transform = index < lit ? "scaleY(1)" : "scaleY(0.06)";
      });
    };
    raf = requestAnimationFrame(tick);
  };

  async function fillDevices() {
    const devices = await audioEngine.listInputs();
    const current = audioEngine.deviceId || getPreferredMic();
    select.textContent = "";
    select.append(el("option", { value: "", text: t("modal.settings.micDefault") }));
    devices.forEach((device, index) => {
      const label = device.label || `${t("modal.settings.mic")} ${index + 1}`;
      select.append(el("option", { value: device.deviceId, text: label }));
    });
    select.value = current && devices.some((d) => d.deviceId === current) ? current : "";
  }

  const api = openModal({
    title: t("modal.settings.title"),
    icon: "i-gear",
    body: wrap,
    buttons: [{ label: t("common.ok"), onClick: () => {} }],
    onClose: () => {
      stopMeter();
      testStream?.getTracks().forEach((track) => track.stop());
      testStream = null;
      state.settingsApi = null;
    },
  });
  state.settingsApi = api;

  soundsInput.addEventListener("change", () => {
    setSoundsEnabled(soundsInput.checked);
    updateSoundUI();
    if (soundsInput.checked) audioEngine.playSound("message").catch(() => {});
  });

  langSelect.addEventListener("change", () => {
    setLang(langSelect.value);
  });

  select.addEventListener("change", async () => {
    const value = select.value;
    setPreferredMic(value);
    try {
      if (state.session) {
        await state.session.switchMic(value);
      } else {
        await audioEngine.acquire(value);
      }
      audioEngine.micBlocked = false;
      updateMicCell();
      await fillDevices();
    } catch (err) {
      audioEngine.micBlocked = true;
      updateMicCell();
      hint.textContent = errorText(err);
    }
  });

  testBtn.addEventListener("click", async () => {
    if (testing) {
      testing = false;
      testBtn.textContent = t("modal.settings.test");
      stopMeter();
      if (testStream) {
        testStream.getTracks().forEach((track) => track.stop());
        testStream = null;
      }
      if (!state.session) audioEngine.stopLocal();
      updateMicCell();
      return;
    }
    try {
      testStream = await navigator.mediaDevices.getUserMedia({
        audio: select.value ? { deviceId: { exact: select.value } } : true,
        video: false,
      });
      audioEngine.ensureMeter("self", testStream);
      audioEngine.ensureContext();
      testing = true;
      testBtn.textContent = t("modal.settings.stopTest");
      startMeter();
      hint.textContent = t("modal.settings.hint");
    } catch (err) {
      hint.textContent = errorText(err);
    }
  });

  // Разрешение нужно, чтобы получить названия устройств.
  try {
    if (!audioEngine.stream) await audioEngine.acquire(getPreferredMic());
    audioEngine.micBlocked = false;
  } catch (err) {
    audioEngine.micBlocked = true;
    hint.textContent = errorText(err);
  }
  await fillDevices();
  updateMicCell();
  if (audioEngine.stream) startMeter();

  api.body.addEventListener("keydown", (event) => {
    if (event.key === "Escape") api.close();
  });
}

function openParticipants() {
  if (!state.session) {
    toast({ title: t("modal.participants.empty"), icon: "i-users" });
    return;
  }
  const parts = state.session.participants || {};
  const wrap = document.createElement("div");
  wrap.append(
    el("p", {
      class: "small-dim",
      text: t("modal.participants.count", {
        n: Object.keys(parts).length,
        max: APP.maxParticipants,
      }),
    })
  );

  const entries = [
    [state.uid, { nick: state.nick, muted: audioEngine.muted }],
    ...Object.entries(parts).filter(([uid]) => uid !== state.uid),
  ];

  for (const [uid, data] of entries) {
    const row = el("div", { class: "participant-line" });
    const avatar = el("div", { class: "avatar", text: initials(data?.nick || "?") });
    avatar.style.background = colorFor(uid);
    row.append(avatar);
    const info = el("div", { class: "grow" });
    info.append(el("b", { text: data?.nick || "…" }));
    if (uid === state.uid) info.append(el("span", { class: "dim", text: ` · ${t("common.you")}` }));
    row.append(info);

    const muted = uid === state.uid ? audioEngine.muted : Boolean(data?.muted);
    const mic = el("span", { class: `mic-ind ${muted ? "off" : ""}` });
    mic.append(svgUse(muted ? "i-mic-off" : "i-mic"));
    row.append(mic);
    wrap.append(row);
  }

  openModal({
    title: t("modal.participants.title"),
    icon: "i-users",
    body: wrap,
    buttons: [{ label: t("common.close"), onClick: () => {} }],
  });
}

/* ============================ файлы в звонке ============================ */

function updateFilesBadge() {
  const badge = $("#filesBadge");
  const count = (state.filesList || []).length;
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
  }
  const btn = $("#btnFiles");
  if (btn) {
    btn.title = count
      ? t("files.count", { n: count, max: APP.files.maxFiles })
      : t("files.title");
    btn.classList.toggle("has-files", count > 0);
  }
}

function handleFilesList(list) {
  state.filesList = Array.isArray(list) ? list : [];
  updateFilesBadge();
  filesUi?.rerender();
}

function fileTime(at) {
  if (!at) return "";
  return new Date(at).toLocaleTimeString(getLang() === "ru" ? "ru-RU" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Иконка для типа файла: видео, звук, текст или обычный документ. */
function fileIcon(entry) {
  const kind = previewKind(entry);
  if (kind === "image") return "i-image";
  if (kind === "video") return "i-film";
  if (kind === "audio") return "i-music";
  if (kind === "text") return "i-text";
  return "i-notepad";
}

/**
 * Просмотр файла прямо в звонке: mp4/webm — плеером, mp3/wav — плеером,
 * текст — в моноширинном окне. Остальные типы только скачиваются.
 */
async function openPreview(entry) {
  const files = state.files;
  if (!files) return;

  const kind = previewKind(entry);
  if (!kind) {
    toast({ title: t("err.title"), text: t("err.fileNoPreview"), icon: "i-warn", tone: "error" });
    return;
  }

  const holder = el("div", { class: "preview-body" });
  holder.append(el("p", { class: "small-dim", text: t("files.preview.loading") }));

  let dispose = () => {};
  let media = null;

  const api = openModal({
    title: t("files.preview.title"),
    icon: fileIcon(entry),
    body: holder,
    width: "480px",
    buttons: [
      {
        label: t("files.download"),
        busy: false,
        onClick: async () => {
          try {
            await files.download(entry);
          } catch (err) {
            toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
          }
          return false; // окно просмотра не закрываем
        },
      },
      { label: t("files.close"), onClick: () => {} },
    ],
    onClose: () => {
      // Останавливаем звук и отпускаем blob-URL, иначе файл висит в памяти.
      try {
        media?.pause?.();
      } catch {}
      dispose();
      dispose = () => {};
    },
  });

  try {
    const data = await files.preview(entry);
    dispose = data.dispose;
    holder.textContent = "";

    const head = el("div", { class: "preview-head" });
    const nameEl = el("div", { class: "file-name", text: data.name, title: data.name });
    head.append(nameEl);
    head.append(
      el("div", {
        class: "small-dim",
        text: [formatSize(data.size), entry.nick || "", fileTime(entry.at)].filter(Boolean).join(" · "),
      })
    );
    holder.append(head);

    if (data.kind === "image") {
      const figure = el("div", { class: "preview-figure" });
      const img = el("img", { class: "preview-image", alt: data.name });
      img.src = data.url;
      figure.append(img);
      holder.append(figure);

      const note = el("p", { class: "small-dim", text: t("files.preview.loading") });
      holder.append(note);

      // Размеры показываем только когда картинка реально загрузилась:
      // до этого naturalWidth равен нулю.
      img.addEventListener("load", () => {
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        note.textContent = w && h
          ? t("files.preview.dimensions", { w, h })
          : t("files.preview.imageHint");
      });
      img.addEventListener("error", () => {
        figure.classList.add("broken");
        note.textContent = t("files.preview.imageBroken");
        note.classList.remove("small-dim");
        note.classList.add("preview-error");
      });
    } else if (data.kind === "video" || data.kind === "audio") {
      media = el(data.kind === "video" ? "video" : "audio", {
        class: `preview-media preview-${data.kind}`,
        controls: "",
        preload: "metadata",
        playsinline: "",
      });
      media.src = data.url;
      holder.append(media);
      holder.append(
        el("p", {
          class: "small-dim",
          text: data.kind === "video" ? t("files.preview.videoHint") : t("files.preview.audioHint"),
        })
      );
    } else {
      const text = String(data.text || "");
      if (!text.trim()) {
        holder.append(el("p", { class: "small-dim", text: t("files.preview.empty") }));
      } else {
        holder.append(el("pre", { class: "preview-text", text }));
      }
      if (data.encoding && data.encoding !== "utf-8") {
        holder.append(
          el("p", { class: "small-dim", text: t("files.preview.encoding", { enc: data.encoding }) })
        );
      }
      if (data.truncated) {
        holder.append(
          el("p", {
            class: "small-dim",
            text: t("files.preview.truncated", {
              shown: formatSize(data.shown),
              total: formatSize(data.size),
            }),
          })
        );
      }
    }
  } catch (err) {
    api.close();
    toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
  }
}

/** Строка списка файлов: имя, размер, отправитель, «Просмотр», «Скачать», «Удалить». */
function fileRow(entry) {
  const row = el("div", { class: "file-row" });

  const kind = previewKind(entry);
  const ico = el("span", { class: `file-ico kind-${kind || "file"}` });
  ico.append(svgUse(fileIcon(entry)));
  row.append(ico);

  const info = el("div", { class: "file-info grow" });
  const nameEl = el("div", {
    class: kind ? "file-name is-previewable" : "file-name",
    text: entry.name,
    title: kind ? t("files.preview.open", { name: entry.name }) : entry.name,
  });
  if (kind) {
    nameEl.addEventListener("click", () => openPreview(entry));
  }
  info.append(nameEl);
  const meta = [formatSize(entry.size), entry.nick || "…", fileTime(entry.at)]
    .filter(Boolean)
    .join(" · ");
  info.append(el("div", { class: "small-dim", text: meta }));
  row.append(info);

  const actions = el("div", { class: "file-actions" });

  if (kind) {
    const view = el("button", { type: "button", class: "btn btn-sm", text: t("files.view") });
    view.addEventListener("click", () => openPreview(entry));
    actions.append(view);
  }

  const save = el("button", { type: "button", class: "btn btn-sm", text: t("files.download") });
  save.addEventListener("click", async () => {
    if (!state.files) return;
    save.disabled = true;
    try {
      const name = await state.files.download(entry);
      // null — человек закрыл диалог сохранения, молчим.
      if (name) toast({ title: t("files.downloaded", { name }), icon: "i-folder", timeout: 2600 });
    } catch (err) {
      toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
    } finally {
      save.disabled = false;
    }
  });
  actions.append(save);

  // Удалять можно только свои файлы: чужие — собственность отправителя.
  if (entry.from === state.uid) {
    const del = el("button", { type: "button", class: "btn btn-sm", text: t("files.remove") });
    del.addEventListener("click", async () => {
      if (!state.files) return;
      const ok = await confirmModal({
        title: t("files.remove"),
        text: t("files.removeAsk", { name: entry.name }),
        okLabel: t("files.remove"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
      try {
        await state.files.removeFile(entry);
        callView.log(t("files.log.removed", { name: entry.name }), "warn");
        toast({ title: t("files.removed"), text: entry.name, icon: "i-folder", timeout: 2400 });
      } catch (err) {
        toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
      }
    });
    actions.append(del);
  }

  row.append(actions);
  return row;
}

/* ============================== чат звонка ============================== */

function updateChatBadge() {
  const count = state.chatUnread || 0;
  const badge = $("#chatBadge");
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
  }
  const btn = $("#btnChat");
  if (btn) {
    btn.title = count ? t("chat.unread", { n: count }) : t("chat.title");
    btn.classList.toggle("on", Boolean(state.chatOpen));
  }
}

function closeChatPanel() {
  state.chatOpen = false;
  $("#callChat")?.classList.add("hidden");
  $("#callBottom")?.classList.remove("chat-open");
  $("#btnChat")?.classList.remove("on");
}

/** Открывает или закрывает панель чата (закрытая панель — журнал звонка). */
function toggleChat(force) {
  // Вне звонка чата нет — кнопка просто ничего не делает.
  if (!state.chat) return;
  const open = typeof force === "boolean" ? force : !state.chatOpen;
  state.chatOpen = open;
  $("#callChat")?.classList.toggle("hidden", !open);
  $("#callBottom")?.classList.toggle("chat-open", open);
  $("#btnChat")?.classList.toggle("on", open);

  if (open) {
    state.chatUnread = 0;
    updateChatBadge();
    renderChat(state.chat.messages || []);
    const list = $("#chatList");
    if (list) list.scrollTop = list.scrollHeight;
    setTimeout(() => $("#chatInput")?.focus(), 30);
  }
}

/** Перерисовывает список сообщений. Живёт только в окне звонка. */
function renderChat(list) {
  const root = $("#chatList");
  if (!root) return;
  const messages = Array.isArray(list) ? list : [];
  const lang = getLang();
  root.textContent = "";

  if (!messages.length) {
    root.append(el("div", { class: "chat-empty", text: t("chat.empty") }));
    return;
  }

  for (const message of messages.slice(-APP.chat.maxMessages)) {
    const row = el("div", {
      class: `chat-msg${message.from === state.uid ? " chat-mine" : ""}`,
    });
    row.append(el("span", { class: "chat-time", text: shortTime(message.at, lang) }));
    row.append(el("span", { class: "chat-nick", text: message.from === state.uid ? t("common.you") : message.nick || "…" }));
    row.append(el("span", { class: "chat-text", text: message.text }));
    root.append(row);
  }
  root.scrollTop = root.scrollHeight;
}

async function sendChatMessage() {
  const input = $("#chatInput");
  const chat = state.chat;
  if (!input || !chat) return;
  const text = cleanMessage(input.value);
  if (!text) return;
  input.value = "";
  try {
    await chat.send(text);
  } catch (err) {
    if (err?.code === "chatTooFast") {
      // Не теряем текст: возвращаем его в поле, чтобы человек отправил снова.
      if (!input.value) input.value = text;
      toast({ title: t("chat.tooFast"), icon: "i-warn", tone: "error", timeout: 2200 });
      return;
    }
    toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
  }
}

/* ========================== своё оформление (css) ======================= */

/** Ставит пользовательский css в <style id="userCss"> — поверх стилей приложения. */
function applyUserCss(css) {
  const node = document.getElementById("userCss");
  if (node) node.textContent = css || "";
}

/** Грубая проверка: чаще всего ломаются именно скобки. */
function cssLooksBalanced(css) {
  let depth = 0;
  for (const char of String(css || "")) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

const CSS_SAMPLE = `/* Пример: тёмное оформление окна звонка */
.win-call { background: #222; color: #ddd; }
.win-call .call-log, .win-call .chat-list { background: #111; color: #cfc; }`;

function openCustomCss() {
  const wrap = document.createElement("div");

  const hint = el("p", { class: "modal-hint", text: t("css.hint") });

  const area = el("textarea", {
    class: "input css-editor",
    id: "cssEditor",
    rows: "9",
    spellcheck: "false",
  });
  area.value = getCustomCss();
  area.placeholder = t("css.placeholder");

  const note = el("small", { class: "small-dim", text: t("css.note") });

  const sampleBtn = el("button", {
    type: "button",
    class: "btn btn-sm",
    text: t("css.sample"),
  });
  sampleBtn.addEventListener("click", () => {
    if (area.value.trim() && !window.confirm(t("css.sampleAsk"))) return;
    area.value = CSS_SAMPLE;
    area.focus();
  });

  wrap.append(hint, area, note, el("div", { class: "row" }, [sampleBtn]));

  const save = (value) => {
    try {
      const text = setCustomCss(value);
      applyUserCss(text);
      toast({
        title: text.trim() ? t("css.saved") : t("css.cleared"),
        icon: "i-gear",
        timeout: 2200,
      });
      return true;
    } catch (err) {
      // Единственный потолок — квота браузера; показываем, сколько не влезло.
      const size = Number(err?.size) || 0;
      toast({
        title: t("css.failed"),
        text: size ? t("css.failedSize", { n: size.toLocaleString(getLang() === "ru" ? "ru-RU" : "en-US") }) : "",
        icon: "i-warn",
        tone: "error",
        timeout: 6000,
      });
      return false;
    }
  };

  openModal({
    title: t("css.title"),
    icon: "i-gear",
    width: "520px",
    body: wrap,
    buttons: [
      {
        label: t("css.apply"),
        onClick: () => {
          const css = area.value;
          if (!cssLooksBalanced(css)) {
            // Не мешаем сохранить, но предупреждаем: браузер молча выбросит такие правила.
            toast({ title: t("css.braces"), icon: "i-warn", tone: "error" });
            return false;
          }
          return save(css);
        },
      },
      {
        label: t("css.clear"),
        onClick: () => save(""),
      },
      { label: t("common.close"), value: "cancel" },
    ],
  });
}

/* ==================== файлы из буфера и перетаскиванием ================= */

let uploadQueue = [];
let uploading = false;

function showUploadBar(text) {
  const bar = $("#uploadBar");
  if (!bar) return;
  bar.classList.remove("hidden");
  const label = $("#uploadText");
  if (label && text) label.textContent = text;
}

function setUploadProgress(percent) {
  const fill = $("#uploadFill");
  if (fill) fill.style.setProperty("--p", `${Math.max(0, Math.min(100, percent))}%`);
}

function hideUploadBar() {
  $("#uploadBar")?.classList.add("hidden");
  setUploadProgress(0);
}

function hasFilePayload(event) {
  const types = event?.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}

/** Достаёт файлы из clipboardData / dataTransfer, не трогая обычный текст. */
function filesFromTransfer(data) {
  if (!data) return [];
  if (data.files && data.files.length) return Array.from(data.files);
  const out = [];
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile?.();
      if (file) out.push(file);
    }
  }
  return out;
}

/**
 * Ставит файлы в очередь и отправляет по одному: одновременно можно
 * загружать только один файл, поэтому очередь честно ждёт предыдущий.
 */
async function uploadFiles(files) {
  if (!state.files) {
    toast({ title: t("err.room"), icon: "i-warn", tone: "error" });
    return;
  }
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;

  uploadQueue.push(...list);
  if (uploading) return;

  uploading = true;
  try {
    while (uploadQueue.length) {
      const file = uploadQueue.shift();
      const problem = state.files.canSend(file);
      if (problem) {
        toast({ title: t("err.title"), text: errorText(problem), icon: "i-warn", tone: "error" });
        continue;
      }
      const name = file.name || t("files.one");
      showUploadBar(t("files.uploading", { name }));
      setUploadProgress(0);
      try {
        const sent = await state.files.send(file, {
          onProgress: ({ sent: done, total }) => {
            const percent = total ? Math.round((done / total) * 100) : 0;
            setUploadProgress(percent);
            showUploadBar(t("files.uploadingProgress", { name, p: percent }));
          },
        });
        callView.log(t("files.log.sent", { name: sent.name }), "ok");
        toast({
          title: t("files.sent"),
          text: `${sent.name} · ${formatSize(sent.size)}`,
          icon: "i-folder",
        });
      } catch (err) {
        if (err?.code === "fileCancelled") {
          toast({ title: t("files.cancelled"), icon: "i-warn", timeout: 2200 });
          uploadQueue = [];
          break;
        }
        toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
      }
    }
  } finally {
    uploading = false;
    uploadQueue = [];
    hideUploadBar();
    const cancel = $("#uploadCancel");
    if (cancel) cancel.disabled = false;
  }
}

/** Ctrl+V с картинкой/файлом и перетаскивание файлов в окно звонка. */
function setupTransfers() {
  document.addEventListener("paste", (event) => {
    if (!state.files) return;
    const files = filesFromTransfer(event.clipboardData);
    // Текст вставляется как обычно: перехватываем только файлы.
    if (!files.length) return;
    event.preventDefault();
    uploadFiles(files);
  });

  let depth = 0;
  const show = () => $("#dropOverlay")?.classList.remove("hidden");
  const hide = () => {
    depth = 0;
    $("#dropOverlay")?.classList.add("hidden");
  };

  window.addEventListener("dragenter", (event) => {
    if (!state.files || !hasFilePayload(event)) return;
    event.preventDefault();
    depth += 1;
    show();
  });
  window.addEventListener("dragover", (event) => {
    if (!state.files || !hasFilePayload(event)) return;
    // Без preventDefault браузер откроет файл вместо отправки.
    event.preventDefault();
    show();
  });
  window.addEventListener("dragleave", (event) => {
    if (!state.files) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0 || event.relatedTarget === null) hide();
  });
  window.addEventListener("drop", (event) => {
    if (!state.files) return;
    const hadFiles = hasFilePayload(event);
    hide();
    if (!hadFiles) return;
    event.preventDefault();
    uploadFiles(filesFromTransfer(event.dataTransfer));
  });

  $("#uploadCancel")?.addEventListener("click", () => {
    state.files?.cancel();
    const btn = $("#uploadCancel");
    if (btn) btn.disabled = true;
  });
}

/** Окно «Файлы звонка»: список, отправка с прогрессом и отменой. */
function openFiles() {
  const files = state.files;
  if (!files) {
    toast({ title: t("err.room"), icon: "i-warn", tone: "error" });
    return;
  }
  if (filesUi) return;

  const hint = el("p", {
    class: "small-dim",
    text: t("files.hint", {
      max: formatSize(APP.files.maxBytes),
      count: APP.files.maxFiles,
    }),
  });
  const listEl = el("div", { class: "file-list" });

  // Прогресс текущей отправки.
  const bar = el("div", { class: "progress determinate" });
  const fill = el("div", { class: "progress-fill" });
  bar.append(fill);
  const statusText = el("span", { class: "progress-text" });
  const cancelBtn = el("button", { type: "button", class: "btn btn-sm", text: t("files.cancel") });
  const uploadBox = el("div", { class: "file-upload hidden" }, [
    bar,
    el("div", { class: "file-upload-row" }, [statusText, cancelBtn]),
  ]);

  const input = el("input", { type: "file", class: "file-input" });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) startUpload(file);
  });

  const wrap = el("div", { class: "files-panel" }, [hint, uploadBox, listEl, input]);

  const rerender = () => {
    listEl.textContent = "";
    const list = state.filesList || [];
    if (!list.length) {
      listEl.append(el("p", { class: "small-dim files-empty", text: t("files.empty") }));
      return;
    }
    for (const entry of list) listEl.append(fileRow(entry));
  };
  rerender();

  const setUploading = (visible, text = "") => {
    uploadBox.classList.toggle("hidden", !visible);
    if (text) statusText.textContent = text;
  };

  const startUpload = async (file) => {
    const problem = files.canSend(file);
    if (problem) {
      toast({ title: t("err.title"), text: errorText(problem), icon: "i-warn", tone: "error" });
      return;
    }
    fill.style.setProperty("--p", "0%");
    setUploading(true, t("files.uploading", { name: file.name }));
    cancelBtn.disabled = false;
    cancelBtn.onclick = () => {
      cancelBtn.disabled = true;
      files.cancel();
    };

    try {
      const sent = await files.send(file, {
        onProgress: ({ sent, total }) => {
          const percent = total ? Math.min(100, Math.round((sent / total) * 100)) : 0;
          fill.style.setProperty("--p", `${percent}%`);
          statusText.textContent = t("files.uploadingProgress", { name: file.name, p: percent });
        },
      });
      callView.log(t("files.log.sent", { name: sent.name }), "ok");
      toast({
        title: t("files.sent"),
        text: `${sent.name} · ${formatSize(sent.size)}`,
        icon: "i-folder",
      });
    } catch (err) {
      if (err?.code === "fileCancelled") {
        toast({ title: t("files.cancelled"), icon: "i-warn", timeout: 2200 });
      } else {
        toast({ title: t("err.title"), text: errorText(err), icon: "i-warn", tone: "error" });
      }
    } finally {
      cancelBtn.onclick = null;
      setUploading(false);
    }
  };

  const api = openModal({
    title: t("files.title"),
    icon: "i-folder",
    body: wrap,
    width: "450px",
    buttons: [
      {
        label: t("files.send"),
        busy: false,
        onClick: () => {
          if (files.busy) {
            toast({ title: t("files.busy"), icon: "i-warn", tone: "error" });
            return false;
          }
          input.click();
          return false;
        },
      },
      { label: t("files.close"), onClick: () => {} },
    ],
    onClose: () => {
      filesUi = null;
    },
  });

  filesUi = {
    rerender,
    refreshLabels() {
      api.setTitle(t("files.title"));
      hint.textContent = t("files.hint", {
        max: formatSize(APP.files.maxBytes),
        count: APP.files.maxFiles,
      });
      cancelBtn.textContent = t("files.cancel");
      rerender();
    },
  };
}

function openAbout() {
  const wrap = document.createElement("div");
  wrap.append(el("p", { text: t("modal.about.p1") }));
  wrap.append(el("p", { text: t("modal.about.p2") }));
  wrap.append(el("p", { text: t("modal.about.p3") }));
  wrap.append(
    el("p", {
      class: "small-dim",
      text: t("modal.about.p4", { v: APP.version, year: new Date().getFullYear() }),
    })
  );
  wrap.append(
    el("p", {
      class: "small-dim",
      text: `${t("call.webHost")} · ${location.host || "localhost"}`,
    })
  );
  openModal({
    title: t("modal.about.title"),
    icon: "i-info",
    body: wrap,
    buttons: [{ label: t("common.ok"), onClick: () => {} }],
  });
}

function openReadme() {
  const wrap = document.createElement("div");
  wrap.append(el("pre", { class: "text-block", text: t("modal.readme.body") }));
  openModal({
    title: t("modal.readme.title"),
    icon: "i-notepad",
    body: wrap,
    buttons: [{ label: t("common.close"), onClick: () => {} }],
  });
}

async function signOutFlow() {
  const ok = await confirmModal({
    title: t("modal.signout.title"),
    text: t("modal.signout.text"),
    okLabel: t("start.signout"),
    icon: "i-power",
  });
  if (!ok) return;
  if (state.session) await hangup({ silent: true });
  state.recentUnsub?.();
  await signOutLocal();
  clearProfile();
  location.reload();
}

/* =========================================================================
   Действия интерфейса
   ========================================================================= */

async function handleAction(action) {
  switch (action) {
    case "profile":
      openProfile();
      break;
    case "settings":
      openSettings();
      break;
    case "signout":
      signOutFlow();
      break;
    case "refresh":
      refreshRecentFromCache();
      break;
    case "toggle-sound": {
      const next = !getSoundsEnabled();
      setSoundsEnabled(next);
      updateSoundUI();
      toast({
        title: next ? t("toast.soundOn") : t("toast.soundOff"),
        icon: next ? "i-sound" : "i-mute",
        timeout: 1800,
      });
      if (next) audioEngine.playSound("message").catch(() => {});
      break;
    }
    case "toggle-lang":
      toggleLang();
      break;
    case "about":
      openAbout();
      break;
    case "readme":
      openReadme();
      break;
    case "copy-link":
      copyRoomLink();
      break;
    case "open-in-app":
      openInApp();
      break;
    case "send-report":
      sendDiagnostics({ auto: false });
      break;
    case "files":
      openFiles();
      break;
    case "chat":
      toggleChat();
      break;
    case "custom-css":
      openCustomCss();
      break;
    case "hangup":
      if (state.session) hangup();
      break;
    default:
      break;
  }
}

function updateSoundUI() {
  const enabled = getSoundsEnabled();
  const check = $("#menuSoundCheck");
  if (check) check.textContent = enabled ? "✓" : "";
  $("#traySound")?.classList.toggle("off", !enabled);
}

function syncLangButtons() {
  const label = getLang().toUpperCase();
  const a = $("#langBtn");
  const b = $("#callLangBtn");
  if (a) a.textContent = label;
  if (b) b.textContent = label;
}

/* =========================================================================
   Каркас: окна, меню, панель задач
   ========================================================================= */

function setupWindowManager() {
  wm = new WindowManager($("#desktop"), $("#taskbarTasks"));

  // В обёртке каждый BrowserWindow показывает ровно одно окно приложения.
  const callOnly = inCallWindow();
  if (callOnly) {
    // В окне звонка главное окно не нужно вовсе.
    $("#winHome")?.classList.add("hidden");
  }

  if (!callOnly) {
    wm.register("home", $("#winHome"), {
      label: () => t("status.tab.home"),
      icon: "i-phone",
      nativeControls: isDesktop,
      onClose: async () => true,
    });
  }

  if (!isDesktop || callOnly) {
    wm.register("call", $("#winCall"), {
      label: () =>
        state.activeCode
          ? t("status.tab.call", { code: state.activeCode })
          : t("call.title", { code: "" }),
      icon: "i-phone",
      nativeControls: isDesktop,
      onClose: async () => {
        if (state.session) await hangup();
        return false;
      },
    });
  }

  wm.activeKey = callOnly ? "call" : "home";
  $("#winHome")?.classList.add("focused");
  $("#winCall")?.classList.add("inactive");
  wm.buildTaskbar();

  // Каркас окна звонка должен быть виден сразу, ещё до подключения к комнате.
  if (callOnly) wm.open("call");
  else wm.focus("home");
}

function setupChrome() {
  initMenus();

  // кнопки «Пуск» и меню
  const startBtn = $("#startBtn");
  const startMenu = $("#startMenu");
  const closeStart = () => startMenu.classList.add("hidden");
  startBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    startMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", (event) => {
    if (startMenu.classList.contains("hidden")) return;
    if (event.target.closest("#startMenu")) return;
    closeStart();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeStart();
  });

  // единый обработчик data-action
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    event.preventDefault();
    closeStart();
    handleAction(target.dataset.action);
  });

  // рабочий стол
  $("#deskIconApp")?.addEventListener("click", () => wm.open("home"));
  $("#deskIconReadme")?.addEventListener("click", openReadme);

  // главное окно
  $("#btnCreateCall")?.addEventListener("click", createCall);
  $("#btnJoinCode")?.addEventListener("click", () => {
    const code = normalizeRoomCode($("#joinCode").value);
    if (!code) {
      toast({ title: t("err.code"), icon: "i-warn", tone: "error" });
      $("#joinCode").focus();
      return;
    }
    joinRoom(code, { source: "manual" });
  });
  $("#joinCode")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("#btnJoinCode").click();
  });
  $("#joinCode")?.addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, APP.roomCodeLength);
  });

  $("#btnJoinSelected")?.addEventListener("click", () => joinRecent(state.selectedCode));
  $("#btnRefreshRecent")?.addEventListener("click", () => refreshRecentFromCache());
  $("#btnDeleteRecent")?.addEventListener("click", deleteSelectedRecent);

  $("#recentList")?.addEventListener("keydown", (event) => {
    const rows = $$("#recentList .list-row");
    if (!rows.length) return;
    const index = rows.findIndex((row) => row.dataset.code === state.selectedCode);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = rows[Math.min(rows.length - 1, index + 1)];
      selectRecent(next.dataset.code);
      next.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = rows[Math.max(0, index - 1)];
      selectRecent(prev.dataset.code);
      prev.scrollIntoView({ block: "nearest" });
    }
  });

  // окно звонка
  $("#btnMic")?.addEventListener("click", toggleMic);
  $("#btnParticipants")?.addEventListener("click", openParticipants);
  $("#btnFiles")?.addEventListener("click", openFiles);
  $("#btnChat")?.addEventListener("click", toggleChat);
  $("#chatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage();
  });
  $("#btnCallSettings")?.addEventListener("click", openSettings);
  $("#btnHangup")?.addEventListener("click", () => hangup());
  $("#btnCopyLink")?.addEventListener("click", copyRoomLink);

  // Кнопка «В приложении» нужна только в браузере: в обёртке комната уже там.
  const openAppBtn = $("#btnOpenApp");
  if (openAppBtn && !isDesktop) {
    openAppBtn.hidden = false;
    openAppBtn.addEventListener("click", openInApp);
  }

  // язык
  $("#langBtn")?.addEventListener("click", () => toggleLang());
  $("#callLangBtn")?.addEventListener("click", () => toggleLang());

  // звук в трее
  $("#traySound")?.addEventListener("click", () => handleAction("toggle-sound"));

  // часы
  const clock = $("#trayClock");
  const tick = () => {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString(getLang() === "ru" ? "ru-RU" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  tick();
  setInterval(tick, 15_000);

  // Ctrl+V / перетаскивание файлов в звонок
  setupTransfers();

  // разблокировка аудиоконтекста первым жестом
  const unlock = () => audioEngine.unlock();
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });

  window.addEventListener("online", () => {
    callView.updateStatus();
    toast({ title: t("toast.reconnected"), icon: "i-info", timeout: 2200 });
  });
  window.addEventListener("offline", () => {
    callView.updateStatus();
    toast({ title: t("toast.reconnecting"), icon: "i-warn", tone: "error", timeout: 3600 });
  });

  window.addEventListener("beforeunload", () => {
    audioEngine.stopLocal();
  });

  if (isDesktop) {
    // Системное закрытие (×, Alt+F4, выход): сначала выходим из комнаты.
    onBeforeClose(async () => {
      systemClosing = true;
      if (state.session) await hangup({ silent: true });
    });
  }

  onLangChange(() => {
    syncLangButtons();
    applyI18n();
    document.title = state.activeCode ? t("call.title", { code: state.activeCode }) : t("app.name");
    if (state.activeCode) updateCallWindowTitle();
    callView.refreshLabels();
    updateFilesBadge();
    filesUi?.refreshLabels();
    updateChatBadge();
    renderChat(state.chat?.messages || []);
    renderProfile();
    updateHomeStatus();
    updateMicCell();
    updateSoundUI();
    renderRecentFromCacheIfReady();
    wm?.syncTasks();
    toast({ title: t("toast.langChanged"), icon: "i-key", timeout: 2000 });
  });
}

function renderRecentFromCacheIfReady() {
  if (!state.authOk) return;
  const entries = Object.values(state.recent || {})
    .filter((entry) => entry && entry.code)
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
    .slice(0, APP.maxRecent);
  if (!entries.length) {
    renderRecent([], null);
    return;
  }
  const infos = entries.map((entry) => ({ entry, live: 0, exists: true }));
  renderRecent(infos, null);
  refreshRecentFromCache();
}

/* =========================================================================
   Старт
   ========================================================================= */

boot().catch((err) => {
  console.error(err);
  finishBoot();
  showFatal(err);
});

// Экспорт для отладки из консоли (не влияет на работу приложения).
window.LongCall = { state, callView, audioEngine };
