const { contextBridge, ipcRenderer } = require('electron');
const { protectCookies } = require('./shared/web-cookie-guard-source.js');
const { matchesWebZoomShortcut } = require('./shared/web-zoom-shortcut.js');

// No Node/IPC API is exposed to the page. Only its cookie APIs are restricted.
const policy = ipcRenderer.sendSync('noteboard:web-privacy-policy', window.location.href);

const applyFullscreenModeInPage = mode => {
  const key = '__noteboardFullscreenModeController';
  const existing = window[key];
  if (existing) { existing.setMode(mode); return; }
  if (mode !== 'area') return;

  const requestDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'requestFullscreen');
  const webkitRequestDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'webkitRequestFullscreen');
  const exitDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'exitFullscreen');
  const webkitExitDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'webkitExitFullscreen');
  const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement');
  const webkitFullscreenElementDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'webkitFullscreenElement');
  const originalDocumentExit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
  const originalDocumentWebkitExit = Object.getOwnPropertyDescriptor(document, 'webkitExitFullscreen');
  const originalDocumentFullscreenElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  const originalDocumentWebkitFullscreenElement = Object.getOwnPropertyDescriptor(document, 'webkitFullscreenElement');
  let currentMode = 'area';
  let activeElement = null;
  let savedInlineStyles = null;
  const areaStyles = {
    position: 'fixed', inset: '0', top: '0', right: '0', bottom: '0', left: '0',
    width: '100vw', height: '100vh', 'max-width': '100vw', 'max-height': '100vh',
    margin: '0', 'z-index': '2147483647',
  };

  const dispatchFullscreenChange = () => {
    document.dispatchEvent(new Event('fullscreenchange', { bubbles: true }));
    document.dispatchEvent(new Event('webkitfullscreenchange', { bubbles: true }));
  };
  const exitAreaFullscreen = () => {
    if (!activeElement) return false;
    for (const [property, original] of Object.entries(savedInlineStyles || {})) {
      if (original.value) activeElement.style.setProperty(property, original.value, original.priority);
      else activeElement.style.removeProperty(property);
    }
    activeElement.removeAttribute('data-noteboard-area-fullscreen');
    activeElement = null;
    savedInlineStyles = null;
    dispatchFullscreenChange();
    return true;
  };
  const requestAreaFullscreen = function () {
    if (currentMode !== 'area' && requestDescriptor?.value) {
      return requestDescriptor.value.apply(this, arguments);
    }
    if (activeElement && activeElement !== this) exitAreaFullscreen();
    activeElement = this;
    savedInlineStyles = Object.fromEntries(Object.keys(areaStyles).map(property => [property, {
      value: this.style.getPropertyValue(property),
      priority: this.style.getPropertyPriority(property),
    }]));
    this.setAttribute('data-noteboard-area-fullscreen', 'true');
    for (const [property, value] of Object.entries(areaStyles)) this.style.setProperty(property, value, 'important');
    dispatchFullscreenChange();
    return Promise.resolve();
  };
  const exitAreaFullscreenMethod = function () {
    if (currentMode === 'area' && exitAreaFullscreen()) return Promise.resolve();
    if (exitDescriptor?.value) return exitDescriptor.value.apply(this, arguments);
    return Promise.resolve();
  };
  const originalKeydown = event => {
    if (currentMode === 'area' && activeElement && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitAreaFullscreen();
    }
  };

  if (requestDescriptor?.value) {
    Object.defineProperty(Element.prototype, 'requestFullscreen', { ...requestDescriptor, value: requestAreaFullscreen });
  }
  if (webkitRequestDescriptor?.value) {
    Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', { ...webkitRequestDescriptor, value: requestAreaFullscreen });
  }
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, writable: true, value: exitAreaFullscreenMethod });
  if (webkitExitDescriptor?.value) Object.defineProperty(document, 'webkitExitFullscreen', { configurable: true, writable: true, value: exitAreaFullscreenMethod });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => activeElement || fullscreenElementDescriptor?.get?.call(document) || null,
  });
  if (webkitFullscreenElementDescriptor?.get) Object.defineProperty(document, 'webkitFullscreenElement', {
    configurable: true,
    get: () => activeElement || webkitFullscreenElementDescriptor.get.call(document) || null,
  });
  window.addEventListener('keydown', originalKeydown, true);

  const restoreNativeFullscreen = () => {
    exitAreaFullscreen();
    if (requestDescriptor) Object.defineProperty(Element.prototype, 'requestFullscreen', requestDescriptor);
    if (webkitRequestDescriptor) Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', webkitRequestDescriptor);
    if (originalDocumentExit) Object.defineProperty(document, 'exitFullscreen', originalDocumentExit);
    else delete document.exitFullscreen;
    if (originalDocumentWebkitExit) Object.defineProperty(document, 'webkitExitFullscreen', originalDocumentWebkitExit);
    else delete document.webkitExitFullscreen;
    if (originalDocumentFullscreenElement) Object.defineProperty(document, 'fullscreenElement', originalDocumentFullscreenElement);
    else delete document.fullscreenElement;
    if (originalDocumentWebkitFullscreenElement) Object.defineProperty(document, 'webkitFullscreenElement', originalDocumentWebkitFullscreenElement);
    else delete document.webkitFullscreenElement;
    window.removeEventListener('keydown', originalKeydown, true);
    delete window[key];
  };
  Object.defineProperty(window, key, {
    configurable: true,
    value: {
      get mode() { return currentMode; },
      setMode(nextMode) {
        if (nextMode === 'area') { currentMode = 'area'; return; }
        currentMode = 'real';
        restoreNativeFullscreen();
      },
    },
  });
};
if (policy?.fullscreenMode === 'area') contextBridge.executeInMainWorld({ func: applyFullscreenModeInPage, args: ['area'] });
ipcRenderer.on('noteboard:web-fullscreen-mode', (_event, mode) => {
  if (mode === 'area' || mode === 'real') contextBridge.executeInMainWorld({ func: applyFullscreenModeInPage, args: [mode] });
});
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
