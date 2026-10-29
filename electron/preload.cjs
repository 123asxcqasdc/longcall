// Preload: единственный мост между страницей и Electron.
// Наружу отдаём только узкий API — никакого ipcRenderer целиком.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("longcallDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },

  /** Свернуть / развернуть / закрыть текущее окно. */
  windowAction: (action) => ipcRenderer.invoke("desktop:window-action", action),
  isMaximized: () => ipcRenderer.invoke("desktop:is-maximized"),

  /** Открыть комнату в отдельном настоящем окне. */
  openCall: (payload) => ipcRenderer.invoke("desktop:open-call", payload),

  /** Начало/конец перетаскивания окна за заголовок (для Linux/Wayland). */
  dragStart: () => ipcRenderer.send("desktop:drag-start"),
  dragEnd: () => ipcRenderer.send("desktop:drag-end"),

  /** Сохранить файл из звонка через системный диалог. */
  saveFile: (payload) => ipcRenderer.invoke("desktop:save-file", payload),

  /** Сообщить главному процессу, что можно закрывать окно. */
  readyToClose: () => ipcRenderer.send("desktop:ready-to-close"),

  /** Подписка на изменение состояния «развёрнуто». */
  onMaximized: (callback) => {
    const handler = (_event, value) => callback(Boolean(value));
    ipcRenderer.on("desktop:maximized", handler);
    return () => ipcRenderer.removeListener("desktop:maximized", handler);
  },

  /** Окно просят закрыть: даём странице время выйти из комнаты. */
  onBeforeClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("desktop:before-close", handler);
    return () => ipcRenderer.removeListener("desktop:before-close", handler);
  },
});
