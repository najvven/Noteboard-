/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import HomeScreen from './components/HomeScreen';
import NewPageScreen from './components/NewPageScreen';
import { Page, Preset } from './types';
import { generateId } from './lib/utils';
import {
  attachBoardDocumentRoots,
  cloneBoardDocument,
} from './features/board/clone-board-document';
import {
  CURRENT_PAGE_VERSION,
  migratePage,
} from './features/board/migrate-page';
import { AlertCircle, X } from 'lucide-react';
import {
  deletePage,
  loadPages as loadStoredPages,
  loadPresets as loadStoredPresets,
  loadSettings,
  savePage,
  savePresets,
  saveSettings,
  subscribeToBoardChanges,
} from './lib/storage';

type Screen = 'home' | 'new_page' | 'editor';

const BoardEditor = lazy(() => import('./components/BoardEditor'));

const loadPages = async (): Promise<Page[]> => {
  const data = await loadStoredPages();
  return data.map(migratePage);
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [pages, setPages] = useState<Page[]>([]);
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const userPresetsRef = useRef<Preset[]>([]);
  const persistedPresetsRef = useRef<Preset[]>([]);
  const presetSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);

  const [globalBrightness, setGlobalBrightness] = useState<number>(100);

  const refreshPagesFromStorage = useCallback(async () => {
    const fetchedPages = await loadPages();
    setPages(fetchedPages);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [fetchedPages, fetchedPresets, settingsRes] = await Promise.all([
          loadPages(),
          loadStoredPresets(),
          loadSettings()
        ]);
        setPages(fetchedPages);
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
      setStorageError(null);
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
    options: { keepalive?: boolean } = {},
  ) => {
    try {
      await savePage(page, options);
      setStorageError(null);
    } catch (err) {
      console.error('Failed to save page to server', err);
      setStorageError(`Could not save "${page.title || 'Untitled board'}". Your open board is still in memory.`);
    }
  };

  const handleImportPage = (importedPage: Page) => {
    const migratedPage = migratePage(importedPage);
    setPages((prev) => [migratedPage, ...prev]);
    savePageToServer(migratedPage);
    setActivePageId(migratedPage.id);
    setCurrentScreen('editor');
  };

  const handleSaveAsPage = async (newPage: Page): Promise<boolean> => {
    const migratedPage = migratePage(newPage);
    try {
      await savePage(migratedPage);
      setPages(prev => [migratedPage, ...prev]);
      setStorageError(null);
      return true;
    } catch (error) {
      console.error(error);
      setStorageError('Could not save the new board. Please try again.');
      return false;
    }
  };

  const handleStartFromPreset = (title: string, width: number, height: number, workspaceWidth: number, workspaceHeight: number, snapToGrid: boolean, preset: Preset | null) => {
    const clonedPreset = preset
      ? cloneBoardDocument(
          preset.elements,
          preset.sectionSheets ?? [],
          generateId,
        )
      : { elements: [], sheets: [] };
    const newPage: Page = {
      version: CURRENT_PAGE_VERSION,
      id: `page-${generateId()}`,
      title: title || '',
      width: preset?.width ?? width ?? 1024,
      height: preset?.height ?? height ?? 1024,
      workspaceWidth: preset?.workspaceWidth ?? workspaceWidth ?? 100000,
      workspaceHeight: preset?.workspaceHeight ?? workspaceHeight ?? 100000,
      showGrid: preset?.showGrid ?? false,
      snapToGrid: preset?.snapToGrid ?? snapToGrid,
      showWorkspaceGrid: preset?.showWorkspaceGrid ?? false,
      gridColor: preset?.gridColor,
      gridThickness: preset?.gridThickness,
      gridSize: preset?.gridSize,
      workspaceGridColor: preset?.workspaceGridColor,
      workspaceGridThickness: preset?.workspaceGridThickness,
      workspaceGridSize: preset?.workspaceGridSize,
      brightness: 100, // No longer used at page level, managed globally
      editorSettings: preset?.editorSettings
        ? structuredClone(preset.editorSettings)
        : undefined,
      updatedAt: Date.now(),
      isPinned: false,
      elements: clonedPreset.elements,
      sectionSheets: clonedPreset.sheets,
    };
    setPages((prev) => [newPage, ...prev]);
    savePageToServer(newPage);
    setActivePageId(newPage.id);
    setCurrentScreen('editor');
  };

  const handleBackToHome = () => {
    setCurrentScreen('home');
    setActivePageId(null);
  };

  const handleDeletePage = (pageId: string) => {
    setPages((prev) => prev.filter((p) => p.id !== pageId));
    deletePage(pageId).catch((error) => {
      console.error(error);
      setStorageError("Could not delete the board file.");
    });
  };

  const handleRenamePage = (pageId: string, newTitle: string) => {
    setPages((prev) => {
      const updated = prev.map((p) => p.id === pageId ? { ...p, title: newTitle } : p);
      const updatedPage = updated.find(p => p.id === pageId);
      if (updatedPage) savePageToServer(updatedPage);
      return updated;
    });
  };

  const handleTogglePin = (pageId: string) => {
    setPages((previousPages) => {
      const updatedPages = previousPages.map((page) =>
        page.id === pageId
          ? { ...page, isPinned: !page.isPinned, updatedAt: Date.now() }
          : page,
      );
      const updatedPage = updatedPages.find((page) => page.id === pageId);
      if (updatedPage) savePageToServer(updatedPage);
      return updatedPages;
    });
  };

  const handleMovePage = async (sourcePageId: string, targetPageId: string) => {
    const sourcePage = pages.find(p => p.id === sourcePageId);
    const targetPage = pages.find(p => p.id === targetPageId);

    if (!sourcePage || !targetPage) return;
    try {
      
      const targetBoardX = targetPage.boardX ?? ((targetPage.workspaceWidth || 100000) / 2 - (targetPage.width || 1024) / 2);
      const targetBoardY = targetPage.boardY ?? ((targetPage.workspaceHeight || 100000) / 2 - (targetPage.height || 1024) / 2);
      
      let maxX = targetBoardX + (targetPage.width || 1024);
      targetPage.elements.forEach(el => {
        const elMaxX = el.position.x + (el.size?.width || 0);
        if (elMaxX > maxX) maxX = elMaxX;
      });
      
      const newBoardX = maxX + 50; // closer spacing so it doesn't collide but is close
      const newBoardY = targetBoardY;
      
      const sourceBoardX = sourcePage.boardX ?? ((sourcePage.workspaceWidth || 100000) / 2 - (sourcePage.width || 1024) / 2);
      const sourceBoardY = sourcePage.boardY ?? ((sourcePage.workspaceHeight || 100000) / 2 - (sourcePage.height || 1024) / 2);
      
      const shiftX = newBoardX - sourceBoardX;
      const shiftY = newBoardY - sourceBoardY;
      
      const clonedSource = cloneBoardDocument(
        sourcePage.elements,
        sourcePage.sectionSheets ?? [],
        generateId,
      );

      const newBoardElement = {
        id: `board-${generateId()}`,
        type: 'board' as const,
        position: { x: newBoardX, y: newBoardY },
        size: { width: sourcePage.width || 1024, height: sourcePage.height || 1024 },
        content: sourcePage.title,
        zIndex: Math.min(0, ...(targetPage.elements.length ? targetPage.elements.map(e => e.zIndex) : [0]), ...(clonedSource.elements.length ? clonedSource.elements.map(e => e.zIndex) : [0])) - 1,
      };
      const newElements = attachBoardDocumentRoots(
        clonedSource.elements.map(el => ({
          ...el,
          position: {
            x: el.position.x + shiftX,
            y: el.position.y + shiftY,
          },
        })),
        newBoardElement.id,
      );
      
      const updatedTargetPage = {
        ...targetPage,
        elements: [...targetPage.elements, newBoardElement, ...newElements],
        sectionSheets: [
          ...(targetPage.sectionSheets ?? []),
          ...clonedSource.sheets,
        ],
        updatedAt: Date.now(),
      };
      
      await savePage(updatedTargetPage);
      await deletePage(sourcePageId);
      setPages((prev) =>
        prev
          .map(p => p.id === targetPageId ? updatedTargetPage : p)
          .filter(p => p.id !== sourcePageId),
      );
      setStorageError(null);
    } catch (error) {
      console.error('Failed to move board', error);
      setStorageError('Could not move the board. The source board was kept.');
    }
  };

  const activePage = pages.find((p) => p.id === activePageId);

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
          <span className="flex-1 font-semibold">{storageError}</span>
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
              setPages((prev) => prev.map((p) => p.id === updatedPage.id ? updatedPage : p));
              savePageToServer(updatedPage, options);
            }}
            onSaveAs={handleSaveAsPage}
            onSavePreset={(preset) => updateUserPresets(prev => [...prev, preset])}
          />
        </Suspense>
      )}
    </div>
  );
}
