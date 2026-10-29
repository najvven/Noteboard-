import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import type { BoardElement, Position } from "../../types";
import type { SelectMode } from './select-mode';
import {
  combineSelection,
  selectElementsInOutline,
  type SelectionOperation,
} from "./selection";

export function useOutlineSelection({
  tool,
  mode,
  zoom,
  surface,
  elements,
  selectedIds,
  onSelect,
  respectVisibility,
  capture,
  onInteraction,
  onArea,
  lockDelay,
}: {
  tool: string;
  mode: SelectMode;
  zoom: number;
  surface: RefObject<HTMLDivElement>;
  elements: readonly BoardElement[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  respectVisibility: boolean;
  capture: (event: PointerEvent) => void;
  onInteraction: (active: boolean) => void;
  onArea?: (outline: Position[] | null) => void;
  lockDelay: number;
}) {
  const enabled = tool === "select" && mode !== "rectangle";
  const [points, setPoints] = useState<Position[]>([]),
    [hover, setHover] = useState<Position | null>(null);
  const path = useRef<Position[]>([]),
    pointer = useRef<number | null>(null),
    operation = useRef<SelectionOperation>("replace"),
    baseline = useRef<string[]>([]);
  const ownsArea = useRef(false);
  const pending = useRef<{ pointerId: number; point: Position } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPending = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  };
  const replacePath = (value: Position[]) => {
    path.current = value;
    setPoints(value);
  };
  const cancel = () => {
    clearPending();
    replacePath([]);
    setHover(null);
    pointer.current = null;
    onInteraction(false);
  };
  useEffect(() => {
    if (ownsArea.current && tool !== "select" && tool !== "pan") {
      onArea?.(null);
      ownsArea.current = false;
    }
    cancel();
    return () => clearPending();
  }, [tool, mode, lockDelay]);
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = surface.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    };
  };
  const finish = () => {
    if (path.current.length < 3) { cancel(); return; }
    ownsArea.current = operation.current === "replace";
    onArea?.(operation.current === "replace" ? [...path.current] : null);
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
    if (pointer.current !== null && pointer.current !== event.pointerId) return true;
    event.preventDefault();
    event.stopPropagation();
    surface.current?.focus({preventScroll:true});
    window.getSelection()?.removeAllRanges();
    if (event.button !== 0) {
      onArea?.(null);
      cancel();
      return true;
    }
    const next = point(event);
    if (!path.current.length) {
      ownsArea.current = false;
      onArea?.(null);
      baseline.current = [...selectedIds];
      operation.current = event.altKey
        ? "subtract"
        : event.shiftKey
          ? "add"
          : "replace";
      if (lockDelay > 0) {
        clearPending();
        pending.current = { pointerId: event.pointerId, point: next };
        pointer.current = event.pointerId;
        capture(event);
        onInteraction(true);
        timer.current = setTimeout(() => {
          const activation = pending.current;
          if (!activation || pointer.current !== activation.pointerId) return;
          // Match Rectangle: movement before activation is discarded and the
          // anchor starts at the live cursor. Later Polygon vertices are clicks.
          replacePath([activation.point]);
          setHover(mode === "polygon" ? activation.point : null);
          clearPending();
        }, lockDelay);
        return true;
      }
    }
    if (mode === "polygon") {
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
    if (pending.current) {
      if (pending.current.pointerId === event.pointerId) pending.current.point = next;
      return true;
    }
    if (mode === "polygon") {
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
    if (event && pointer.current !== null && event.pointerId !== pointer.current) return true;
    if (pending.current) { cancel(); return true; }
    if (
      mode === "lasso" &&
      pointer.current !== null &&
      (!event || pointer.current === event.pointerId)
    )
      finish();
    else if (mode === "polygon" && pointer.current !== null) {
      pointer.current = null;
      onInteraction(false);
    }
    return true;
  };
  const key = (event: KeyboardEvent) => {
    if (!enabled || (!path.current.length && !pending.current)) return false;
    if (event.key === "Escape") cancel();
    else if (event.key === "Enter" && path.current.length >= 3) finish();
    else if (event.key === "Backspace" && mode === "polygon")
      replacePath(path.current.slice(0, -1));
    else return false;
    event.preventDefault();
    return true;
  };
  const outline =
    hover && mode === "polygon" ? [...points, hover] : points;
  return { enabled, begin, move, end, key, cancel, finish, points, outline };
}
