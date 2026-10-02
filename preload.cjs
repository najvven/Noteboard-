const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("noteboardAPI", {
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  writeBoardClipboard: (json) => ipcRenderer.invoke("clipboard:write-board", json),
  loadPages: () => ipcRenderer.invoke("storage:get-pages"),
  savePage: (page) => ipcRenderer.invoke("storage:save-page", page),
  deletePage: (pageId) => ipcRenderer.invoke("storage:delete-page", pageId),
  loadPresets: () => ipcRenderer.invoke("storage:get-presets"),
  savePresets: (presets) => ipcRenderer.invoke("storage:save-presets", presets),
  loadSettings: () => ipcRenderer.invoke("storage:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("storage:save-settings", settings),
  openBoardsFolder: () => ipcRenderer.invoke("storage:open-boards-folder"),
  configureWebSession: (payload) => ipcRenderer.invoke("web-session:configure", payload),
  configureWebViewport: (payload) => ipcRenderer.invoke("web-viewport:configure", payload),
  getWebHostZoom: () => webFrame.getZoomFactor(),
  enterWebFullscreen: (guestId) => ipcRenderer.invoke('web-view:fullscreen', guestId),
  sampleBoardColor: (point) => ipcRenderer.invoke('board:sample-color',point),
  setBoardZoomState: (state) => ipcRenderer.invoke('web-zoom:state', state),
  onWebWheel: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('noteboard:web-wheel', listener);
    return () => ipcRenderer.removeListener('noteboard:web-wheel', listener);
  },
  getWebBlockingStatus: (partition) => ipcRenderer.invoke("web-session:status", partition),
  clearWebSession: (partition) => ipcRenderer.invoke("web-session:clear", partition),
  onBoardsChanged: (callback) => {
    if (typeof callback !== "function") return () => undefined;
    const listener = () => callback();
    ipcRenderer.on("storage:boards-changed", listener);
    return () => ipcRenderer.removeListener("storage:boards-changed", listener);
  },
});
