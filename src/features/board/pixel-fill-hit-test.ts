import type { BoardElement, Position } from '../../types';

interface PixelFillMask {
  width: number;
  height: number;
  opaque: Uint8Array;
}

const MAX_MASK_PIXELS = 10_000_000;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const masks = new Map<string, PixelFillMask>();
const pending = new Map<string, Promise<PixelFillMask | null>>();
const failed = new Set<string>();
let cacheBytes = 0;

function packAlphaMask(pixels: Uint8ClampedArray, width: number, height: number): PixelFillMask | null {
  const pixelCount = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      !Number.isSafeInteger(pixelCount) || pixelCount > MAX_MASK_PIXELS || pixels.length !== pixelCount * 4)
    return null;
  const opaque = new Uint8Array(Math.ceil(pixelCount / 8));
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (pixels[pixel * 4 + 3] > 0) opaque[pixel >>> 3] |= 1 << (pixel & 7);
  }
  return { width, height, opaque };
}

function rememberMask(content: string, mask: PixelFillMask | null) {
  if (!mask || mask.opaque.byteLength > MAX_CACHE_BYTES) return;
  const previous = masks.get(content);
  if (previous) cacheBytes -= previous.opaque.byteLength;
  masks.delete(content);
  while (cacheBytes + mask.opaque.byteLength > MAX_CACHE_BYTES) {
    const oldest = masks.keys().next().value as string | undefined;
    if (!oldest) break;
    const expired = masks.get(oldest);
    if (expired) cacheBytes -= expired.opaque.byteLength;
    masks.delete(oldest);
  }
  masks.set(content, mask);
  cacheBytes += mask.opaque.byteLength;
}

/** Register a just-created raster fill so hit testing is ready before its first interaction. */
export function rememberPixelFillAlphaMask(content: string, pixels: Uint8ClampedArray, width: number, height: number) {
  rememberMask(content, packAlphaMask(pixels, width, height));
}

async function loadMask(content: string): Promise<PixelFillMask | null> {
  const encoded = /^data:image\/png;base64,([a-z\d+/=]+)$/i.exec(content)?.[1];
  if (encoded) {
    const header = atob(encoded.slice(0, 32));
    if (header.length >= 24) {
      const headerBytes = Uint8Array.from(header, char => char.codePointAt(0)!);
      const dimensions = new DataView(headerBytes.buffer);
      const width = dimensions.getUint32(16);
      const height = dimensions.getUint32(20);
      if (!width || !height || width * height > MAX_MASK_PIXELS) return null;
    }
  }
  const image = new Image();
  image.src = content;
  await image.decode();
  if (image.naturalWidth * image.naturalHeight > MAX_MASK_PIXELS) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  return packAlphaMask(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

function getMask(content: string) {
  const cached = masks.get(content);
  if (cached) {
    masks.delete(content);
    masks.set(content, cached);
    return cached;
  }
  if (failed.has(content)) return null;
  if (!pending.has(content)) {
    const loading = loadMask(content).then(mask => {
      rememberMask(content, mask);
      if (!mask) failed.add(content);
      return mask;
    }).catch(() => { failed.add(content); return null; }).finally(() => pending.delete(content));
    pending.set(content, loading);
  }
  return null;
}

/** Returns undefined while an alpha mask is unavailable, so hit testing cannot fall through. */
export function isPixelFillOpaqueAtPoint(element: BoardElement, point: Position): boolean | undefined {
  if (!element.isPixelFill) return true;
  const content = element.content || '';
  if (!content) return false;
  const mask = getMask(content);
  if (!mask) return undefined;

  const width = element.size?.width ?? 0;
  const height = element.size?.height ?? 0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const dx = point.x - (element.position.x + width / 2);
  const dy = point.y - (element.position.y + height / 2);
  const radians = -(element.rotation ?? 0) * Math.PI / 180;
  let localX = width / 2 + dx * Math.cos(radians) - dy * Math.sin(radians);
  let localY = height / 2 + dx * Math.sin(radians) + dy * Math.cos(radians);
  if (element.flipX) localX = width - localX;
  if (element.flipY) localY = height - localY;
  if (localX < 0 || localY < 0 || localX >= width || localY >= height) return false;

  const crop = element.crop;
  const left = Math.max(0, Math.min(95, crop?.left ?? 0));
  const right = Math.max(0, Math.min(95 - left, crop?.right ?? 0));
  const top = Math.max(0, Math.min(95, crop?.top ?? 0));
  const bottom = Math.max(0, Math.min(95 - top, crop?.bottom ?? 0));
  const sourceX = Math.floor((left + (localX / width) * (100 - left - right)) / 100 * mask.width);
  const sourceY = Math.floor((top + (localY / height) * (100 - top - bottom)) / 100 * mask.height);
  if (sourceX < 0 || sourceY < 0 || sourceX >= mask.width || sourceY >= mask.height) return false;
  const index = sourceY * mask.width + sourceX;
  return (mask.opaque[index >>> 3] & (1 << (index & 7))) !== 0;
}
