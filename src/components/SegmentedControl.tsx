import React from 'react';
import { cn } from '../lib/utils';

export default function SegmentedControl<T extends string>({ value, onChange, options, label, narrow = false, disabled = false }: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  label: string;
  narrow?: boolean;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="menu-settings-control flex shrink-0 rounded-lg border border-gray-200 bg-gray-100 p-0.5 shadow-inner">
      {options.map(option => (
        <button key={option.value} type="button" disabled={disabled} aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn('rounded-md font-bold normal-case tracking-normal text-center leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            narrow ? 'min-h-5 px-1 py-0.5 text-[9px]' : 'min-h-6 px-1.5 py-1 text-[10px]',
            value === option.value ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:bg-gray-200/50 hover:text-black')}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
