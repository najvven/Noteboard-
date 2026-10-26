export interface PixelFillBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelFillResult {
  filledPixels: number;
  bounds: PixelFillBounds;
  touchesEdge: boolean;
}

type PixelBounds = { x: number; y: number; width: number; height: number };
type PixelSpan = { left: number; right: number };
type PixelFillTraversal = {
  visited: Uint8Array;
  filledPixels: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  touchesEdge: boolean;
};

/** Marks omitted embedded DOM regions as opaque, non-matching pixels before flood fill. */
export function applyPixelFillBarriers(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  barriers: readonly PixelFillBounds[],
  seedX: number,
  seedY: number,
): boolean {
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(width) || width <= 0 ||
    !Number.isSafeInteger(height) || height <= 0 ||
    !Number.isSafeInteger(pixelCount) || pixelCount > 0xffffffff ||
    pixels.length !== pixelCount * 4 ||
    !Number.isInteger(seedX) || !Number.isInteger(seedY) ||
    seedX < 0 || seedY < 0 || seedX >= width || seedY >= height
  ) return false;

  const normalized = barriers.flatMap(barrier => {
    if (![barrier.x, barrier.y, barrier.width, barrier.height].every(Number.isFinite) ||
        barrier.width <= 0 || barrier.height <= 0) return [];
    const left = Math.max(0, Math.floor(barrier.x));
    const top = Math.max(0, Math.floor(barrier.y));
    const right = Math.min(width, Math.ceil(barrier.x + barrier.width));
    const bottom = Math.min(height, Math.ceil(barrier.y + barrier.height));
    return right > left && bottom > top ? [{ left, top, right, bottom }] : [];
  });

  if (normalized.some(({ left, top, right, bottom }) =>
    seedX >= left && seedX < right && seedY >= top && seedY < bottom)) return false;

  const seedOffset = (seedY * width + seedX) * 4;
  const barrierColor = [0, 1, 2].map(channel => pixels[seedOffset + channel] >= 128 ? 0 : 255);
  for (const { left, top, right, bottom } of normalized) {
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = (y * width + x) * 4;
        pixels[offset] = barrierColor[0];
        pixels[offset + 1] = barrierColor[1];
        pixels[offset + 2] = barrierColor[2];
        pixels[offset + 3] = 255;
      }
    }
  }
  return true;
}

function parseHexColor(value: string): readonly [number, number, number, number] | null {
  const match = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  const raw = match[1];
  const expanded = raw.length <= 4 ? [...raw].map(char => char + char).join("") : raw;
  const color: readonly [number, number, number, number] = [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
    expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255,
  ];
  return color[3] === 0 ? null : color;
}

/**
 * Replaces the 4-connected region matching the clicked visible pixel. The
 * input buffer is converted into a transparent PNG mask in place: filled
 * pixels receive the requested color and every other pixel becomes transparent.
 */
function validFillInput(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  color: readonly [number, number, number, number] | null,
) {
  const pixelCount = width * height;
  return Number.isSafeInteger(width) && width > 0 &&
    Number.isSafeInteger(height) && height > 0 &&
    Number.isSafeInteger(pixelCount) && pixelCount <= 0xffffffff &&
    pixels.length === pixelCount * 4 &&
    Number.isInteger(seedX) && Number.isInteger(seedY) &&
    seedX >= 0 && seedY >= 0 && seedX < width && seedY < height &&
    color !== null;
}

function expandMatchingSpan(
  row: number,
  x: number,
  width: number,
  visited: Uint8Array,
  matchesSeed: (index: number) => boolean,
): PixelSpan {
  let left = x;
  let right = x;
  while (left > 0 && !visited[row + left - 1] && matchesSeed(row + left - 1)) left -= 1;
  while (right + 1 < width && !visited[row + right + 1] && matchesSeed(row + right + 1)) right += 1;
  return { left, right };
}

function markMatchingSpan(
  row: number,
  y: number,
  span: PixelSpan,
  width: number,
  height: number,
  visited: Uint8Array,
  bounds: PixelFillTraversal['bounds'],
): { filledPixels: number; touchesEdge: boolean } {
  let filledPixels = 0;
  let touchesEdge = false;
  for (let x = span.left; x <= span.right; x += 1) {
    const index = row + x;
    if (visited[index]) continue;
    visited[index] = 1;
    filledPixels += 1;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touchesEdge = true;
  }
  return { filledPixels, touchesEdge };
}

