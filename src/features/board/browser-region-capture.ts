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
  let minX = 0, minY = 0;
  let maxX = root.clientWidth, maxY = root.clientHeight;
  const contentNodes = root.querySelectorAll<HTMLElement>('[data-board-element="true"], [data-board-surface="true"]');
  for (const node of contentNodes) {
    const rect = node.getBoundingClientRect();
    minX = Math.min(minX, (rect.left - rootRect.left) / zoom);
    minY = Math.min(minY, (rect.top - rootRect.top) / zoom);
    maxX = Math.max(maxX, (rect.right - rootRect.left) / zoom);
    maxY = Math.max(maxY, (rect.bottom - rootRect.top) / zoom);
  }

  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);
  const rasterWidth = Math.ceil(width * zoom);
  const rasterHeight = Math.ceil(height * zoom);
  if (!Number.isSafeInteger(rasterWidth * rasterHeight) || rasterWidth * rasterHeight > MAX_CAPTURE_PIXELS)
    throw new Error('The visible board is too large to capture. Reduce the board area and try again.');

  const { toCanvas } = await import('html-to-image');
  const source = await toCanvas(root, {
    width,
    height,
    pixelRatio: zoom,
    backgroundColor: 'transparent',
    style: {
      position: 'relative',
      left: '0px',
      top: '0px',
      transform: `translate(${-minX}px, ${-minY}px)`,
      transformOrigin: 'top left',
      overflow: 'visible',
    },
    filter: node => {
      if (!(node instanceof HTMLElement)) return true;
      const tag = node.tagName.toLowerCase();
      return tag !== 'webview' && tag !== 'iframe' && !node.hasAttribute('data-board-fill-capture-exclude');
    },
  });

  const sourceX = requested.left - rootRect.left - minX * zoom;
  const sourceY = requested.top - rootRect.top - minY * zoom;
  const cropWidth = Math.ceil(requested.right - requested.left);
  const cropHeight = Math.ceil(requested.bottom - requested.top);
  const output = document.createElement('canvas');
  output.width = cropWidth;
  output.height = cropHeight;
  const context = output.getContext('2d');
  if (!context) throw new Error('Could not create the visible board capture.');
  context.drawImage(source, sourceX, sourceY, requested.right - requested.left, requested.bottom - requested.top, 0, 0, cropWidth, cropHeight);

  return {
    dataUrl: output.toDataURL('image/png'),
    rect: { x: requested.left, y: requested.top, width: requested.right - requested.left, height: requested.bottom - requested.top },
  };
}
