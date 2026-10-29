import { useEffect, useId, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { validateBoardLinkTargetDraft } from "./link-target";

interface LinkTargetInputProps {
  value?: string;
  displayValue?: string;
  validElementIds: ReadonlySet<string>;
  allowWebLinks?: boolean;
  manualPicking?: boolean;
  className?: string;
  onFocus?: () => void;
  onCommit: (value?: string) => void;
}

export function LinkTargetInput({
  value,
  displayValue,
  validElementIds,
  allowWebLinks = true,
  manualPicking = false,
  className,
  onFocus,
  onCommit,
}: LinkTargetInputProps) {
  const [draft, setDraft] = useState(displayValue ?? value ?? "");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    setDraft(manualPicking ? "Click an object..." : displayValue ?? value ?? "");
    setDirty(false);
    setError("");
  }, [displayValue, manualPicking, value]);

  const commitDraft = () => {
    if (!dirty || manualPicking) return true;
    const validation = validateBoardLinkTargetDraft(draft, validElementIds);
    if (
      validation.error ||
      (!allowWebLinks &&
        validation.value !== undefined &&
        !validElementIds.has(validation.value))
    ) {
      setError(
        allowWebLinks
          ? validation.error ?? "Choose a valid target."
          : "Choose an existing object for a text-fragment link.",
      );
      return false;
    }
    onCommit(validation.value);
    setDirty(false);
    setError("");
    return true;
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        placeholder="Choose or paste a web link"
        value={draft}
        readOnly={manualPicking}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : undefined}
        onFocus={(event) => {
          onFocus?.();
          if (!manualPicking) event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setDirty(true);
          setError("");
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (commitDraft()) inputRef.current?.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(displayValue ?? value ?? "");
            setDirty(false);
            setError("");
            inputRef.current?.blur();
          }
        }}
        className={cn(className, error && "!border-red-400 !ring-red-100")}
      />
      {error && (
        <p
          id={errorId}
          role="alert"
          className="absolute left-0 top-full z-[70] mt-1 w-full rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 shadow-sm"
        >
          {error}
        </p>
      )}
    </>
  );
}
