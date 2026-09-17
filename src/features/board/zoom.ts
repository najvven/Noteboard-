/** Preserve the board-space point beneath a viewport anchor while scaling. */
export function anchoredZoomScroll({ scroll, anchor, boardOrigin, previousZoom, nextZoom }: {
  scroll: number; anchor: number; boardOrigin: number; previousZoom: number; nextZoom: number;
}) {
  return boardOrigin + (scroll + anchor - boardOrigin) * nextZoom / previousZoom - anchor;
}

export const clampZoom = (zoom: number) => Math.max(0.1, Math.min(5, zoom));
