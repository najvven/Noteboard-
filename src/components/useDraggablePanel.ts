import { useEffect, useRef, useState, type PointerEvent } from "react";

type Position = { left: number; top: number };
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  width: number;
  height: number;
};

export function useDraggablePanel<T extends HTMLElement>() {
  const panelRef = useRef<T>(null);
  const dragRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (!position) return;
    const clampPosition = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      setPosition((current) => {
        if (!current) return current;
        const left = Math.max(8, Math.min(maxLeft, current.left));
        const top = Math.max(8, Math.min(maxTop, current.top));
        return left === current.left && top === current.top ? current : { left, top };
      });
    };
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [position !== null]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button,input,textarea,select,[contenteditable='true']")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    setPosition({ left: rect.left, top: rect.top });
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const left = Math.max(8, Math.min(
      Math.max(8, window.innerWidth - drag.width - 8),
      drag.startLeft + event.clientX - drag.startX,
    ));
    const top = Math.max(8, Math.min(
      Math.max(8, window.innerHeight - drag.height - 8),
      drag.startTop + event.clientY - drag.startY,
    ));
    setPosition({ left, top });
  };

  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    panelRef,
    panelStyle: position
      ? { left: position.left, top: position.top, right: "auto", bottom: "auto" }
      : undefined,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onLostPointerCapture: () => { dragRef.current = null; },
    },
  };
}
