export interface KeyboardShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export interface ShortcutBinding {
  commandId: string;
  shortcut: string;
  enabled?: boolean;
}

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const MODIFIER_SET = new Set<string>(MODIFIER_ORDER);
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  alt: "Alt",
  option: "Alt",
  control: "Ctrl",
  ctrl: "Ctrl",
  command: "Meta",
  cmd: "Meta",
  meta: "Meta",
  shift: "Shift",
};
const SPECIAL_KEYS: Record<string, string> = {
  " ": "Space",
  space: "Space",
  spacebar: "Space",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  backspace: "Backspace",
  delete: "Delete",
  end: "End",
  enter: "Enter",
  escape: "Escape",
  home: "Home",
  pagedown: "PageDown",
  pageup: "PageUp",
  tab: "Tab",
};

export const normalizeShortcutKey = (key: string) => {
  const trimmed = key.trim();
  if (!trimmed && key !== " ") return "";
  const lower = (key === " " ? " " : trimmed).toLowerCase();
  if (MODIFIER_ALIASES[lower]) return MODIFIER_ALIASES[lower];
  if (SPECIAL_KEYS[lower]) return SPECIAL_KEYS[lower];
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed.length === 1
    ? trimmed.toUpperCase()
    : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1).toLowerCase()}`;
};

export const shortcutParts = (shortcut: string) => {
  const compact = shortcut.trim().replace(/\s*\+\s*/g, "+");
  if (compact === "+") return ["+"];
  if (compact.endsWith("++"))
    return [...compact.slice(0, -2).split("+").filter(Boolean), "+"];
  return compact.split("+").filter(Boolean);
};

export const normalizeShortcut = (shortcut: string) => {
  const unique = new Set(
    shortcutParts(shortcut)
      .map(normalizeShortcutKey)
      .filter(Boolean),
  );
  const modifiers = MODIFIER_ORDER.filter((modifier) => unique.delete(modifier));
  return [...modifiers, ...unique].join("+");
};

export const shortcutFromEvent = (event: KeyboardShortcutEvent) => {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  const key = normalizeShortcutKey(event.key);
  if (key && !MODIFIER_ORDER.includes(key as (typeof MODIFIER_ORDER)[number])) {
    parts.push(key);
  }
  return normalizeShortcut(parts.join("+"));
};

export const shortcutMatchesEvent = (
  shortcut: string,
  event: KeyboardShortcutEvent,
) => normalizeShortcut(shortcut) !== "" && normalizeShortcut(shortcut) === shortcutFromEvent(event);

export const findShortcutConflict = (
  shortcut: string,
  bindings: readonly ShortcutBinding[],
) => {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return undefined;
  return bindings.find(
    (binding) =>
      binding.enabled !== false && normalizeShortcut(binding.shortcut) === normalized,
  );
};

export const isSafeStructuralShortcut = (shortcut: string) => {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return false;
  const parts = shortcutParts(normalized);
  const keys = parts.filter((part) => !MODIFIER_SET.has(part));
  return keys.length === 1 && parts.some((part) => part === "Ctrl" || part === "Alt" || part === "Meta");
};

export const shouldHandleSpreadsheetKeyboard = (
  isTypingTarget: boolean,
  isFocusedSelectedCell: boolean,
) => !isTypingTarget || isFocusedSelectedCell;
