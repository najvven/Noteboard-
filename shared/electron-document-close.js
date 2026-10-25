import { randomUUID } from "node:crypto";

// Keep the renderer alive until it acknowledges its latest document and writes.
// Only this window's main frame can acknowledge a request issued by this guard.
export function installDocumentCloseGuard(win, { ipcMain, dialog, timeoutMs = 15000 }) {
  let approved = false;
  let ready = false;
  let prompting = false;
  let pending;
  let timer;
  let wasEnabled = true;
  const failed = async () => {
    if (!pending || win.isDestroyed()) return;
    pending = undefined;
    clearTimeout(timer);
    win.setEnabled(wasEnabled);
    prompting = true;
    let response = 0;
    try { ({ response } = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Keep open", "Close without saving"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: "The last changes could not be saved.",
      detail: "Keep the board open to retry or export it before closing.",
    })); } catch { response = 0; } finally { prompting = false; }
    if (response === 1 && !win.isDestroyed()) {
      approved = true;
      win.close();
    }
  };
  const close = event => {
    if (approved || !ready) return;
    event.preventDefault();
    if (pending || prompting) return;
    pending = randomUUID();
    wasEnabled = win.isEnabled();
    win.setEnabled(false);
    timer = setTimeout(() => { void failed(); }, timeoutMs);
    try { win.webContents.send("document:prepare-close", pending); }
    catch { void failed(); }
  };
  const registered = event => {
    if (event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame) ready = true;
  };
  const receive = (event, requestId, saved) => {
    if (!pending || requestId !== pending || event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame) return;
    if (saved === true) {
      clearTimeout(timer);
      pending = undefined;
      approved = true;
      win.close();
    } else void failed();
  };
  win.on("close", close);
  ipcMain.on("document:close-ready", receive);
  ipcMain.on("document:close-handler-ready", registered);
  win.once("closed", () => {
    clearTimeout(timer);
    ipcMain.removeListener("document:close-ready", receive);
    ipcMain.removeListener("document:close-handler-ready", registered);
  });
}
