import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Page } from '../types';
import { generateId } from '../lib/utils';
import { Search, Pin, MoreHorizontal, Files, Plus, Trash2, Check, ArrowRight, CornerUpRight, AlertTriangle, Download, LoaderCircle, X, Settings2 } from 'lucide-react';
import { openBoardStorageFolder } from '../lib/storage';
import { filterAndSortPages } from '../features/home/page-search';
import {
  BoardPackageCancelledError,
  downloadBoardArchive,
  fingerprintBoardText,
  readBoardPackageFile,
} from '../features/board/board-package';
import {
  assertValidBoard,
} from '../../shared/board-data.js';

interface Props {
  active?: boolean;
  pages: Page[];
  onOpenPage: (id: string) => void;
  onCreateNewPage: () => void;
  onDeletePage: (id: string) => void;
  onRenamePage: (id: string, name: string) => void;
  onTogglePin: (id: string) => void;
  onMovePage: (sourceId: string, targetId: string) => void;
  onImportPage: (page: Page, options?: { openAfterImport?: boolean }) => Promise<void>;
  onRefreshPages: () => Promise<void>;
  globalBrightness: number;
  setGlobalBrightness: (val: number) => void;
}

export default function HomeScreen({ active = true, pages, onOpenPage, onCreateNewPage, onDeletePage, onRenamePage, onTogglePin, onMovePage, onImportPage, onRefreshPages, globalBrightness, setGlobalBrightness }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const allPages = filterAndSortPages(pages, searchQuery);
  const pinnedPages = allPages.filter(p => p.isPinned);
  const [movingPageId, setMovingPageId] = useState<string | null>(null);
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [fileOperation, setFileOperation] = useState<{ label: string; progress: number } | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const cancelFileOperationRef = useRef(false);
  const pendingImportRef = useRef<{ key: string; label: string; page: Page } | null>(null);
  const [pendingImportState, setPendingImportState] = useState<{ label: string; message: string } | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSettingsMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        (!settingsMenuRef.current?.contains(target) && !settingsDialogRef.current?.contains(target))
      ) {
        setShowSettingsMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettingsMenu(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSettingsMenu]);

  const importPageWithRetry = async (key: string, label: string, createPage: () => Promise<Page>) => {
    let pending = pendingImportRef.current;
    if (pending && pending.key !== key) {
      try {
        await onImportPage(pending.page, { openAfterImport: false });
        if (pendingImportRef.current?.page === pending.page) pendingImportRef.current = null;
        setPendingImportState(null);
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        setPendingImportState({
          label: pending.label,
          message: `The previous import is still unconfirmed.${detail} Retry it or discard it after refreshing your boards.`,
        });
        throw error;
      }
      pending = null;
    }
    const page = pending?.key === key ? pending.page : await createPage();
    if (!pending || pending.key !== key) pendingImportRef.current = { key, label, page };
    try {
      await onImportPage(page);
      if (pendingImportRef.current?.page === page) pendingImportRef.current = null;
      setPendingImportState(null);
    } catch (error) {
      pendingImportRef.current = { key, label, page };
      setPendingImportState({
        label,
        message: error instanceof Error ? error.message : 'The import was not confirmed. Retry or discard it after refreshing your boards.',
      });
      throw error;
    }
  };

  const retryPendingImport = async () => {
    const pending = pendingImportRef.current;
    if (!pending) return;
    try {
      await onImportPage(pending.page);
      if (pendingImportRef.current?.page === pending.page) pendingImportRef.current = null;
      setPendingImportState(null);
    } catch (error) {
      setPendingImportState({
        label: pending.label,
        message: error instanceof Error ? error.message : 'The import is still unconfirmed. Keep this window open and retry.',
      });
    }
  };

  const discardPendingImport = async () => {
    const pending = pendingImportRef.current;
    if (!pending) return;
    try {
      await onRefreshPages();
      if (pendingImportRef.current?.page === pending.page) pendingImportRef.current = null;
      setPendingImportState(null);
    } catch (error) {
      setPendingImportState({
        label: pending.label,
        message: error instanceof Error ? `Could not refresh saved boards. ${error.message}` : 'Could not refresh saved boards; the pending import is retained.',
      });
    }
  };

  const handleImportFile = async (file: File) => {
    cancelFileOperationRef.current = false;
    setFileOperation({ label: `Importing ${file.name}`, progress: 0 });
    try {
      let sourceFingerprint = '';
      const parsed = await readBoardPackageFile(file, {
        onSourceFingerprint: fingerprint => { sourceFingerprint = fingerprint; },
          createBoardId: () => `page-${generateId()}`,
          isCancelled: () => cancelFileOperationRef.current,
          onProgress: ({ stage, percent }) => {
            const progress =
              stage === 'opening'
                ? 5
                : stage === 'board'
                  ? 5 + percent * 0.15
                  : 20 + percent * 0.75;
            const label =
              stage === 'assets'
                ? `Restoring media from ${file.name}`
                : stage === 'opening'
                  ? `Opening ${file.name}`
                  : `Reading ${file.name}`;
            setFileOperation({ label, progress });
          },
      });
      if (Array.isArray(parsed)) throw new Error('Invalid board package format.');
      if (!sourceFingerprint) throw new Error('The file content could not be verified for a safe retry.');
      const importKey = `file:${file.name.toLowerCase()}:${sourceFingerprint}`;
      await importPageWithRetry(importKey, file.name, async () => parsed);
      setFileOperation({ label: `Finishing ${file.name}`, progress: 100 });
    } catch (error) {
      if (
        !(error instanceof BoardPackageCancelledError) &&
        !cancelFileOperationRef.current &&
        !pendingImportRef.current
      ) {
        alert(error instanceof Error ? error.message : 'Could not import the board file.');
      }
    } finally {
      setFileOperation(null);
    }
  };

  useEffect(() => {
    if (!active) return;
    const handlePaste = async (e: ClipboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
      const text = e.clipboardData?.getData('text');
      if (!text) return;
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { return; }
      if (!parsed || typeof parsed !== 'object' || !('id' in parsed) || !Array.isArray((parsed as {elements?: unknown}).elements)) return;
      e.preventDefault();
      try {
        const importKey = `clipboard:${await fingerprintBoardText(text)}`;
        await importPageWithRetry(importKey, 'Clipboard board', async () => {
          const page = parsed as Page;
          if (!page.version) page.version = 1;
          page.id = `page-${generateId()}`;
          assertValidBoard(page);
          return page;
        });
      } catch (error) {
        if (!pendingImportRef.current)
          setPendingImportState({ label: 'Clipboard board', message: error instanceof Error ? error.message : 'Could not import the clipboard board.' });
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
      
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      await handleImportFile(file);
    };

    window.addEventListener('paste', handlePaste);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [active, onImportPage, onRefreshPages]);

  const handlePageClick = (id: string) => {
    if (movingPageId) {
      if (movingPageId !== id) {
        onMovePage(movingPageId, id);
      }
      setMovingPageId(null);
    } else {
      onOpenPage(id);
    }
  };

  const deleteDialog = deletingPageId ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border-2 border-gray-200 p-6 max-w-sm w-full animate-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 mb-4 text-red-500">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-gray-900">Delete Board?</h3>
        </div>
        <p className="text-gray-600 mb-6 text-sm">
          Are you sure you want to delete this board? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setDeletingPageId(null)}
            className="px-4 py-2 text-sm font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onDeletePage(deletingPageId);
              setDeletingPageId(null);
            }}
            className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors shadow-sm"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const settingsDialog = (
    <div
      id="main-settings-dialog"
      ref={settingsDialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="main-settings-title"
      hidden={!showSettingsMenu}
      onClick={(event) => {
        if (event.target === event.currentTarget) setShowSettingsMenu(false);
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200 xl:p-8"
    >
      <div
        data-settings-dialog="true"
        className="flex h-[min(680px,90vh)] min-h-0 max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border-2 border-gray-800 bg-white shadow-2xl animate-in zoom-in-95 duration-200"
      >
        <div className="flex shrink-0 items-center justify-between border-b-4 border-gray-100 bg-white p-6">
          <h2 id="main-settings-title" className="text-xl font-bold tracking-tight text-[#1A1A1A]">
            Settings
          </h2>
          <button
            type="button"
            onClick={() => setShowSettingsMenu(false)}
            aria-label="Close settings dialog"
            className="rounded-lg border-2 border-transparent p-2 text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:text-black"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <nav
            aria-label="Settings categories"
            className="flex min-h-0 w-full flex-col overflow-y-auto border-r-4 border-gray-100 bg-gray-50 p-6 md:w-1/3 xl:w-1/4 xl:p-8"
          >
            <h3 className="mb-6 -mt-4 text-base font-bold text-gray-800">Categories</h3>
            <button
              type="button"
              aria-current="page"
              className="flex w-full rounded-lg bg-white px-3 py-2 text-left text-sm font-bold text-gray-800 shadow-sm ring-1 ring-gray-200"
            >
              <span>Visual</span>
            </button>
          </nav>

          <section
            className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto bg-white p-6 xl:p-8"
            aria-labelledby="visual-settings-title"
          >
            <div>
              <h3 id="visual-settings-title" className="mb-4 text-sm font-bold text-gray-800">Visual</h3>
              <label htmlFor="global-brightness" className="flex max-w-xl flex-col gap-3">
                <span className="flex items-center justify-between text-sm font-bold text-gray-600">
                  <span>Brightness</span>
                  <span className="tabular-nums text-gray-500">{globalBrightness}%</span>
                </span>
                <input
                  id="global-brightness"
                  type="range"
                  min="10"
                  max="200"
                  step="5"
                  value={globalBrightness}
                  onChange={(event) => setGlobalBrightness(parseInt(event.target.value, 10))}
                  className="w-full accent-black"
                  title={`System Brightness: ${globalBrightness}%`}
                />
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-12 flex-1 w-full flex flex-col relative">
      {fileOperation && (
        <div className="fixed inset-x-0 bottom-6 z-[150] mx-auto flex w-[min(92vw,520px)] items-center gap-3 rounded-lg border border-gray-300 bg-white p-3 shadow-xl" role="status">
          <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-blue-600" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-gray-800">{fileOperation.label}</div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-gray-200">
              <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.max(0, Math.min(100, fileOperation.progress))}%` }} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => { cancelFileOperationRef.current = true; }}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-black"
            title="Cancel import"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {pendingImportState && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert" data-pending-import>
          <div className="font-bold">Import needs confirmation: {pendingImportState.label}</div>
          <p className="mt-1">{pendingImportState.message}</p>
          {pendingImportRef.current && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void retryPendingImport()} className="rounded-md bg-amber-950 px-3 py-1.5 font-semibold text-white hover:bg-amber-900">
                Retry previous import
              </button>
              <button type="button" onClick={() => void discardPendingImport()} className="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-950 hover:bg-amber-100">
                Discard after refresh
              </button>
            </div>
          )}
        </div>
      )}
      {isDraggingFile && (
        <div className="fixed inset-0 z-[100] bg-blue-500/20 backdrop-blur-sm flex items-center justify-center border-8 border-blue-500 pointer-events-none">
          <div className="bg-white px-8 py-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 animate-in zoom-in-95">
            <Files className="w-12 h-12 text-blue-500 animate-bounce" />
            <h2 className="text-2xl font-bold text-gray-800">Drop Board File Here</h2>
            <p className="text-gray-500 font-medium text-center max-w-sm">
              Release to instantly import the board.<br/>
              (You can also press Ctrl+V to paste a board!)
            </p>
          </div>
        </div>
      )}
      {movingPageId && (
        <div className="absolute top-[5.8rem] left-6 z-[90] text-blue-800 flex items-center gap-3 max-w-[min(92vw,620px)]">
          <div className="flex items-center gap-2 min-w-0 text-sm font-bold">
            <CornerUpRight className="w-5 h-5 shrink-0" />
            <span className="truncate">Choose board to move to: {pages.find(p => p.id === movingPageId)?.title}</span>
          </div>
          <button 
            onClick={() => setMovingPageId(null)}
            className="text-sm px-3 py-1.5 border border-blue-300 hover:bg-blue-50 rounded-md transition-colors font-bold shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
      <header className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A] shrink-0">My Workspace</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div ref={settingsMenuRef} className="relative h-[40px] w-[250px] shrink-0">
            <button
              type="button"
              data-main-settings-button="true"
              aria-haspopup="dialog"
              aria-controls="main-settings-dialog"
              aria-expanded={showSettingsMenu}
              onClick={() => setShowSettingsMenu((value) => !value)}
              className="flex h-full w-full items-center justify-start gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-black"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              <span>Settings</span>
            </button>

          </div>

          <div className="relative group md:flex-1 w-full md:w-auto h-[40px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search notes..." 
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search noteboards"
              className="pl-9 pr-4 h-full bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium md:w-64 placeholder:text-gray-400 shadow-sm w-full"
            />
          </div>
          <div className="flex bg-gray-100 rounded-lg p-1 border border-gray-200 shrink-0 shadow-sm w-full md:w-auto h-[40px]">
            <label className="cursor-pointer px-3 h-full text-gray-600 hover:bg-white hover:text-black rounded-md transition-colors flex items-center justify-center" title="Import Noteboard File">
              <Files className="w-4 h-4" />
              <input 
                type="file" 
                accept=".zip,.json" 
                className="hidden" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleImportFile(file);
                  }
                  e.target.value = '';
                }}
              />
            </label>
            <button onClick={onCreateNewPage} className="cursor-pointer h-full bg-black text-white rounded-md hover:bg-gray-800 transition-all flex flex-1 items-center justify-center gap-2 px-4 text-sm font-medium shrink-0 ml-1">
              <Plus aria-hidden="true" className="h-5 w-5" />
              <span>New Noteboard</span>
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-12">
        {pinnedPages.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4 text-gray-500 text-sm font-medium">
              <Pin className="w-4 h-4" />
              <h2>Pinned</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 -ml-[3px]">
              {pinnedPages.map(page => (
                <PageCard key={page.id} page={page} onClick={() => handlePageClick(page.id)} onDelete={() => setDeletingPageId(page.id)} onRename={(name) => onRenamePage(page.id, name)} onTogglePin={() => onTogglePin(page.id)} onMove={() => setMovingPageId(page.id)} onRefreshPages={onRefreshPages} isMovingTarget={!!movingPageId && movingPageId !== page.id} />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center gap-2 mb-4 text-gray-500 text-sm font-medium">
            <Files className="w-4 h-4" />
            <h2>My Noteboards</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 -ml-[3px]">
            {allPages.map(page => (
              <PageCard key={page.id} page={page} onClick={() => handlePageClick(page.id)} onDelete={() => setDeletingPageId(page.id)} onRename={(name) => onRenamePage(page.id, name)} onTogglePin={() => onTogglePin(page.id)} onMove={() => setMovingPageId(page.id)} onRefreshPages={onRefreshPages} isMovingTarget={!!movingPageId && movingPageId !== page.id} />
            ))}
          </div>
          {allPages.length === 0 && searchQuery.trim() && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm font-semibold text-gray-500">
              No noteboards match “{searchQuery.trim()}”.
            </div>
          )}
        </section>
      </div>

      {typeof document === 'undefined' ? deleteDialog : deleteDialog ? createPortal(deleteDialog, document.body) : null}
      {typeof document === 'undefined' ? settingsDialog : createPortal(settingsDialog, document.body)}
    </div>
  );
}

function PageCard({ page, onClick, onDelete, onRename, onTogglePin, onMove, onRefreshPages, isMovingTarget }: { key?: React.Key; page: Page; onClick: () => void; onDelete: () => void; onRename: (name: string) => void; onTogglePin: () => void; onMove: () => void; onRefreshPages: () => Promise<void>; isMovingTarget: boolean }) {
  const isSelected = false; // Add select mode later if needed
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(page.title);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  
  const moveMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setShowMoveMenu(false);
      }
    }
    if (showMoveMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMoveMenu]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onDelete();
  };

  const handleSaveRename = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    onRename(editName);
    setIsEditing(false);
  };

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowMoveMenu(false);
    
    await downloadBoardArchive(page);
  };

  return (
    <article
      aria-label={page.title || 'Untitled board'}
      className={`group relative border-2 ${isSelected ? 'border-blue-500 ring-4 ring-blue-50' : 'border-gray-200 hover:border-gray-300'} ${isMovingTarget ? 'hover:border-blue-500 hover:ring-4 hover:ring-blue-100 hover:bg-blue-50' : ''} bg-white rounded-2xl transition-all hover:shadow-md overflow-visible flex flex-col`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Open ${page.title || 'Untitled board'}`}
        className="absolute inset-0 z-10 cursor-pointer rounded-2xl outline-none focus-visible:ring-4 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
      />
      <div className={`w-full aspect-[4/3] bg-gray-50 border-b-2 border-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-gray-100 transition-all duration-300 relative shadow-inner overflow-hidden rounded-t-xl ${isMovingTarget ? 'group-hover:bg-blue-100/50' : ''}`}>
        <div className="w-8 h-8 border-[4px] border-gray-300 rounded-lg group-hover:border-gray-400 transition-colors" />
        {page.isPinned && (
          <span className="absolute left-3 top-3 rounded-lg border border-amber-200 bg-amber-50 p-1.5 text-amber-700" title="Pinned">
            <Pin className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          </span>
        )}
        
        <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-30 flex items-center gap-2">
          <button 
            onClick={handleDelete}
            onPointerDown={e => e.stopPropagation()}
            title="Delete Board"
            className="p-1.5 rounded-lg text-red-500 hover:text-red-600 bg-white/50 hover:bg-white border-2 border-transparent hover:border-red-300 transition-colors shadow-sm"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <div className="relative" ref={moveMenuRef}>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setShowMoveMenu(!showMoveMenu);
              }}
              onPointerDown={e => e.stopPropagation()}
              title="More options"
              className={`p-1.5 rounded-lg border-2 transition-colors shadow-sm ${showMoveMenu ? 'text-gray-800 bg-white border-gray-300' : 'text-gray-500 hover:text-gray-800 bg-white/50 hover:bg-white border-transparent hover:border-gray-300'}`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            
            {showMoveMenu && (
              <div 
                className="absolute bottom-full right-0 mb-2 w-48 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-50 flex flex-col p-1"
                onClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setShowMoveMenu(false);
                    openBoardStorageFolder().then((folder) => {
                      if (!folder) {
                        alert("Storage folder can only be opened in the desktop app.");
                      } else {
                        setTimeout(() => {
                          onRefreshPages().catch(console.error);
                        }, 500);
                      }
                    }).catch(() => {
                      alert("Could not open the storage folder.");
                    });
                  }}
                  className="flex items-center gap-2 text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium mb-1"
                >
                  <Files className="w-4 h-4 text-gray-500" />
                  Show in files
                </button>
                <button
                  onClick={handleExport}
                  className="flex items-center gap-2 text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium mb-1"
                >
                  <Download className="w-4 h-4 text-gray-500" />
                  Save to file
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setShowMoveMenu(false);
                    onTogglePin();
                  }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                >
                  <Pin className={`h-4 w-4 text-gray-500 ${page.isPinned ? 'fill-current' : ''}`} />
                  {page.isPinned ? 'Unpin board' : 'Pin board'}
                </button>
                <div className="h-[1px] bg-gray-200 mx-2 my-1" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setShowMoveMenu(false);
                    onMove();
                  }}
                  className="flex items-center gap-2 text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                >
                  <ArrowRight className="w-4 h-4 text-gray-500" />
                  Move to...
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="relative p-4 pt-3 flex items-center justify-between z-20 bg-white rounded-b-xl">
        <div className="min-w-0 flex-1 flex flex-col">
          <div className="h-7 flex items-center w-full relative">
            {isEditing ? (
               <div className="relative flex items-center w-full h-full" onClick={e => e.stopPropagation()}>
                 <input
                   type="text"
                   value={editName}
                   autoFocus
                   onChange={(e) => setEditName(e.target.value)}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') {
                       handleSaveRename();
                     } else if (e.key === 'Escape') {
                       setIsEditing(false);
                       setEditName(page.title);
                     }
                   }}
                   className="font-bold text-[#1A1A1A] text-sm w-[calc(100%-8px)] outline-none bg-white px-1.5 py-0 h-7 rounded-md border-0 ring-1 ring-blue-400 focus:ring-1 focus:ring-blue-500 leading-tight pr-8 shadow-sm transition-all mx-1"
                 />
                 {editName !== page.title && (
                   <button
                     onClick={handleSaveRename}
                     onPointerDown={e => e.stopPropagation()}
                     className="absolute right-2 p-1 text-green-600 hover:bg-green-100 rounded bg-white border border-green-200 h-5 w-5 flex items-center justify-center transition-colors shadow-sm"
                     title="Save name"
                   >
                     <Check className="w-3.5 h-3.5 stroke-[3]" />
                   </button>
                 )}
               </div>
            ) : (
              <button
                type="button"
                aria-label={`Rename ${page.title || 'Untitled board'}`}
                className="font-bold text-[#1A1A1A] text-sm text-left hover:bg-gray-100 hover:border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-md px-1.5 py-0 h-7 border border-transparent transition-all w-[calc(100%-8px)] leading-tight flex items-center overflow-hidden mx-1 cursor-text"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                  setEditName(page.title);
                }}
                title="Click to rename"
              >
                <span className="truncate">{page.title}</span>
              </button>
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider font-bold h-4 flex items-center px-1.5">
            Edited {new Date(page.updatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </article>
  );
}
