import { app, BrowserWindow, Menu, ipcMain, shell, session, webContents, net, clipboard, dialog } from 'electron';
import { installDocumentCloseGuard } from './shared/electron-document-close.js';
import fs from 'fs/promises';
import { watch as watchDirectory } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createWebFilterService, addFilterCsp } from './shared/web-filter-engine.js';
import { createAdExtensionManager } from './shared/electron-ad-extension.js';
import { installAdCosmeticHandlers } from './shared/electron-ad-cosmetics.js';
import { configureWebViewport } from './shared/electron-web-viewport.js';
import { readNativeClipboard, writeNativeBoardClipboard } from './shared/native-clipboard.js';
import { atomicWriteJson, enqueueWrite, readJsonWithBackup } from './shared/persistence.js';
import { loadStoredBoards, saveStoredBoard, deleteStoredBoard } from './shared/board-store.js';
import {
  isAllowedEmbeddedWebUrl,
  isAllowedMainWindowNavigation,
  isAllowedWebPartition
} from './shared/electron-security.js';
import {
  createIsolatedPopupOptions,
  filterRequestHeaders,
  filterResponseHeaders,
  normalizeWebSessionSettings,
  createWebSessionConfigurationQueue,
  resolveWebRequestPolicy,
  shouldRememberMainFrameUrl,
  shouldBlockCookies,
  shouldBlockPopup
} from './shared/electron-web-policy.js';
import { installPermissionDenyHandlers } from './shared/electron-permissions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 945;
const MIN_ZOOM_FACTOR = 0.4;
const PRODUCTION_ENTRY = path.join(__dirname, 'dist', 'index.html');
const MAIN_WINDOW_NAVIGATION_OPTIONS = {
  development: process.env.NODE_ENV === 'development',
  developmentOrigin: 'http://localhost:3000',
  productionEntry: pathToFileURL(PRODUCTION_ENTRY).href
};

const dataDir = () => path.join(app.getPath('userData'), 'data');
const boardsDir = () => path.join(dataDir(), 'boards');
const presetsFile = () => path.join(dataDir(), 'presets.json');
const settingsFile = () => path.join(dataDir(), 'settings.json');
const webSessionSettings = new Map();
const configuredWebSessions = new Map();
const configureWebSessionInOrder = createWebSessionConfigurationQueue();
const webZoomStates = new WeakMap();
const webPointerPositions = new WeakMap();
const webNavigationUrls = new WeakMap();
const guestPreload = path.join(__dirname, 'dist', 'web-privacy-preload.cjs');
const blockingCounts = new Map();
let filterServicePromise;
const getFilterService = () => filterServicePromise ??= createWebFilterService({
  // Electron's Chromium network stack avoids Node/undici socket-parser crashes
  // during background filter refreshes; these public downloads never use cookies.
  fetchImpl: (url, options) => net.fetch(url, { ...options, credentials: 'omit' }),
  cacheFile: path.join(app.getPath('userData'), 'web-filters-cache.json'),
}).then(service => {
  const refresh = () => service.refresh().then(changed=>changed?adExtensions.refresh():undefined).catch(error => console.warn('Filter update unavailable; keeping verified local lists.', error.message));
  void refresh();
  const timer = setInterval(refresh, 24 * 60 * 60 * 1000);
  timer.unref();
  return service;
});
const adExtensions=createAdExtensionManager({
  webContents,sourceDirectory:path.join(__dirname,'dist','web-adblock-extension'),
  targetDirectory:path.join(app.getPath('userData'),'web-adblock-extension'),getFilterService,
  getExtensionSession:()=>{
    const runtime=session.fromPartition('persist:noteboard-adblock-runtime');
    installPermissionDenyHandlers(runtime);
    return runtime;
  },
});
const countBlocked = (partition, kind) => {
  const counts = blockingCounts.get(partition) || { ads: 0, cookies: 0, popups: 0 };
  counts[kind]++;
  blockingCounts.set(partition, counts);
};
let boardsWatcher = null;
let boardsWatchTimer = null;

const assertTrustedIpcSender = (event) => {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!isAllowedMainWindowNavigation(senderUrl, MAIN_WINDOW_NAVIGATION_OPTIONS)) {
    throw new Error('IPC request rejected from an untrusted page.');
  }
};

const handleTrusted = (channel, handler) => {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return handler(event, ...args);
  });
};

const getPartitionForWebContents = (contents) => {
  for (const [partition, webSession] of configuredWebSessions.entries()) {
    if (contents.session === webSession) return partition;
  }
  return null;
};

