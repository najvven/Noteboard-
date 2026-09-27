import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import type { BoardElement, Position } from "../../types";
import {
  combineSelection,
  selectElementsInOutline,
  type SelectionOperation,
} from "./selection";

export function useOutlineSelection({
  tool,
  zoom,
  surface,
  elements,
  selectedIds,
  onSelect,
  respectVisibility,
  capture,
  onInteraction,
}: {
  tool: string;
  zoom: number;
  surface: RefObject<HTMLDivElement>;
  elements: readonly BoardElement[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  respectVisibility: boolean;
  capture: (event: PointerEvent) => void;
  onInteraction: (active: boolean) => void;
}) {
  const enabled = tool === "polygon-select" || tool === "lasso";
  const [points, setPoints] = useState<Position[]>([]),
    [hover, setHover] = useState<Position | null>(null);
  const path = useRef<Position[]>([]),
    pointer = useRef<number | null>(null),
    operation = useRef<SelectionOperation>("replace"),
    baseline = useRef<string[]>([]);
  const replacePath = (value: Position[]) => {
    path.current = value;
    setPoints(value);
  };
  const cancel = () => {
    replacePath([]);
    setHover(null);
    pointer.current = null;
    onInteraction(false);
  };
  useEffect(() => {
    cancel();
  }, [tool]);
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = surface.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    };
  };
  const finish = () => {
    onSelect(
      combineSelection(
        baseline.current,
        selectElementsInOutline(elements, path.current, respectVisibility),
        operation.current,
      ),
    );
    cancel();
  };
  const begin = (event: PointerEvent) => {
    if (!enabled) return false;
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    if (event.button !== 0) {
      cancel();
      return true;
    }
    const next = point(event);
    if (!path.current.length) {
      baseline.current = [...selectedIds];
      operation.current = event.altKey
        ? "subtract"
        : event.shiftKey
          ? "add"
          : "replace";
    }
    if (tool === "polygon-select") {
      if (
        path.current.length >= 3 &&
        Math.hypot(next.x - path.current[0].x, next.y - path.current[0].y) *
          zoom <
          10
      )
        finish();
      else replacePath([...path.current, next]);
      setHover(next);
    } else {
      replacePath([next]);
      pointer.current = event.pointerId;
      capture(event);
      onInteraction(true);
    }
    return true;
  };
  const move = (event: PointerEvent) => {
    if (!enabled) return false;
    const next = point(event);
    if (tool === "polygon-select") {
      if (path.current.length) setHover(next);
    } else if (pointer.current === event.pointerId) {
      const last = path.current.at(-1)!;
      if (Math.hypot(next.x - last.x, next.y - last.y) * zoom >= 2) {
        // Bound a long gesture while retaining its overall outline.
        const previous =
          path.current.length > 8000
            ? path.current.filter((_, i) => i % 2 === 0)
            : path.current;
        replacePath([...previous, next]);
      }
    }
    return true;
  };
  const end = (event?: { pointerId: number }) => {
    if (!enabled) return false;
    if (
      tool === "lasso" &&
      pointer.current !== null &&
      (!event || pointer.current === event.pointerId)
    )
      finish();
    return true;
  };
  const key = (event: KeyboardEvent) => {
    if (!enabled || !path.current.length) return false;
    if (event.key === "Escape") cancel();
    else if (event.key === "Enter" && path.current.length >= 3) finish();
    else if (event.key === "Backspace" && tool === "polygon-select")
      replacePath(path.current.slice(0, -1));
    else return false;
    event.preventDefault();
    return true;
  };
  const outline =
    hover && tool === "polygon-select" ? [...points, hover] : points;
  return { enabled, begin, move, end, key, cancel, finish, points, outline };
}
