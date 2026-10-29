import type { BoardElement } from "../../types";
import { createElementHierarchy } from "./element-hierarchy";

export interface LayerMergeResult {
  elements: BoardElement[];
  survivorId: string;
  removedIds: ReadonlySet<string>;
}

const remapContentTargets = (
  content: string,
  removedIds: ReadonlySet<string>,
  survivorId: string,
) => content.replace(/<a\b[^>]*>/gi, anchor => anchor.replace(
  /(\bhref\s*=\s*)(["'])#target-([a-zA-Z0-9_-]+)\2/gi,
  (match, prefix: string, quote: string, targetId: string) =>
    removedIds.has(targetId) ? `${prefix}${quote}#target-${survivorId}${quote}` : match,
));

/** Merge same-parent layer containers without moving or deleting their contents. */
export function mergeSiblingLayers(
  elements: readonly BoardElement[],
  selectedIds: readonly string[],
): LayerMergeResult | null {
  const uniqueIds = [...new Set(selectedIds)];
  if (uniqueIds.length < 2) return null;

  const byId = new Map(elements.map(element => [element.id, element]));
  const selectedLayers = uniqueIds.map(id => byId.get(id));
  if (selectedLayers.some(element => !element || element.type !== "layer")) return null;
  const layers = selectedLayers as BoardElement[];
  const sharedParentId = layers[0].parentId;
  if (layers.some(layer => layer.parentId !== sharedParentId)) return null;

  const hierarchy = createElementHierarchy(elements);
  const orderedLayers = [...layers].sort(hierarchy.compare);
  const survivor = orderedLayers[orderedLayers.length - 1];
  const removedIds = new Set(orderedLayers.slice(0, -1).map(layer => layer.id));
  const selectedLayerIds = new Set(orderedLayers.map(layer => layer.id));
  const layerById = new Map(orderedLayers.map(layer => [layer.id, layer]));
  const mergedDirectChildren = elements
    .filter(element => element.parentId && selectedLayerIds.has(element.parentId))
    .sort(hierarchy.compare);
  const childZIndexes = new Map(mergedDirectChildren.map((element, index) => [element.id, index]));
  const promotedTarget = survivor.isLinkTarget
    ? undefined
    : [...orderedLayers].reverse().find(layer => layer.id !== survivor.id && layer.isLinkTarget);

  const next = elements.flatMap<BoardElement>(element => {
    if (removedIds.has(element.id)) return [];

    const isSurvivor = element.id === survivor.id;
    const sourceLayer = element.parentId ? layerById.get(element.parentId) : undefined;
    const isMergedRoot = Boolean(sourceLayer);
    const parentId = element.parentId && removedIds.has(element.parentId)
      ? survivor.id
      : element.parentId;
    const linkToId = element.linkToId && removedIds.has(element.linkToId)
      ? survivor.id
      : element.linkToId;
    const groupOriginalParentId = element.groupOriginalParentId && removedIds.has(element.groupOriginalParentId)
      ? survivor.id
      : element.groupOriginalParentId;
    const content = remapContentTargets(element.content ?? "", removedIds, survivor.id);

    if (isSurvivor) {
      return [{
        ...element,
        isHidden: false,
        isLocked: false,
        ...(promotedTarget ? { isLinkTarget: true, linkTargetName: promotedTarget.linkTargetName } : {}),
        ...(linkToId !== element.linkToId ? { linkToId } : {}),
        ...(groupOriginalParentId !== element.groupOriginalParentId ? { groupOriginalParentId } : {}),
        ...(content !== element.content ? { content } : {}),
      }];
    }

    if (!isMergedRoot && linkToId === element.linkToId &&
      groupOriginalParentId === element.groupOriginalParentId && content === element.content) {
      return [element];
    }

    return [{
      ...element,
      ...(isMergedRoot ? {
        parentId: survivor.id,
        zIndex: childZIndexes.get(element.id)!,
        isHidden: element.isHidden === true || sourceLayer?.isHidden === true,
        isLocked: element.isLocked === true || sourceLayer?.isLocked === true,
      } : {}),
      ...(parentId !== element.parentId ? { parentId } : {}),
      ...(linkToId !== element.linkToId ? { linkToId } : {}),
      ...(groupOriginalParentId !== element.groupOriginalParentId ? { groupOriginalParentId } : {}),
      ...(content !== element.content ? { content } : {}),
    }];
  });

  return { elements: next, survivorId: survivor.id, removedIds };
}
