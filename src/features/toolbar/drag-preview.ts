export const TOOLBAR_EDITING_CLASSES = 'rounded-md border border-gray-400/60 bg-gray-200/25 [&>button]:justify-center';

/** Both drag paths show the actual toolbar control, at its current scale. */
export function createToolbarDragPreview(source: HTMLElement, scale: number) {
  const preview = source.cloneNode(true) as HTMLElement;
  preview.querySelectorAll('.toolbar-dropdown').forEach(node => node.remove());
  preview.removeAttribute('data-toolbar-item');
  preview.removeAttribute('data-toolbar-drag-suppressed');
  preview.removeAttribute('draggable');
  preview.setAttribute('aria-hidden', 'true');
  preview.inert = true;
  preview.classList.add(...TOOLBAR_EDITING_CLASSES.split(' '));
  Object.assign(preview.style, {
    position: 'fixed', display: 'flex', left: '-10000px', top: '0',
    width: 'max-content', zIndex: '2000', opacity: '1', pointerEvents: 'none',
    transition: 'none', animation: 'none',
    boxShadow: '0 14px 28px rgba(15, 23, 42, 0.2)',
    transform: `scale(${scale * 1.03})`, transformOrigin: 'top left',
  });
  document.body.append(preview);
  return preview;
}