handleTrusted('clipboard:read', () => readNativeClipboard(clipboard));
handleTrusted('clipboard:write-board', (_event, json) => writeNativeBoardClipboard(clipboard, json));

installAdCosmeticHandlers(ipcMain, contents => webSessionSettings.get(getPartitionForWebContents(contents)), async () => (await getFilterService()).engine);
ipcMain.on('noteboard:web-privacy-policy', (event, documentUrl) => {
  const settings = webSessionSettings.get(getPartitionForWebContents(event.sender));
  if (!settings) { event.returnValue = null; return; }
  let frame = event.senderFrame;
  while (frame?.parent && /^about:(blank|srcdoc)/i.test(frame.url)) frame = frame.parent;
  // The trusted preload has the new document URL even before frame.url commits.
  const frameUrl = /^https?:\/\//i.test(documentUrl || '') ? documentUrl : frame?.url || '';
  const topLevelUrl = webNavigationUrls.get(event.sender) || event.sender.mainFrame.url || settings.topLevelUrl;
  const host = event.sender.getType() === 'webview' ? event.sender.hostWebContents : null;
  const boardZoom = host && !host.isDestroyed() ? webZoomStates.get(host) || { shortcut: 'Ctrl', active: false } : null;
  event.returnValue = { adBlock: settings.adBlock, cookieBlocker: settings.cookieBlocker, blockCookies: shouldBlockCookies(frameUrl, { ...settings, topLevelUrl }), boardZoom };
});

handleTrusted('web-zoom:state', (event, state = {}) => {
  if (typeof state.shortcut !== 'string' || state.shortcut.length > 100) return false;
  const normalized = { shortcut: state.shortcut, active: state.active === true };
  webZoomStates.set(event.sender, normalized);
  for (const guest of webContents.getAllWebContents()) {
    if (!guest.isDestroyed() && guest.getType() === 'webview' && guest.hostWebContents === event.sender) {
      for(const frame of guest.mainFrame.framesInSubtree) {
        try { frame.send('noteboard:web-zoom-state',normalized); } catch { /* A navigating frame receives the current policy in its preload. */ }
      }
    }
  }
  return true;
});

ipcMain.on('noteboard:web-wheel', (event, data = {}) => {
  const guest = event.sender;
  if (guest.isDestroyed() || guest.getType() !== 'webview' || !getPartitionForWebContents(guest)) return;
  const host = guest.hostWebContents;
  if (!host || host.isDestroyed() || !['screenX','screenY','clientX','clientY','deltaY'].every(key => Number.isFinite(data[key]))) return;
  const pointer = webPointerPositions.get(guest);
  const topFrame=event.senderFrame === guest.mainFrame;
  if(!topFrame && (!pointer || Math.abs(pointer.x-data.screenX)>2 || Math.abs(pointer.y-data.screenY)>2))return;
  host.send('noteboard:web-wheel', {
    guestId:guest.id,
    guestX:topFrame?data.clientX:pointer.localX,
    guestY:topFrame?data.clientY:pointer.localY,
    deltaY: Math.max(-16000,Math.min(16000,data.deltaY)),
  });
});

const updateWebSessionTopLevelUrl = (contents, url) => {
  const partition = getPartitionForWebContents(contents);
  if (!partition || !isAllowedEmbeddedWebUrl(url)) return;
  const current = webSessionSettings.get(partition) || normalizeWebSessionSettings();
  webSessionSettings.set(partition, { ...current, topLevelUrl: url });
};

const cookieUrl = cookie => `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`;

const requestPolicy = (details, settings) => {
  const candidate = typeof details.webContentsId === 'number'
    ? webContents.fromId(details.webContentsId)
    : undefined;
  const source = candidate && !candidate.isDestroyed() ? candidate : undefined;
  const currentUrl = source ? webNavigationUrls.get(source) || source.getURL() : undefined;
  return { ...resolveWebRequestPolicy(details, settings, currentUrl), source };
};

