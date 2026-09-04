import type { BoardElement } from "../../types";

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
