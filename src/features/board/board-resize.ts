import type { BoardElement, Position, Size } from "../../types";
import { createElementHierarchy } from "./element-hierarchy";
import { elementPolygon, pointInPolygon } from "./section-clipping";

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
  const boards = elements
    .filter((element) => element.type === "board")
    .sort((a, b) => b.zIndex - a.zIndex);
  return new Set(
    elements
      .filter((element) => {
        if (element.type === "board" || element.type === "layer") return false;
        const parent = hierarchy
          .ancestors(element.id)
          .slice(1)
          .find((ancestor) => ancestor.type === "board");
        if (parent) return parent.id === boardId;
        const point = {
          x: element.position.x + (element.size?.width ?? 100) / 2,
          y: element.position.y + (element.size?.height ?? 40) / 2,
        };
        const owner = boards.find((board) =>
          pointInPolygon(point, elementPolygon(board)),
        );
        return owner
          ? owner.id === boardId
          : boardId === "main-board" &&
              point.x >= 0 &&
              point.y >= 0 &&
              point.x <= mainSize.width &&
              point.y <= mainSize.height;
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
