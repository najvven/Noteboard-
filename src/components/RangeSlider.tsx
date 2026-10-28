import React, { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

const decimalsForStep = (step: number) => {
  const text = String(step);
  const decimal = text.indexOf('.');
  return decimal < 0 ? 0 : Math.min(6, text.length - decimal - 1);
};

const normalizeValue = (raw: number, min: number, max: number, step: number) => {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? Math.max(safeMin, max) : safeMin;
  const clamped = Math.max(safeMin, Math.min(safeMax, raw));
  const stepped = safeMin + Math.round((clamped - safeMin) / safeStep) * safeStep;
  return Number(Math.max(safeMin, Math.min(safeMax, stepped)).toFixed(decimalsForStep(safeStep)));
};

export default function RangeSlider({
  value,
  min,
  max,
  id,
  step = 1,
  onChange,
  onValueEntryStart,
  suffix = '',
  ariaLabel,
  disabled = false,
  compact = false,
  dataTextPxControl = false,
  className,
  inputClassName,
}: {
  value: number;
  min: number;
  max: number;
  id?: string;
  step?: number;
  onChange: (value: number) => void;
  onValueEntryStart?: () => number | undefined;
  suffix?: string;
  ariaLabel: string;
  disabled?: boolean;
  compact?: boolean;
  dataTextPxControl?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const normalizedValue = normalizeValue(value, min, max, step);
  const [draft, setDraft] = useState(String(normalizedValue));
  const [valueOverride, setValueOverride] = useState<number | null>(null);
  const effectiveValue = normalizeValue(valueOverride ?? normalizedValue, min, max, step);

  useEffect(() => {
    setValueOverride(null);
    setDraft(String(normalizedValue));
  }, [normalizedValue]);

  const captureEntryValue = () => {
    const captured = onValueEntryStart?.();
    if (captured !== undefined && Number.isFinite(captured)) {
      const next = normalizeValue(captured, min, max, step);
      setValueOverride(next);
      setDraft(String(next));
    }
  };

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === '') {
      setValueOverride(null);
      setDraft(String(effectiveValue));
      return;
    }
    const next = normalizeValue(parsed, min, max, step);
    setValueOverride(next);
    setDraft(String(next));
    if (next !== effectiveValue) onChange(next);
  };

  return (
    <div
      className={cn(
        'noteboard-range-field flex min-w-0 items-center gap-2',
        compact ? 'gap-1' : 'gap-2',
        disabled && 'opacity-50',
        className,
      )}
      data-range-field="true"
    >
      <input
        id={id}
        aria-label={`${ariaLabel} slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={effectiveValue}
        disabled={disabled}
        onPointerDown={(event) => { event.stopPropagation(); captureEntryValue(); }}
        onChange={(event) => {
          const next = normalizeValue(Number(event.target.value), min, max, step);
          setValueOverride(next);
          setDraft(String(next));
          onChange(next);
        }}
        className={cn('noteboard-range min-w-0 flex-1 accent-blue-500', inputClassName)}
      />
      <label className={cn(
        'noteboard-range-value flex shrink-0 items-center justify-end gap-1 rounded-md bg-gray-100 px-1.5 text-gray-700',
        compact ? 'h-6 w-[3rem] min-w-[3rem] text-[10px]' : 'h-7 w-[3.25rem] min-w-[3.25rem] text-xs',
      )}>
        <input
          aria-label={`${ariaLabel} value`}
          type="number"
          data-text-px-control={dataTextPxControl || ariaLabel === 'Font size' ? 'true' : undefined}
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          onPointerDown={(event) => { event.stopPropagation(); captureEntryValue(); }}
          onFocus={captureEntryValue}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setValueOverride(null);
              setDraft(String(effectiveValue));
              event.currentTarget.blur();
            }
          }}
          className="noteboard-range-number w-full min-w-0 bg-transparent text-right font-bold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:cursor-not-allowed"
        />
        {suffix && <span className="shrink-0 whitespace-nowrap font-bold text-gray-500">{suffix}</span>}
      </label>
    </div>
  );
}
