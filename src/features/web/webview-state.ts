import type { BoardElement } from "../../types";

/** Electron guest methods throw until dom-ready; saving must still be safe. */
export function readLiveWebviewUrl(view: { getURL?: () => string; src?: string; getAttribute?: (name: string) => string | null }, fallback = ''): string {
  try {
    const current = view.getURL?.();
    if (current && current !== 'about:blank') return current;
  } catch {
    // Initial navigation can still be pending while the board autosaves.
  }
  const requested = view.getAttribute?.('data-web-requested-url');
  const source = view.src || view.getAttribute?.('src');
  return requested || (source && source !== 'about:blank' ? source : fallback || source) || '';
}

export const mergeLiveWebviewUrls = (
  elements: readonly BoardElement[],
  liveUrls: ReadonlyMap<string, string>,
) => {
  if (!liveUrls.size) return elements;
  let changed = false;
  const merged = elements.map((element) => {
    if (element.type !== "embed") return element;
    const currentUrl = liveUrls.get(element.id);
    if (!currentUrl || currentUrl === element.content) return element;
    changed = true;
    return {
      ...element,
      content: currentUrl,
      mediaKind: "web" as const,
      webSessionId: element.webSessionId || element.id,
    };
  });
  return changed ? merged : elements;
};
