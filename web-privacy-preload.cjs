const { contextBridge, ipcRenderer } = require('electron');
const { protectCookies } = require('./shared/web-cookie-guard-source.js');

// No Node/IPC API is exposed to the page. Only its cookie APIs are restricted.
const policy = ipcRenderer.sendSync('noteboard:web-privacy-policy', window.location.href);
if (policy?.blockCookies) {
  contextBridge.executeInMainWorld({ func: protectCookies, args: [{ protectPopups: policy.cookieBlocker === 'all' }] });
}
if (policy?.adBlock) require('@ghostery/adblocker-electron-preload');
