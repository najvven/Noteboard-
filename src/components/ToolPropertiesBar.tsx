import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';

const SCROLL_ROW_HEIGHT = 12;

/** The extra scroll row grows downward without moving or squeezing controls. */
export default function ToolPropertiesBar({ children }: { children: React.ReactNode; key?: React.Key }) {
  const viewportId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; grabOffset: number } | null>(null);
  const [metrics, setMetrics] = useState({ maximum: 0, position: 0, fraction: 1 });
  const measure = () => {
    const scroll = viewport.current;
    if (!scroll) return;
    const maximum = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const next = { maximum, position: scroll.scrollLeft, fraction: Math.min(1, scroll.clientWidth / Math.max(1, scroll.scrollWidth)) };
    setMetrics(previous => Object.keys(next).every(key => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next);
  };
  useLayoutEffect(() => {
    const scroll = viewport.current, row = content.current;
    if (!scroll || !row) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroll); observer.observe(row); measure();
    return () => observer.disconnect();
  }, []);
  const overflowing = metrics.maximum > 1;
  const moveThumb = (clientX: number) => {
    if (!drag.current || !track.current || !thumb.current || !viewport.current) return;
    const bounds = track.current.getBoundingClientRect();
    const travel = bounds.width - thumb.current.getBoundingClientRect().width;
    const progress = Math.max(0, Math.min(1, (clientX - bounds.left - drag.current.grabOffset) / Math.max(1, travel)));
    viewport.current.scrollLeft = progress * (viewport.current.scrollWidth - viewport.current.clientWidth);
    measure();
  };
  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <motion.div data-bottom-toolbar="true" data-scroll-row={overflowing || undefined} role="toolbar" aria-label="Element properties"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
      className="fixed left-1/2 -translate-x-1/2 box-border w-max max-w-[95vw] bg-white border-[3px] border-gray-800 shadow-2xl rounded-2xl p-2 z-[200] overflow-hidden"
      style={{ bottom: 32 - (overflowing ? SCROLL_ROW_HEIGHT : 0) }}
      onPointerDown={event => {
        if (!(event.target as HTMLElement).closest('button,input,select,[contenteditable="true"]')) event.preventDefault();
        event.stopPropagation();
      }}>
      <div id={viewportId} ref={viewport} onScroll={measure} className="bottom-toolbar-scroll min-w-0 overflow-x-auto overflow-y-hidden">
        <div ref={content} className="flex w-max min-h-12 items-center gap-3">{children}</div>
      </div>
      {overflowing && (
        <div data-property-scroll-row="true" className="box-border px-2 pt-[7px]" style={{ height: SCROLL_ROW_HEIGHT }}>
          <div ref={track} role="scrollbar" aria-label="Scroll element properties" aria-orientation="horizontal" aria-controls={viewportId}
            aria-valuemin={0} aria-valuemax={Math.round(metrics.maximum)} aria-valuenow={Math.round(metrics.position)} tabIndex={0}
            className="relative h-1.5 w-full touch-none rounded-full bg-gray-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            onPointerDown={event => {
              if (event.button !== 0 || !thumb.current) return;
              event.preventDefault(); event.stopPropagation();
              const bounds = thumb.current.getBoundingClientRect();
              drag.current = { pointerId: event.pointerId, grabOffset: event.target === thumb.current ? event.clientX - bounds.left : bounds.width / 2 };
              event.currentTarget.setPointerCapture(event.pointerId); moveThumb(event.clientX);
            }}
            onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) moveThumb(event.clientX); }}
            onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { drag.current = null; }}
            onKeyDown={event => {
              const scroll = viewport.current;
              if (!scroll) return;
              const targets: Record<string, number> = { ArrowLeft: scroll.scrollLeft - 40, ArrowRight: scroll.scrollLeft + 40, Home: 0, End: metrics.maximum, PageUp: scroll.scrollLeft - scroll.clientWidth, PageDown: scroll.scrollLeft + scroll.clientWidth };
              if (event.key in targets) { event.preventDefault(); event.stopPropagation(); scroll.scrollLeft = targets[event.key]; }
            }}>
            <div ref={thumb} aria-hidden="true" className="absolute top-0 h-full rounded-full bg-gray-400 hover:bg-gray-500"
              style={{ width: `${metrics.fraction * 100}%`, left: `${(metrics.position / metrics.maximum) * (1 - metrics.fraction) * 100}%` }} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
