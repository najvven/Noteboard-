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

  const ancestors = (id: string) => {
    const chain: BoardElement[] = [];
    const visited = new Set<string>();
    let current = byId.get(id);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return chain;
  };

  const stackPath = (id: string) => ancestors(id).map((element) => element.zIndex).reverse();
  const hasAncestor = (id: string, predicate: (element: BoardElement) => boolean) => {
    const visited = new Set<string>();
    let current = byId.get(id);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (predicate(current)) return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
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
    isDescendantOf: (id, ancestorId) => hasAncestor(id, element => element.id !== id && element.id === ancestorId),
    isLocked: (id) => hasAncestor(id, element => element.isLocked === true),
    isVisible: (id, respectVisibility) =>
      !respectVisibility || !hasAncestor(id, element => element.isHidden === true),
    stackPath,
    compare,
  };
};
