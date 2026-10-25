import type { BoardElement } from "../../types";
import { normalizeWebUrl } from "./model";

/** Electron guest methods throw until dom-ready; saving must still be safe. */
export function readLiveWebviewUrl(view: { getURL?: () => string; src?: string; getAttribute?: (name: string) => string | null }, fallback = ''): string {
  const requested = view.getAttribute?.('data-web-requested-url');
  const normalizedRequested = normalizeWebUrl(requested || '');
  const navigationPending = view.getAttribute?.('data-web-navigation-pending') === 'true';
  if (navigationPending && normalizedRequested && normalizedRequested !== 'about:blank')
    return normalizedRequested;
  try {
    const current = view.getURL?.();
    if (current && current !== 'about:blank') return current;
  } catch {
    // Initial navigation can still be pending while the board autosaves.
  }
  const source = view.src || view.getAttribute?.('src');
  return normalizedRequested || (source && source !== 'about:blank' ? source : fallback || source) || '';
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
