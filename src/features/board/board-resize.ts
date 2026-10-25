import type { BoardElement, Position, Size } from "../../types";
import { createElementHierarchy } from "./element-hierarchy";
import { resolveElementBoardOwner } from "./board-surfaces";

export interface MainBoardGeometry {
  size: Size;
  position: Position;
}

export function boardMemberIds(
  elements: readonly BoardElement[],
  boardId: string,
  mainSize: Size,
) {
  const hierarchy = createElementHierarchy(elements);
  return new Set(
    elements
      .filter((element) => {
        if (element.type === "board" || element.type === "layer") return false;
        return resolveElementBoardOwner(element, elements, mainSize, hierarchy)?.id === boardId;
      })
      .map((element) => element.id),
  );
}

export function resizeMainBoard({
  start,
  elements,
  members,
  mode,
  dx,
  dy,
  zoom,
  keepContent,
  snap = (value: number) => value,
}: {
  start: MainBoardGeometry;
  elements: readonly BoardElement[];
  members: ReadonlySet<string>;
  mode: string;
  dx: number;
  dy: number;
  zoom: number;
  keepContent: boolean;
  snap?: (value: number) => number;
}) {
  const left = mode.includes("left"),
    top = mode.includes("top");
  const width = Math.max(
    100,
    Math.min(
      1_000_000,
      snap(
        left
          ? start.size.width - dx
          : mode.includes("right") || mode === "both"
            ? start.size.width + dx
            : start.size.width,
      ),
    ),
  );
  const height = Math.max(
    100,
    Math.min(
      1_000_000,
      snap(
        top
          ? start.size.height - dy
          : mode.includes("bottom") || mode === "both"
            ? start.size.height + dy
            : start.size.height,
      ),
    ),
  );
  const shift = {
    x: left ? start.size.width - width : 0,
    y: top ? start.size.height - height : 0,
  };
  return {
    geometry: {
      size: { width, height },
      position: {
        x: start.position.x + shift.x * zoom,
        y: start.position.y + shift.y * zoom,
      },
    },
    elements: elements.map((element) =>
      !keepContent && members.has(element.id)
        ? element
        : {
            ...element,
            position: {
              x: element.position.x - shift.x,
              y: element.position.y - shift.y,
            },
          },
    ),
  };
}
