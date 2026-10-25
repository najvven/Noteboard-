import React, { useEffect, useRef, useState } from 'react';
import { FileDown, Files, LayoutTemplate, X } from 'lucide-react';
import type { SaveAsKind } from '../features/board/save-as';

const destinations = [
  { kind: 'template', label: 'Template', Icon: LayoutTemplate },
  { kind: 'board', label: 'New Board', Icon: Files },
  { kind: 'file', label: 'File', Icon: FileDown },
] as const;

export default function SaveAsDialog({ name, onClose, onSave }: {
  name: string;
  onClose: () => void;
  onSave: (kind: SaveAsKind, name: string) => Promise<string>;
}) {
  const [value, setValue] = useState(name || 'Untitled board');
  const [pending, setPending] = useState<SaveAsKind | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [pending]);
  const save = async (kind: SaveAsKind) => {
    if (pending || !value.trim()) return;
    setPending(kind); setStatus(''); setError('');
    try { setStatus(await onSave(kind, value.trim())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save. Please try again.'); }
    finally { setPending(null); }
  };
  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4" onPointerDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="save-as-heading" aria-busy={!!pending} tabIndex={-1}
        className="w-80 max-w-full rounded-2xl border-[3px] border-gray-400 bg-white p-4 shadow-2xl"
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
          <h2 id="save-as-heading" className="text-sm font-bold text-gray-800">Save as</h2>
          <button type="button" aria-label="Close save dialog" disabled={!!pending} onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </header>
        <label className="mb-3 block text-xs font-semibold text-gray-600">Name
          <input aria-label="Save as name" value={value} disabled={!!pending} onChange={event => { setValue(event.target.value); setStatus(''); setError(''); }} className="mt-1 w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500" />
        </label>
        <div className="divide-y divide-gray-200">
          {destinations.map(({ kind, label, Icon }) => (
            <div key={kind} className="flex items-center justify-between gap-4 py-2" data-save-as-kind={kind}>
              <span className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Icon className="h-4 w-4 text-gray-500" />{label}</span>
              <button type="button" aria-label={`Save as ${label}`} disabled={!!pending || !value.trim()} onClick={() => void save(kind)} className="min-w-16 rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-800 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50">{pending === kind ? 'Saving…' : 'Save'}</button>
            </div>
          ))}
        </div>
        {status && <p role="status" className="mt-2 text-xs text-green-700">{status}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
