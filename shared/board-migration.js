import { isSafeBoardWebLink } from "./board-data.js";

const neutralizeDanglingRichTextTargets = (content, validIds) =>
  content.replace(
    /(href\s*=\s*["'])#target-([a-zA-Z0-9_-]+)(["'])/gi,
    (match, prefix, targetId, suffix) =>
      validIds.has(targetId) ? match : `${prefix}#${suffix}`,
  );

export function repairLegacyBoard(source) {
  if (!source || typeof source !== "object" || !Array.isArray(source.elements)) {
    return source;
  }
  const validIds = new Set(
    source.elements
      .filter((element) => element && typeof element.id === "string")
      .map((element) => element.id),
  );
  const elements = source.elements.map((element, index) => {
    if (!element || typeof element !== "object") return element;
    const content =
      typeof element.content === "string" ? element.content : "";
    const parentId = validIds.has(element.parentId) ? element.parentId : undefined;
    const linkToId =
      validIds.has(element.linkToId) || isSafeBoardWebLink(element.linkToId)
        ? element.linkToId
        : undefined;
    return {
      ...element,
      content: neutralizeDanglingRichTextTargets(content, validIds),
      zIndex: Number.isFinite(element.zIndex) ? element.zIndex : index,
      parentId,
      linkToId,
    };
  });
  return { ...source, elements };
}
