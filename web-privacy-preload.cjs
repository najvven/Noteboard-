const { contextBridge, ipcRenderer } = require('electron');
const { protectCookies } = require('./shared/web-cookie-guard-source.js');
const { matchesWebZoomShortcut } = require('./shared/web-zoom-shortcut.js');

// No Node/IPC API is exposed to the page. Only its cookie APIs are restricted.
const policy = ipcRenderer.sendSync('noteboard:web-privacy-policy', window.location.href);
let boardZoom = policy?.boardZoom || null;
const pressed = new Set();
ipcRenderer.on('noteboard:web-zoom-state', (_event, state) => { boardZoom = state; });
window.addEventListener('keydown', event => pressed.add(event.key), true);
window.addEventListener('keyup', event => { pressed.delete(event.key);if(boardZoom)boardZoom.active=false; }, true);
window.addEventListener('blur', () => pressed.clear());
window.addEventListener('wheel', event => {
  const inheritedKeys=boardZoom?.active?boardZoom.shortcut.split('+').filter(key=>!['ctrl','control','shift','alt','meta','cmd','command'].includes(key.trim().toLowerCase())):[];
  if (!event.isTrusted || !boardZoom || document.fullscreenElement || !matchesWebZoomShortcut(boardZoom.shortcut,event,[...pressed,...inheritedKeys])) return;
  event.preventDefault();event.stopImmediatePropagation();
  ipcRenderer.send('noteboard:web-wheel',{screenX:event.screenX,screenY:event.screenY,clientX:event.clientX*(visualViewport?.scale||1),clientY:event.clientY*(visualViewport?.scale||1),deltaY:event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1)});
}, {capture:true,passive:false});
if (policy?.blockCookies) {
  contextBridge.executeInMainWorld({ func: protectCookies, args: [{ protectPopups: policy.cookieBlocker === 'all' }] });
}
if (policy?.adBlock) require('@ghostery/adblocker-electron-preload');
