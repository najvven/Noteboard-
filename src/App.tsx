/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import HomeScreen from './components/HomeScreen';
import NewPageScreen from './components/NewPageScreen';
import { Page, Preset } from './types';
import { generateId } from './lib/utils';
import {
  cloneBoardDocument,
} from './features/board/clone-board-document';
import { clonePageAsAdditionalBoard, pagePresentationFromPreset } from './features/board/board-transfer';
import { flushBoardOperations, nextBoardRevision } from './lib/board-operations';
import { BoardConflictError, isDefinitiveBoardWriteError } from './lib/storage-errors';
import {
  CURRENT_PAGE_VERSION,
  migratePage,
} from './features/board/migrate-page';
import { AlertCircle, X } from 'lucide-react';
import {
  deletePage,
  discardBoardRecovery,
  loadPages as loadStoredPages,
  loadPresets as loadStoredPresets,
  loadSettings,
  savePage,
  savePresets,
  saveSettings,
  subscribeToBoardChanges,
  type SavePageOptions,
} from './lib/storage';

type Screen = 'home' | 'new_page' | 'editor';

const BoardEditor = lazy(() => import('./components/BoardEditor'));

const loadPages = async (onRecoveryError?: (reason: unknown) => void): Promise<Page[]> => {
  const data = await loadStoredPages({ onRecoveryError });
  return data.map(migratePage);
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [pages, _setPages] = useState<Page[]>([]);
  const pagesRef = useRef<Page[]>([]);
  const pageMutationVersion = useRef(0);
  const updatePages = useCallback((change: Page[] | ((current: Page[]) => Page[])) => {
    const next = typeof change === 'function' ? change(pagesRef.current) : change;
    pagesRef.current = next;
    pageMutationVersion.current++;
    _setPages(next);
  }, []);
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const userPresetsRef = useRef<Preset[]>([]);
  const persistedPresetsRef = useRef<Preset[]>([]);
  const presetSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const homeActionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingHomeActionsRef = useRef(0);
  const initialSavePendingRef = useRef(false);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [storageError, updateStorageError] = useState<{ message: string; conflictedPageId?: string } | null>(null);
  const setStorageError = (message: string | null, conflictedPageId?: string) => updateStorageError(message ? { message, conflictedPageId } : null);
  const discardEpochRef = useRef(0);
  const [storageHydrated, setStorageHydrated] = useState(false);

  useEffect(() => window.noteboardAPI?.onCloseRequested?.(requestId => {
    void Promise.all([homeActionQueueRef.current, presetSaveQueueRef.current]).then(() => flushBoardOperations()).then(
      () => window.noteboardAPI?.respondToClose?.(requestId, true),
      () => window.noteboardAPI?.respondToClose?.(requestId, false),
    );
  }), []);

  const [globalBrightness, setGlobalBrightness] = useState<number>(100);

  const refreshPagesFromStorage = useCallback(async () => {
    if (pendingHomeActionsRef.current) return;
    const version = pageMutationVersion.current;
    const fetchedPages = await loadPages(() => setStorageError('Some recovered drafts could not be restored. They remain in local recovery; free storage or retry. Saved boards were kept.'));
    if (version === pageMutationVersion.current) updatePages(fetchedPages);
  }, [updatePages]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [fetchedPages, fetchedPresets, settingsRes] = await Promise.all([
          loadPages(() => setStorageError('Some recovered drafts could not be restored. They remain in local recovery; free storage or retry. Saved boards were kept.')),
          loadStoredPresets(),
          loadSettings()
        ]);
        updatePages(fetchedPages);
        userPresetsRef.current = fetchedPresets;
        persistedPresetsRef.current = fetchedPresets;
        setUserPresets(fetchedPresets);
        if (settingsRes && settingsRes.brightness) {
          setGlobalBrightness(settingsRes.brightness);
        }
      } catch (err) {
        console.error("Failed to load initial data", err);
        setStorageError("Could not load your boards. Existing files were not changed.");
      } finally {
        setStorageHydrated(true);
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (currentScreen === 'editor') return;

    const handleFocus = () => {
      refreshPagesFromStorage().catch(console.error);
    };
    window.addEventListener('focus', handleFocus);
    const unsubscribe = subscribeToBoardChanges(handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      unsubscribe();
    };
  }, [currentScreen, refreshPagesFromStorage]);

  const updateUserPresets = (change: (presets: Preset[]) => Preset[]): Promise<boolean> => {
    const next = change(userPresetsRef.current);
    userPresetsRef.current = next;
    setUserPresets(next);
    const operation = presetSaveQueueRef.current.then(async () => {
      await savePresets(next);
      persistedPresetsRef.current = next;
      updateStorageError(current => current?.conflictedPageId ? current : null);
    });
    presetSaveQueueRef.current = operation.catch(() => undefined);
    return operation.then(() => true).catch(error => {
      console.error(error);
      if (userPresetsRef.current === next) {
        userPresetsRef.current = persistedPresetsRef.current;
        setUserPresets(persistedPresetsRef.current);
      }
      setStorageError('Could not save templates. Please try again.');
      return false;
    });
  };

  const skipNextSettingsSaveRef = useRef(true);
  useEffect(() => {
    if (!storageHydrated) return;
    if (skipNextSettingsSaveRef.current) {
      skipNextSettingsSaveRef.current = false;
      return;
    }
    saveSettings({ brightness: globalBrightness }).catch((error) => {
      console.error(error);
      setStorageError("Could not save application settings.");
    });
  }, [globalBrightness, storageHydrated]);

  const handleOpenPage = (pageId: string) => {
    setActivePageId(pageId);
    setCurrentScreen('editor');
  };

  const handleCreateNewPage = () => {
    setCurrentScreen('new_page');
  };

  const savePageToServer = async (
    page: Page,
    options: SavePageOptions = {},
  ) => {
    const epoch = discardEpochRef.current;
    try {
      const acknowledged = await savePage(page, options);
      if (acknowledged && epoch === discardEpochRef.current) setStorageError(null);
      return acknowledged;
    } catch (err) {
      console.error('Failed to save page to server', err);
      if (epoch !== discardEpochRef.current) {
        if (isDefinitiveBoardWriteError(err)) throw err;
        return false;
      }
      if (err instanceof BoardConflictError) {
        if (err.code === 'BOARD_ID_PATH_COLLISION') {
          setStorageError('This board id conflicts with another saved board. Use Save → New Board or File to keep your changes under a new id.');
        } else setStorageError('Another editor saved a newer version. Use Save → New Board or File to keep your local changes before reloading.', page.id);
        throw err;
      }
      setStorageError(`Could not save "${page.title || 'Untitled board'}". Your open board is still in memory.`);
      if (isDefinitiveBoardWriteError(err)) throw err;
      return false;
    }
  };

  const handleImportPage = async (importedPage: Page) => {
    if (initialSavePendingRef.current) return;
    initialSavePendingRef.current = true;
    try {
      const source = migratePage(importedPage);
      const document = cloneBoardDocument(source.elements, source.sectionSheets ?? [], generateId);
      const id = pagesRef.current.some(p => p.id === source.id) ? `page-${generateId()}` : source.id;
      const migratedPage: Page = { ...source, id, elements: document.elements, sectionSheets: document.sheets, updatedAt: nextBoardRevision(id) };
      await savePage(migratedPage, { baseRevision: null });
      updatePages((prev) => [migratedPage, ...prev]);
      setStorageError(null);
      setActivePageId(migratedPage.id);
      setCurrentScreen('editor');
    } catch (error) {
      setStorageError('Could not import the board. The original file was not changed; please retry.');
      throw error;
    } finally { initialSavePendingRef.current = false; }
  };

  const handleSaveAsPage = async (newPage: Page): Promise<boolean> => {
    const migratedPage = migratePage(newPage);
    try {
      await savePage(migratedPage, { baseRevision: null });
      updatePages(prev => [migratedPage, ...prev]);
      updateStorageError(current => current?.conflictedPageId ? current : null);
      return true;
    } catch (error) {
      console.error(error);
      setStorageError('Could not save the new board. Please try again.');
      return false;
    }
  };

  const handleStartFromPreset = async (title: string, width: number, height: number, workspaceWidth: number, workspaceHeight: number, snapToGrid: boolean, preset: Preset | null) => {
    if (initialSavePendingRef.current) return;
    initialSavePendingRef.current = true;
    try {
      const clonedPreset = preset
        ? cloneBoardDocument(preset.elements, preset.sectionSheets ?? [], generateId)
        : { elements: [], sheets: [] };
      const newPage: Page = {
        version: CURRENT_PAGE_VERSION,
        id: `page-${generateId()}`,
        title: title || '',
        ...pagePresentationFromPreset(preset, {
          width: width ?? 1024, height: height ?? 1024,
          workspaceWidth: workspaceWidth ?? 100000, workspaceHeight: workspaceHeight ?? 100000,
          snapToGrid,
        }),
        updatedAt: Date.now(),
        isPinned: false,
        elements: clonedPreset.elements,
        sectionSheets: clonedPreset.sheets,
      };
      await savePage(newPage, { baseRevision: null });
      updatePages((prev) => [newPage, ...prev]);
      setStorageError(null);
      setActivePageId(newPage.id);
      setCurrentScreen('editor');
    } catch (error) {
      console.error('Could not create the board', error);
      setStorageError('Could not create the board. Your settings remain open; please retry.');
    } finally { initialSavePendingRef.current = false; }
  };

  const handleBackToHome = () => {
    setCurrentScreen('home');
    setActivePageId(null);
  };

  const runHomeAction = (operation: () => Promise<void>) => {
    pendingHomeActionsRef.current++;
    pageMutationVersion.current++;
    const result = homeActionQueueRef.current.then(operation).finally(() => { pendingHomeActionsRef.current--; });
    homeActionQueueRef.current = result.catch(() => undefined);
    return result;
  };

  const handleDeletePage = (pageId: string) => runHomeAction(async () => {
    try {
      const page = pagesRef.current.find(p => p.id === pageId);
      if (!page) return;
      await deletePage(pageId, { baseRevision: page.updatedAt ?? 0 });
      updatePages(current => current.filter(p => p.id !== pageId));
    } catch (error) {
      console.error(error);
      setStorageError('Could not delete the board file.');
    }
  });

  const handleRenamePage = (pageId: string, newTitle: string) => runHomeAction(async () => {
    const page = pagesRef.current.find(p => p.id === pageId);
    if (!page) return;
    const updated = { ...page, title: newTitle, updatedAt: nextBoardRevision(page.id, page.updatedAt) };
    if (await savePageToServer(updated, { baseRevision: page.updatedAt ?? 0 })) updatePages(current => current.map(p => p.id === pageId ? updated : p));
  });

  const handleTogglePin = (pageId: string) => runHomeAction(async () => {
    const page = pagesRef.current.find(p => p.id === pageId);
    if (!page) return;
    const updated = { ...page, isPinned: !page.isPinned, updatedAt: nextBoardRevision(page.id, page.updatedAt) };
    if (await savePageToServer(updated, { baseRevision: page.updatedAt ?? 0 })) updatePages(current => current.map(p => p.id === pageId ? updated : p));
  });

  const handleMovePage = (sourcePageId: string, targetPageId: string) => runHomeAction(async () => {
    const sourcePage = pagesRef.current.find(p => p.id === sourcePageId);
    const targetPage = pagesRef.current.find(p => p.id === targetPageId);

    if (!sourcePage || !targetPage || sourcePageId === targetPageId) return;
    try {
      
      const transfer = clonePageAsAdditionalBoard(sourcePage, targetPage, generateId);
      const updatedTargetPage: Page = {
        ...targetPage,
        elements: transfer.elements,
        sectionSheets: transfer.sectionSheets,
        updatedAt: nextBoardRevision(targetPage.id, targetPage.updatedAt),
      };

      await savePage(updatedTargetPage, { baseRevision: targetPage.updatedAt ?? 0 });
      // Show the committed copy even if removing the source fails. Never leave
      // a successfully persisted destination invisible in the workspace.
      updatePages(current => current.map(p => p.id === targetPageId ? updatedTargetPage : p));
      try { await deletePage(sourcePageId, { baseRevision: sourcePage.updatedAt ?? 0 }); }
      catch (error) {
        console.error('Could not remove the source after copying the board', error);
        setStorageError('The board was copied to the destination, but the source could not be removed. Both copies were kept.');
        return;
      }
      updatePages((prev) =>
        prev
          .map(p => p.id === targetPageId ? updatedTargetPage : p)
          .filter(p => p.id !== sourcePageId),
      );
      setStorageError(null);
    } catch (error) {
      console.error('Failed to move board', error);
      setStorageError('Could not move the board. The source board was kept.');
    }
  });

  const activePage = pages.find((p) => p.id === activePageId);
  const renderDiscardEpoch = discardEpochRef.current;
  const reloadConflictedPage = async () => {
    const pageId = storageError?.conflictedPageId;
    if (!pageId || !window.confirm('Reload the saved version? Local changes will be discarded. Save a separate board or file first to keep them.')) return;
    discardEpochRef.current++;
    // Unmount the editor and its unload listeners before removing recovery.
    flushSync(() => {
      setIsLoading(true);
      updatePages(current => current.filter(page => page.id !== pageId));
      setCurrentScreen('home'); setActivePageId(null); setStorageError(null);
    });
    discardBoardRecovery(pageId);
    try { await homeActionQueueRef.current; await refreshPagesFromStorage(); }
    catch { setStorageError('Could not reload the saved boards. Please refresh the workspace.'); }
    finally { setIsLoading(false); }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F8F9] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8F9] text-[#1A1A1A] font-sans flex flex-col selection:bg-blue-200 selection:text-black transition-all" style={{ filter: globalBrightness !== 100 ? `brightness(${globalBrightness}%)` : undefined }}>
      {storageError && (
        <div className="fixed bottom-4 right-4 z-[500] flex max-w-md items-start gap-3 rounded-lg border border-red-300 bg-white p-3 text-sm text-red-800 shadow-xl" role="alert">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">{storageError.message}</span>
            {storageError.conflictedPageId === activePageId && (
              <button type="button" onClick={() => { void reloadConflictedPage(); }} className="mt-2 block text-xs font-bold text-blue-700 underline">Reload saved version</button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setStorageError(null)}
            className="rounded p-1 text-red-700 hover:bg-red-50"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {(currentScreen === 'home' || currentScreen === 'new_page') && (
        <HomeScreen 
          active={currentScreen === 'home'}
          pages={pages} 
          onOpenPage={handleOpenPage}
          onCreateNewPage={handleCreateNewPage}
          onDeletePage={handleDeletePage}
          onRenamePage={handleRenamePage}
          onTogglePin={handleTogglePin}
          onMovePage={handleMovePage}
          onImportPage={handleImportPage}
          onRefreshPages={refreshPagesFromStorage}
          globalBrightness={globalBrightness}
          setGlobalBrightness={setGlobalBrightness}
        />
      )}

      {currentScreen === 'new_page' && (
        <NewPageScreen 
          userPresets={userPresets}
          onStart={handleStartFromPreset}
          onBack={handleBackToHome}
          onDeletePreset={(id) => { void updateUserPresets(prev => prev.filter(p => p.id !== id)); }}
          onRenamePreset={(id, newName) => { void updateUserPresets(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p)); }}
        />
      )}
      
      {currentScreen === 'editor' && activePage && (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#2e2e2e] text-sm font-semibold text-white">Loading board...</div>}>
          <BoardEditor
            page={activePage}
            onBack={handleBackToHome}
            onSave={(updatedPage, options) => {
              if (discardEpochRef.current !== renderDiscardEpoch) return false;
              updatePages((prev) => prev.map((p) => p.id === updatedPage.id ? updatedPage : p));
              return savePageToServer(updatedPage, options);
            }}
            onSaveAs={handleSaveAsPage}
            onSavePreset={(preset) => updateUserPresets(prev => [...prev, preset])}
          />
        </Suspense>
      )}
    </div>
  );
}
