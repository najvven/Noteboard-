export interface ClientRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CapturedRegion {
  dataUrl: string;
  rect: { x: number; y: number; width: number; height: number };
}

const MAX_CAPTURE_PIXELS = 10_000_000;

/** Render the application-owned board DOM in browser preview when Electron IPC is unavailable. */
export async function captureBoardRegionFromDOM(
  root: HTMLElement,
  requested: ClientRegion,
  zoom: number,
): Promise<CapturedRegion> {
  if (!Number.isFinite(zoom) || zoom <= 0 ||
      ![requested.left, requested.top, requested.right, requested.bottom].every(Number.isFinite) ||
      requested.right <= requested.left || requested.bottom <= requested.top)
    throw new Error('Invalid visible board capture region.');

  const rootRect = root.getBoundingClientRect();
  const requestedWidth = requested.right - requested.left;
  const requestedHeight = requested.bottom - requested.top;
  const rasterWidth = Math.ceil(requestedWidth);
  const rasterHeight = Math.ceil(requestedHeight);
  if (!Number.isSafeInteger(rasterWidth * rasterHeight) || rasterWidth * rasterHeight > MAX_CAPTURE_PIXELS)
    throw new Error('The visible area is too large to fill. Zoom out until the board fits inside the window, or reduce the window size.');

  const sourceX = (requested.left - rootRect.left) / zoom;
  const sourceY = (requested.top - rootRect.top) / zoom;
  const { toCanvas } = await import('html-to-image');
  const source = await toCanvas(root, {
    width: requestedWidth / zoom,
    height: requestedHeight / zoom,
    pixelRatio: zoom,
    backgroundColor: 'transparent',
    style: {
      position: 'relative',
      left: '0px',
      top: '0px',
      transform: `translate(${-sourceX}px, ${-sourceY}px)`,
      transformOrigin: 'top left',
      overflow: 'visible',
    },
    filter: node => {
      if (!(node instanceof HTMLElement)) return true;
      const tag = node.tagName.toLowerCase();
      if (tag === 'webview' || tag === 'iframe' || node.hasAttribute('data-board-fill-capture-exclude')) return false;
      if (node !== root && node.hasAttribute('data-board-element')) {
        const rect = node.getBoundingClientRect();
        const padding = 24;
        return rect.right > requested.left - padding && rect.left < requested.right + padding &&
          rect.bottom > requested.top - padding && rect.top < requested.bottom + padding;
      }
      return true;
    },
  });

  const output = document.createElement('canvas');
  output.width = rasterWidth;
  output.height = rasterHeight;
  const context = output.getContext('2d');
  if (!context) throw new Error('Could not create the visible board capture.');
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, rasterWidth, rasterHeight);

  return {
    dataUrl: output.toDataURL('image/png'),
    rect: { x: requested.left, y: requested.top, width: requested.right - requested.left, height: requested.bottom - requested.top },
  };
}
