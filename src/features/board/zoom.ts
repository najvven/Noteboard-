/** Preserve the board-space point beneath a viewport anchor while scaling. */
export function anchoredZoomScroll({ scroll, anchor, boardOrigin, previousZoom, nextZoom }: {
  scroll: number; anchor: number; boardOrigin: number; previousZoom: number; nextZoom: number;
}) {
  return boardOrigin + (scroll + anchor - boardOrigin) * nextZoom / previousZoom - anchor;
}

export const MIN_BOARD_ZOOM = 0.1;
export const MAX_BOARD_ZOOM = 32;
export const clampZoom = (zoom: number) => Math.max(MIN_BOARD_ZOOM, Math.min(MAX_BOARD_ZOOM, Number.isFinite(zoom) ? zoom : 1));
