import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

export default function NumericField({
  value,
  min,
  max,
  step = 1,
  onCommit,
  suffix,
  ariaLabel,
  disabled = false,
  compact = false,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (value: number) => void;
  suffix?: string;
  ariaLabel: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelBlurCommitRef = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const bounded = Math.max(min ?? -Number.MAX_SAFE_INTEGER, Math.min(max ?? Number.MAX_SAFE_INTEGER, parsed));
    const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
    const precision = Math.max(0, String(safeStep).split('.')[1]?.length ?? 0);
    const next = Number(((min ?? 0) + Math.round((bounded - (min ?? 0)) / safeStep) * safeStep).toFixed(Math.min(6, precision)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <label className={cn(
      'noteboard-range-value flex min-w-0 shrink-0 items-center justify-end gap-1 rounded-md bg-gray-100 px-1.5 text-gray-700',
      compact ? 'h-6 text-[10px]' : 'h-7 text-xs',
      className,
    )}>
      <input
        aria-label={ariaLabel}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        onBlur={() => {
          if (cancelBlurCommitRef.current) {
            cancelBlurCommitRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            // Blur commits once through onBlur.
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelBlurCommitRef.current = true;
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
        className="w-full min-w-0 bg-transparent text-right font-bold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:cursor-not-allowed"
      />
      {suffix && <span className="shrink-0 whitespace-nowrap font-bold text-gray-500">{suffix}</span>}
    </label>
  );
}
