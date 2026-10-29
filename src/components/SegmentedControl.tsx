import React from 'react';
import { cn } from '../lib/utils';

export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  narrow = false,
  disabled = false,
  variant = 'settings',
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  label: string;
  narrow?: boolean;
  disabled?: boolean;
  /** Toolbar controls retain their compact grouped appearance. */
  variant?: 'settings' | 'toolbar';
}) {
  const toolbar = variant === 'toolbar';
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        toolbar
          ? 'menu-settings-control flex shrink-0 rounded-lg border border-gray-200 bg-gray-100 p-0.5 shadow-inner'
          : 'inline-grid w-fit max-w-full min-w-0 grid-flow-col auto-cols-fr items-stretch gap-1',
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-w-0 text-center font-bold normal-case tracking-normal leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            toolbar
              ? cn(
                  'rounded-md',
                  narrow
                    ? 'min-h-5 px-1 py-0.5 text-[9px]'
                    : 'min-h-6 px-1.5 py-1 text-[10px]',
                  value === option.value
                    ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5'
                    : 'text-gray-500 hover:bg-gray-200/50 hover:text-black',
                )
              : cn(
                  'flex-1 rounded-md border',
                  narrow
                    ? 'min-h-5 min-w-10 px-1 py-0.5 text-[9px]'
                    : 'min-h-6 min-w-12 px-2 py-1 text-[10px]',
                  value === option.value
                    ? 'border-blue-400 bg-blue-100 text-blue-800'
                    : 'border-gray-300 bg-gray-100 text-gray-600 hover:border-gray-400 hover:bg-gray-200',
                ),
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
