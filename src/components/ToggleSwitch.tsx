import React from 'react';
import { cn } from '../lib/utils';

/** Shared switch artwork. The owning button supplies its label and behavior. */
export default function ToggleSwitch({
  checked,
  disabled = false,
  compact = false,
}: {
  checked: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      data-menu-toggle="true"
      data-state={checked ? 'on' : 'off'}
      className={cn(
        'noteboard-toggle box-border inline-flex shrink-0 items-center rounded-full border border-gray-500/60 transition-colors duration-200 ease-in-out',
        compact ? 'h-3.5 w-6 p-px' : 'h-4 w-7 p-0.5',
        disabled && 'opacity-50',
        checked ? 'bg-blue-500' : 'bg-gray-200',
      )}
    >
      <span
        className={cn(
          'noteboard-toggle-thumb rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out',
          compact ? 'h-2.5 w-2.5' : 'h-3 w-3',
          checked && (compact ? 'translate-x-2.5' : 'translate-x-3'),
        )}
      />
    </span>
  );
}
