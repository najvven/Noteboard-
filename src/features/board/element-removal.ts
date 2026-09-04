import type { BoardElement } from "../../types";

const neutralizeRemovedRichTextTargets = (
  content: string,
  removedIds: ReadonlySet<string>,
) =>
  content.replace(
    /(href\s*=\s*["'])#target-([a-zA-Z0-9_-]+)(["'])/gi,
    (match, prefix: string, targetId: string, suffix: string) =>
      removedIds.has(targetId) ? `${prefix}#${suffix}` : match,
  );

export interface ElementRemovalResult {
  elements: BoardElement[];
  removedIds: Set<string>;
}

export const collectElementTreeIds = (
  elements: readonly BoardElement[],
  rootId: string,
) => {
  const childrenByParent = new Map<string, string[]>();
  elements.forEach((element) => {
    if (!element.parentId) return;
    const children = childrenByParent.get(element.parentId) ?? [];
    children.push(element.id);
    childrenByParent.set(element.parentId, children);
  });
  const removedIds = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const currentId = pending.pop()!;
    if (removedIds.has(currentId)) continue;
    removedIds.add(currentId);
    pending.push(...(childrenByParent.get(currentId) ?? []));
  }
  return removedIds;
};

export const removeElementTreeAndReferences = (
  elements: readonly BoardElement[],
  rootId: string,
): ElementRemovalResult => {
  const removedIds = collectElementTreeIds(elements, rootId);
  const survivingElements = elements
    .filter((element) => !removedIds.has(element.id))
    .map<BoardElement>((element) => {
      const nextParentId =
        element.parentId && removedIds.has(element.parentId)
          ? undefined
          : element.parentId;
      const nextLinkToId =
        element.linkToId && removedIds.has(element.linkToId)
          ? undefined
          : element.linkToId;
      const nextContent = neutralizeRemovedRichTextTargets(
        element.content ?? "",
        removedIds,
      );
      if (
        nextParentId === element.parentId &&
        nextLinkToId === element.linkToId &&
        nextContent === element.content
      ) {
        return element;
      }
      return {
        ...element,
        parentId: nextParentId,
        linkToId: nextLinkToId,
        content: nextContent,
      };
    });
  return { elements: survivingElements, removedIds };
};
