import type { ElementType } from "../../types";

const VISUAL_ELEMENT_TYPES: ReadonlySet<ElementType> = new Set([
  "text",
  "h1",
  "h2",
  "h3",
  "bullet-list",
  "numbered-list",
  "quote",
  "code",
  "checklist",
  "section",
  "rectangle",
  "ellipse",
  "triangle",
  "diamond",
  "hexagon",
  "board",
  "sticky",
  "image",
  "media",
  "embed",
  "table",
  "draw",
  "line",
  "blank",
  "group",
  "arrow",
]);

/** True for rendered board elements with the shared outer transform. */
export const isFlippableElementType = (type: string): type is ElementType =>
  VISUAL_ELEMENT_TYPES.has(type as ElementType);