function enqueueAdjacentSpans(
  y: number,
  span: PixelSpan,
  width: number,
  height: number,
  visited: Uint8Array,
  matchesSeed: (index: number) => boolean,
  push: (index: number) => void,
) {
  for (const adjacentY of [y - 1, y + 1]) {
    if (adjacentY < 0 || adjacentY >= height) continue;
    const row = adjacentY * width;
    let x = span.left;
    while (x <= span.right) {
      const index = row + x;
      if (visited[index] || !matchesSeed(index)) {
        x += 1;
        continue;
      }
      push(index);
      do { x += 1; }
      while (x <= span.right && !visited[row + x] && matchesSeed(row + x));
    }
  }
}

function traverseConnectedRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  seed: readonly [number, number, number, number],
  tolerance: number,
): PixelFillTraversal {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  let stack = new Uint32Array(Math.min(pixelCount, Math.max(256, Math.min(width * 2, 65_536))));
  let stackSize = 0;
  const push = (index: number) => {
    if (stackSize === stack.length) {
      const next = new Uint32Array(Math.min(pixelCount, Math.max(stack.length + 1, stack.length * 2)));
      next.set(stack);
      stack = next;
    }
    stack[stackSize++] = index;
  };
  const matchesSeed = (index: number) => {
    const offset = index * 4;
    return Math.abs(pixels[offset] - seed[0]) <= tolerance &&
      Math.abs(pixels[offset + 1] - seed[1]) <= tolerance &&
      Math.abs(pixels[offset + 2] - seed[2]) <= tolerance &&
      Math.abs(pixels[offset + 3] - seed[3]) <= tolerance;
  };
  const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 };
  let filledPixels = 0;
  let touchesEdge = false;
  push(seedY * width + seedX);
  while (stackSize > 0) {
    const index = stack[--stackSize];
    const y = Math.floor(index / width);
    const x = index - y * width;
    if (visited[index] || !matchesSeed(index)) continue;
    const row = y * width;
    const span = expandMatchingSpan(row, x, width, visited, matchesSeed);
    const marked = markMatchingSpan(row, y, span, width, height, visited, bounds);
    filledPixels += marked.filledPixels;
    touchesEdge ||= marked.touchesEdge;
    enqueueAdjacentSpans(y, span, width, height, visited, matchesSeed, push);
  }
  return { visited, filledPixels, bounds, touchesEdge };
}

function colorConnectedRegion(
  pixels: Uint8ClampedArray,
  visited: Uint8Array,
  color: readonly [number, number, number, number],
  pixelCount: number,
) {
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (visited[index]) {
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    } else {
      pixels[offset + 3] = 0;
    }
  }
}

export function fillConnectedPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  fillColor: string,
  tolerance = 18,
): PixelFillResult | null {
  const pixelCount = width * height;
  const color = parseHexColor(fillColor);
  if (!color || !validFillInput(pixels, width, height, seedX, seedY, color)) return null;

  const seedOffset = (seedY * width + seedX) * 4;
  const seed: readonly [number, number, number, number] = [
    pixels[seedOffset], pixels[seedOffset + 1], pixels[seedOffset + 2], pixels[seedOffset + 3],
  ];
  if (seed[3] === 0 || (seed[0] === color[0] && seed[1] === color[1] && seed[2] === color[2] && color[3] === 255)) return null;

  const allowedDifference = Number.isFinite(tolerance)
    ? Math.max(0, Math.min(255, Math.floor(tolerance)))
    : 18;
  const traversal = traverseConnectedRegion(pixels, width, height, seedX, seedY, seed, allowedDifference);
  if (traversal.filledPixels === 0) return null;
  colorConnectedRegion(pixels, traversal.visited, color, pixelCount);

  return {
    filledPixels: traversal.filledPixels,
    bounds: {
      x: traversal.bounds.minX,
      y: traversal.bounds.minY,
      width: traversal.bounds.maxX - traversal.bounds.minX + 1,
      height: traversal.bounds.maxY - traversal.bounds.minY + 1,
    } satisfies PixelBounds,
    touchesEdge: traversal.touchesEdge,
  };
}
