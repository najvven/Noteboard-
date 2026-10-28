import React, { useEffect, useRef, useState } from 'react';
import { Download, FileDown, Files, LayoutTemplate, X } from 'lucide-react';
import type { SaveAsKind } from '../features/board/save-as';

const destinations = [
  { kind: 'template', label: 'Template', Icon: LayoutTemplate },
  { kind: 'board', label: 'New Board', Icon: Files },
  { kind: 'file', label: 'File', Icon: FileDown },
] as const;

type SaveState = Partial<Record<SaveAsKind, boolean>>;

export default function SaveAsDialog({ name, onClose, onSave }: {
  name: string;
  onClose: () => void;
  onSave: (kind: SaveAsKind, name: string) => Promise<string>;
}) {
  const [templateName, setTemplateName] = useState(name || 'Untitled template');
  const [boardName, setBoardName] = useState(name || 'Untitled board');
  const [pending, setPending] = useState<SaveAsKind | null>(null);
  const [saved, setSaved] = useState<SaveState>({});
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => previous?.focus();
  }, []);

  const currentName = (kind: SaveAsKind) => {
    if (kind === 'template') return templateName;
    if (kind === 'board') return boardName;
    return name;
  };

  const updateName = (kind: 'template' | 'board', value: string) => {
    if (kind === 'template') setTemplateName(value);
    else setBoardName(value);
    setSaved(previous => ({ ...previous, [kind]: undefined }));
    setError('');
  };

  const save = async (kind: SaveAsKind) => {
    const value = currentName(kind).trim();
    if (pending || (kind !== 'file' && !value)) return;
    setPending(kind);
    setError('');
    try {
      await onSave(kind, value || name || 'Untitled board');
      setSaved(previous => ({ ...previous, [kind]: true }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save. Please try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4" onPointerDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="save-as-heading" aria-busy={!!pending} tabIndex={-1}
        className="w-[410px] max-w-full rounded-2xl border-[3px] border-gray-400 bg-white p-4 pb-3 shadow-2xl"
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape' && !pending) { event.stopPropagation(); onClose(); }
          if (event.key === 'Tab') {
            const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []) as HTMLElement[];
            if (!controls.length) { event.preventDefault(); return; }
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <header className="mb-3 flex items-center justify-between">
          <h2 id="save-as-heading" className="flex items-center gap-2 text-sm font-bold text-gray-800">Save <Download aria-hidden="true" className="h-4 w-4" /></h2>
          <button type="button" aria-label="Close save dialog" disabled={!!pending} onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </header>
        <div className="divide-y divide-gray-200">
          {destinations.map(({ kind, label, Icon }) => {
            const nameInputId = `save-as-${kind}-name`;
            const isSaved = saved[kind] === true;
            const isPending = pending === kind;
            return (
              <div key={kind} className="grid grid-cols-[6.25rem_minmax(0,1fr)_5.5rem] items-center gap-2 py-2.5" data-save-as-kind={kind}>
                <label htmlFor={kind === 'file' ? undefined : nameInputId} className="flex min-w-0 items-center gap-2 text-xs font-semibold text-gray-700">
                  <Icon className="h-4 w-4 shrink-0 text-gray-500" />
                  <span className="truncate">{label}</span>
                </label>
                {kind === 'file' ? <span aria-hidden="true" /> : (
                  <input
                    id={nameInputId}
                    aria-label={`${label} name`}
                    value={kind === 'template' ? templateName : boardName}
                    disabled={!!pending}
                    onChange={event => updateName(kind, event.target.value)}
                    className="h-8 w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900 outline-none transition-colors hover:border-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 disabled:bg-gray-100"
                  />
                )}
                <button
                  type="button"
                  aria-label={isSaved ? `Saved as ${label}` : `Save as ${label}`}
                  disabled={!!pending || (kind !== 'file' && !currentName(kind).trim()) || isSaved}
                  onClick={() => void save(kind)}
                  className={`flex h-8 w-full items-center justify-center rounded-md border px-2 text-xs font-bold transition-colors disabled:cursor-default ${isSaved ? 'border-gray-200 bg-gray-100 text-gray-400' : 'border-gray-300 bg-gray-50 text-gray-700 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50'} ${isPending ? 'opacity-60' : ''} ${isSaved ? 'save-confirm-flash' : ''}`}
                >
                  <span>{isPending ? 'Saving…' : isSaved ? 'Saved' : 'Save'}</span>
                </button>
              </div>
            );
          })}
        </div>
        {error && <p role="alert" className="pt-1 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