const applyWebSessionConfiguration = async (partition, normalized) => {
  if (!isAllowedWebPartition(partition)) {
    return false;
  }

  if (normalized.adBlock) await getFilterService();
  const previous = webSessionSettings.get(partition);
  const webSession = session.fromPartition(partition);
  webSessionSettings.set(partition, normalized);
  await adExtensions.configure(webSession,normalized);
  // Blocking all cookies also removes existing cookies from this isolated field.
  if (normalized.cookieBlocker === 'all' && previous?.cookieBlocker !== 'all') {
    await webSession.clearStorageData({ storages: ['cookies'] });
  }
  if (configuredWebSessions.has(partition)) {
    return true;
  }

  installPermissionDenyHandlers(webSession, { allowFullscreen: true });
  configuredWebSessions.set(partition, webSession);
  webSession.registerPreloadScript({ type: 'frame', filePath: guestPreload });
  webSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (removed) return;
    const current = webSessionSettings.get(partition) || normalizeWebSessionSettings();
    const url = cookieUrl(cookie);
    // An allowed popup is a first-party page in its own right, even though it
    // shares the originating field's session and blocking preferences.
    const isOpenFirstParty = current.cookieBlocker === 'third-party' && webContents.getAllWebContents().some(contents => {
      if (contents.session !== webSession) return false;
      const topLevelUrl = webNavigationUrls.get(contents) || contents.getURL();
      return /^https?:\/\//i.test(topLevelUrl) && !shouldBlockCookies(url, { ...current, topLevelUrl });
    });
    if (!isOpenFirstParty && shouldBlockCookies(url, current)) {
      countBlocked(partition, 'cookies');
      webSession.cookies.remove(url, cookie.name).catch(error => console.warn('Could not discard a blocked cookie.', error));
    }
  });

  const requestFilter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };

  // Chromium does not deliver Chrome extension webRequest events for an
  // Electron guest view. This bridge asks the loaded extension to decide;
  // there is no separate request matcher or internal fallback here.
  webSession.webRequest.onBeforeRequest(requestFilter,async (details,callback)=>{
    const policy=requestPolicy(details,webSessionSettings.get(partition)||normalizeWebSessionSettings());
    const applyDecision=decision=>{
      if(policy.source&&policy.mainFrameUrl&&shouldRememberMainFrameUrl(details,decision))
        webNavigationUrls.set(policy.source,policy.mainFrameUrl);
      callback(decision);
    };
    if(!policy.settings.adBlock){applyDecision({cancel:false});return;}
    try {applyDecision(await adExtensions.filterRequest(webSession,details,policy.settings.topLevelUrl));}
    catch(error){console.error('Web ad-block extension could not filter the request.',error);callback({cancel:true});}
  });

  webSession.webRequest.onBeforeSendHeaders(requestFilter, (details, callback) => {
    const current = requestPolicy(details, webSessionSettings.get(partition) || normalizeWebSessionSettings()).settings;
    const requestHeaders = filterRequestHeaders(
      details.requestHeaders,
      details.url,
      current
    );
    if (Object.keys(requestHeaders).length < Object.keys(details.requestHeaders || {}).length) countBlocked(partition, 'cookies');

    callback({ requestHeaders });
  });

  webSession.webRequest.onHeadersReceived(requestFilter, async (details, callback) => {
    const current = requestPolicy(details, webSessionSettings.get(partition) || normalizeWebSessionSettings()).settings;
    let responseHeaders = filterResponseHeaders(
      details.responseHeaders,
      details.url,
      current
    );
    if (Object.keys(responseHeaders).length < Object.keys(details.responseHeaders || {}).length) countBlocked(partition, 'cookies');
    if (current.adBlock) {
      try { responseHeaders = addFilterCsp((await getFilterService()).engine, details, responseHeaders, current.topLevelUrl); }
      catch (error) { console.error('Could not apply ad filter policy.', error); callback({ cancel: true }); return; }
    }
    callback({ responseHeaders });
  });

  return true;
};

const configureWebSession = (partition, settings = {}) => {
  if (!isAllowedWebPartition(partition)) return Promise.resolve(false);
  const normalized = normalizeWebSessionSettings(settings);
  return configureWebSessionInOrder(partition, () =>
    applyWebSessionConfiguration(partition, normalized),
  );
};

async function ensureDataDirs() {
  await fs.mkdir(boardsDir(), { recursive: true });
}

handleTrusted('storage:get-pages', async () => {
  await ensureDataDirs();
  return loadStoredBoards(boardsDir());
});

handleTrusted('storage:save-page', async (_event, page, options) => {
  await ensureDataDirs();
  try { return await saveStoredBoard(boardsDir(), page, { baseRevision: options?.baseRevision }); }
  catch (error) {
    if (error.code === 'STALE_BOARD_REVISION') return { ok: false, code: error.code, message: error.message };
    throw error;
  }
});

