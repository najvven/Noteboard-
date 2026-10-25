import type { BoardElement } from "../../types";

export interface ElementHierarchy {
  byId: ReadonlyMap<string, BoardElement>;
  ancestors(id: string): readonly BoardElement[];
  isDescendantOf(id: string, ancestorId: string): boolean;
  isLocked(id: string): boolean;
  isVisible(id: string, respectVisibility: boolean): boolean;
  stackPath(id: string): readonly number[];
  compare(left: BoardElement, right: BoardElement): number;
}

export const createElementHierarchy = (
  elements: readonly BoardElement[],
): ElementHierarchy => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const ancestryCache = new Map<string, readonly BoardElement[]>();
  const stackCache = new Map<string, readonly number[]>();

  const ancestors = (id: string) => {
    const cached = ancestryCache.get(id);
    if (cached) return cached;
    const chain: BoardElement[] = [];
    const visited = new Set<string>();
    let current = byId.get(id);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    ancestryCache.set(id, chain);
    return chain;
  };

  const stackPath = (id: string) => {
    const cached = stackCache.get(id);
    if (cached) return cached;
    const path = ancestors(id)
      .map((element) => element.zIndex)
      .reverse();
    stackCache.set(id, path);
    return path;
  };

  const compare = (left: BoardElement, right: BoardElement) => {
    const leftPath = stackPath(left.id);
    const rightPath = stackPath(right.id);
    const length = Math.max(leftPath.length, rightPath.length);
    for (let index = 0; index < length; index += 1) {
      const leftValue = leftPath[index] ?? leftPath[index - 1] ?? 0;
      const rightValue = rightPath[index] ?? rightPath[index - 1] ?? 0;
      if (leftValue !== rightValue) return leftValue - rightValue;
    }
    return left.id.localeCompare(right.id);
  };

  return {
    byId,
    ancestors,
    isDescendantOf: (id, ancestorId) =>
      ancestors(id)
        .slice(1)
        .some((element) => element.id === ancestorId),
    isLocked: (id) => ancestors(id).some((element) => element.isLocked),
    isVisible: (id, respectVisibility) =>
      !respectVisibility || !ancestors(id).some((element) => element.isHidden),
    stackPath,
    compare,
  };
};
