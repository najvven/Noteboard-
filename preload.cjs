const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noteboardAPI", {
  loadPages: () => ipcRenderer.invoke("storage:get-pages"),
  savePage: (page) => ipcRenderer.invoke("storage:save-page", page),
  deletePage: (pageId) => ipcRenderer.invoke("storage:delete-page", pageId),
  loadPresets: () => ipcRenderer.invoke("storage:get-presets"),
  savePresets: (presets) => ipcRenderer.invoke("storage:save-presets", presets),
  loadSettings: () => ipcRenderer.invoke("storage:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("storage:save-settings", settings),
  openBoardsFolder: () => ipcRenderer.invoke("storage:open-boards-folder"),
  configureWebSession: (payload) => ipcRenderer.invoke("web-session:configure", payload),
  clearWebSession: (partition) => ipcRenderer.invoke("web-session:clear", partition),
  onBoardsChanged: (callback) => {
    if (typeof callback !== "function") return () => undefined;
    const listener = () => callback();
    ipcRenderer.on("storage:boards-changed", listener);
    return () => ipcRenderer.removeListener("storage:boards-changed", listener);
  },
});