handleTrusted('storage:delete-page', async (_event, pageId, options) => {
  await ensureDataDirs();
  try { return await deleteStoredBoard(boardsDir(), pageId, { baseRevision: options?.baseRevision }); }
  catch (error) {
    if (error.code === 'STALE_BOARD_REVISION') return { ok: false, code: error.code, message: error.message };
    throw error;
  }
});

handleTrusted('storage:get-presets', async () => {
  await ensureDataDirs();
  return readJsonWithBackup(presetsFile(), []);
});

handleTrusted('storage:save-presets', async (_event, presets) => {
  await ensureDataDirs();
  if (!Array.isArray(presets)) throw new Error('Presets must be an array.');
  await enqueueWrite(presetsFile(), () => atomicWriteJson(presetsFile(), presets));
  return true;
});

handleTrusted('storage:get-settings', async () => {
  await ensureDataDirs();
  return readJsonWithBackup(settingsFile(), { brightness: 100 });
});

handleTrusted('storage:save-settings', async (_event, settings) => {
  await ensureDataDirs();
  if (!settings || typeof settings !== 'object') throw new Error('Settings are invalid.');
  await enqueueWrite(settingsFile(), () => atomicWriteJson(settingsFile(), settings));
  return true;
});

handleTrusted('storage:open-boards-folder', async () => {
  await ensureDataDirs();
  await shell.openPath(boardsDir());
  return boardsDir();
});

handleTrusted('web-session:configure', async (_event, payload = {}) => {
  const partition = String(payload.partition || '');
  return configureWebSession(partition, payload.settings || {});
});

handleTrusted('web-viewport:configure', async (event, payload = {}) => {
  const guest = Number.isInteger(payload.guestId) ? webContents.fromId(payload.guestId) : null;
  if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' ||
      guest.hostWebContents !== event.sender || !getPartitionForWebContents(guest)) {
    throw new Error('Web viewport request does not belong to this board window.');
  }
  return configureWebViewport(guest, payload, process.versions.chrome, process.platform);
});

handleTrusted('web-view:fullscreen', async (event, guestId) => {
  const guest = Number.isInteger(guestId) ? webContents.fromId(guestId) : null;
  if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' || guest.hostWebContents !== event.sender || !getPartitionForWebContents(guest)) return false;
  // Put the existing host element in the DOM top layer. Moving/recreating the
  // webview would discard playback and page state.
  return event.sender.executeJavaScript(`(async () => {
    const guest = [...document.querySelectorAll('webview')].find(view => { try { return view.getWebContentsId() === ${guestId}; } catch { return false; } });
    const viewport = guest?.parentElement;
    if (!viewport) return false;
    if (document.fullscreenElement !== viewport) await viewport.requestFullscreen();
    return true;
  })()`, true);
});

