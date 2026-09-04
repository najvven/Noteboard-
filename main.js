import { app, BrowserWindow, Menu, ipcMain, shell, session } from 'electron';
import fs from 'fs/promises';
import { watch as watchDirectory } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  assertValidBoard,
  MAX_BOARD_FILE_BYTES,
  normalizeBoardId
} from './shared/board-data.js';
import { loadDesktopBoardArchive } from './shared/desktop-board-archive.js';
import { atomicWriteJson, enqueueWrite, readFileLimited, readJsonWithBackup } from './shared/persistence.js';
import { mapInBatches } from './shared/batch.js';
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
  shouldBlockPopup,
  shouldBlockWebRequest
} from './shared/electron-web-policy.js';
import { repairLegacyBoard } from './shared/board-migration.js';
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

const updateWebSessionTopLevelUrl = (contents, url) => {
  const partition = getPartitionForWebContents(contents);
  if (!partition || !isAllowedEmbeddedWebUrl(url)) return;
  const current = webSessionSettings.get(partition) || normalizeWebSessionSettings();
  webSessionSettings.set(partition, { ...current, topLevelUrl: url });
};

const configureWebSession = (partition, settings = {}) => {
  if (!isAllowedWebPartition(partition)) {
    return false;
  }

  const normalized = normalizeWebSessionSettings(settings);
  webSessionSettings.set(partition, normalized);

  if (configuredWebSessions.has(partition)) return true;

  const webSession = session.fromPartition(partition);
  installPermissionDenyHandlers(webSession);
  configuredWebSessions.set(partition, webSession);

  const requestFilter = { urls: ['http://*/*', 'https://*/*'] };

  webSession.webRequest.onBeforeRequest(requestFilter, (details, callback) => {
    const current = webSessionSettings.get(partition) || normalizeWebSessionSettings();
    if (shouldBlockWebRequest(details.url, current)) {
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });

  webSession.webRequest.onBeforeSendHeaders(requestFilter, (details, callback) => {
    const current = webSessionSettings.get(partition) || normalizeWebSessionSettings();
    const requestHeaders = filterRequestHeaders(
      details.requestHeaders,
      details.url,
      current
    );

    callback({ requestHeaders });
  });

  webSession.webRequest.onHeadersReceived(requestFilter, (details, callback) => {
    const current = webSessionSettings.get(partition) || normalizeWebSessionSettings();
    const responseHeaders = filterResponseHeaders(
      details.responseHeaders,
      details.url,
      current
    );

    callback({ responseHeaders });
  });

  return true;
};

async function ensureDataDirs() {
  await fs.mkdir(boardsDir(), { recursive: true });
}

function safeBoardFile(id) {
  const safeId = normalizeBoardId(id);
  return path.join(boardsDir(), `${safeId}.json`);
}

async function loadBoardFromZip(filePath) {
  const buffer = await readFileLimited(
    filePath,
    MAX_BOARD_FILE_BYTES,
    'Board package'
  );
  return loadDesktopBoardArchive(buffer, {
    fallbackId: path.basename(filePath, path.extname(filePath))
  });
}

handleTrusted('storage:get-pages', async () => {
  await ensureDataDirs();
  const files = await fs.readdir(boardsDir());
  const loadedPages = await mapInBatches(files, 8, async (file) => {
    try {
      const filePath = path.join(boardsDir(), file);
      let page = null;
      if (file.endsWith('.json')) {
        page = repairLegacyBoard(await readJsonWithBackup(filePath));
      } else if (file.endsWith('.zip')) {
        page = repairLegacyBoard(await loadBoardFromZip(filePath));
      } else {
        return null;
      }

      if (page && typeof page === 'object' && Array.isArray(page.elements)) {
        if (!page.id) page.id = file.replace(/\.(json|zip)$/i, '');
        if (!page.updatedAt) page.updatedAt = 0;
        assertValidBoard(page);
        return page;
      }
    } catch (error) {
      console.warn(`Skipping unreadable board file: ${file}`, error);
    }
    return null;
  });
  const pagesById = new Map();
  for (const page of loadedPages) {
    if (page) pagesById.set(page.id, page);
  }
  const pages = Array.from(pagesById.values());
  return pages.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});

handleTrusted('storage:save-page', async (_event, page) => {
  await ensureDataDirs();
  assertValidBoard(page);
  const filePath = safeBoardFile(page.id);
  await enqueueWrite(filePath, () => atomicWriteJson(filePath, page));
  return true;
});

handleTrusted('storage:delete-page', async (_event, pageId) => {
  await ensureDataDirs();
  const filePath = safeBoardFile(pageId);
  await enqueueWrite(filePath, async () => {
    await Promise.all([
      fs.unlink(filePath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      }),
      fs.unlink(`${filePath}.bak`).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      })
    ]);
  });
  return true;
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
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
  if (contents.getType?.() !== 'webview') return;
  installPermissionDenyHandlers(contents.session);

  contents.setWindowOpenHandler((details) => {
    const partition = getPartitionForWebContents(contents);
    const current = partition
      ? webSessionSettings.get(partition) || normalizeWebSessionSettings()
      : normalizeWebSessionSettings();

    if (shouldBlockPopup(details.url, current)) {
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
      return;
    }
    updateWebSessionTopLevelUrl(contents, url);
  });
  contents.on('will-redirect', (redirectEvent, url) => {
    if (!isAllowedEmbeddedWebUrl(url)) redirectEvent.preventDefault();
  });
  contents.on('did-navigate', (_navigateEvent, url) => {
    updateWebSessionTopLevelUrl(contents, url);
  });
  contents.on('did-navigate-in-page', (_navigateEvent, url) => {
    updateWebSessionTopLevelUrl(contents, url);
  });
});

app.whenReady().then(() => {
  installPermissionDenyHandlers(session.defaultSession);
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
