const TOP_FRAME_ONLY_GUARD = "if (window === window.top && window.location.href.startsWith('devtools://') === false) {";
const FRAME_SAFE_GUARD = "if (window.location.href.startsWith('devtools://') === false) {";

/** Enable the pinned Ghostery DOM monitor in each trusted guest frame. */
export function enableGhosterySubframeCosmetics(source) {
  if (typeof source !== 'string') throw new TypeError('Ghostery preload source must be text.');
  const matches = source.split(TOP_FRAME_ONLY_GUARD).length - 1;
  if (matches !== 1) throw new Error('The pinned Ghostery preload no longer matches the expected frame guard.');
  return source.replace(TOP_FRAME_ONLY_GUARD, FRAME_SAFE_GUARD);
}