handleTrusted('board:sample-color',async(event,point={})=>{
  const win=BrowserWindow.fromWebContents(event.sender);
  if(!win||win.isDestroyed()||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('Invalid sample position.');
  const zoom=event.sender.getZoomFactor(),bounds=win.getContentBounds();
  const x=Math.floor(point.x*zoom),y=Math.floor(point.y*zoom);
  if(x<0||y<0||x>=bounds.width||y>=bounds.height)throw Error('Choose a point inside the board window.');
  const image=await event.sender.capturePage({x,y,width:1,height:1});
  if(image.isEmpty())throw Error('Could not read the selected color.');
  const pixel=image.toBitmap();
  return '#'+[pixel[2],pixel[1],pixel[0]].map(value=>value.toString(16).padStart(2,'0')).join('');
});

handleTrusted('web-session:clear', async (_event, partition) => {
  if (!isAllowedWebPartition(partition)) {
    return false;
  }

  const webSession = session.fromPartition(partition);
  await webSession.clearStorageData({
    storages: [
      'cookies',
      'filesystem',
      'indexdb',
      'localstorage',
      'shadercache',
      'websql',
      'serviceworkers',
      'cachestorage'
    ]
  });
  await webSession.clearCache();
  return true;
});

handleTrusted('web-session:status', async (_event, partition) => {
  if (!isAllowedWebPartition(partition)) return null;
  const settings = webSessionSettings.get(partition);
  if (!settings) return null;
  const extension=await adExtensions.status(configuredWebSessions.get(partition));
  return { ...(blockingCounts.get(partition) || { ads: 0, cookies: 0, popups: 0 }),
    ads:extension?.ads??0,filtersUpdatedAt:extension?.filtersUpdatedAt??null,filterRules:extension?.filterRules??0,
    extensionId:extension?.extensionId??null,extensionName:extension?.extensionName??null,
    extensionReady:extension?.ready===true,extensionEnabled:extension?.enabled===true,
  };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Noteboard+",
    autoHideMenuBar: true, // This hides the default electron menu
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  });

  // Remove the menu entirely to make it look like a modern app
  Menu.setApplicationMenu(null);

  installDocumentCloseGuard(win, { ipcMain, dialog });
  const updateZoomFactor = () => {
    const [width, height] = win.getContentSize();
    const zoomFactor = Math.max(
      MIN_ZOOM_FACTOR,
      Math.min(1, width / DESIGN_WIDTH, height / DESIGN_HEIGHT)
    );
    win.webContents.setZoomFactor(zoomFactor);
  };

  win.webContents.once('did-finish-load', updateZoomFactor);
  win.on('resize', updateZoomFactor);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && isAllowedEmbeddedWebUrl(url)) {
      shell.openExternal(url).catch(error => console.warn('Could not open web link.', error));
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    // Required for our trusted preload in child frames. Page worlds stay
    // sandboxed and isolated with no Node APIs (covered by native tests).
    webPreferences.nodeIntegrationInSubFrames = true;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.zoomFactor = 1;
    webPreferences.allowRunningInsecureContent = false;
    const allowedPartition = isAllowedWebPartition(params.partition);
    if (allowedPartition) {
      installPermissionDenyHandlers(session.fromPartition(params.partition));
    }
    if (
      !allowedPartition ||
      !isAllowedEmbeddedWebUrl(params.src || 'about:blank')
    ) {
      event.preventDefault();
    }
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedMainWindowNavigation(url, MAIN_WINDOW_NAVIGATION_OPTIONS)) {
      event.preventDefault();
    }
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3000');
  } else {
    win.loadFile(PRODUCTION_ENTRY);
  }

  ensureDataDirs().then(() => {
    boardsWatcher?.close();
    boardsWatcher = watchDirectory(boardsDir(), { persistent: false }, () => {
      if (boardsWatchTimer) clearTimeout(boardsWatchTimer);
      boardsWatchTimer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.send('storage:boards-changed');
      }, 250);
    });
  }).catch((error) => console.warn('Could not watch the boards folder.', error));

  win.on('closed', () => {
    boardsWatcher?.close();
    boardsWatcher = null;
    if (boardsWatchTimer) clearTimeout(boardsWatchTimer);
    boardsWatchTimer = null;
  });
}

app.on('web-contents-created', (_event, contents) => {
  const isGuest = contents.getType?.() === 'webview';
  if (!isGuest && !getPartitionForWebContents(contents)) return;
  if (isGuest) contents.on('before-mouse-event', (_event, mouse) => {
    if (Number.isFinite(mouse.globalX) && Number.isFinite(mouse.globalY)) webPointerPositions.set(contents,{x:mouse.globalX,y:mouse.globalY,localX:mouse.x,localY:mouse.y});
  });
  installPermissionDenyHandlers(contents.session);

  contents.setWindowOpenHandler((details) => {
    const partition = getPartitionForWebContents(contents);
    const current = partition
      ? webSessionSettings.get(partition) || normalizeWebSessionSettings()
      : normalizeWebSessionSettings();

    if (shouldBlockPopup(details.url, current)) {
      if (partition) countBlocked(partition, 'popups');
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: createIsolatedPopupOptions(partition)
    };
  });

  contents.on('will-navigate', (navigateEvent, url) => {
    if (!isAllowedEmbeddedWebUrl(url)) {
      navigateEvent.preventDefault();
    }
  });
  contents.on('will-redirect', (redirectEvent, url) => {
    if (!isAllowedEmbeddedWebUrl(url)) redirectEvent.preventDefault();
  });
  contents.on('did-navigate', (_navigateEvent, url) => {
    if (isGuest) updateWebSessionTopLevelUrl(contents, url);
  });
  contents.on('did-navigate-in-page', (_navigateEvent, url) => {
    if (isGuest) updateWebSessionTopLevelUrl(contents, url);
  });
});

app.whenReady().then(() => {
  const adIdleTimer=setInterval(()=>{
    void adExtensions.releaseIdleSessions().catch(error=>console.warn('Could not release idle Web filters.',error.message));
  },10000);
  adIdleTimer.unref();
  installPermissionDenyHandlers(session.defaultSession, { allowFullscreen: true });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
