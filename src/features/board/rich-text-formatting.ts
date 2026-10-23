export const TEXT_PRESENTATION_ATTRIBUTE = 'data-noteboard-text-presentation';
const TEXT_PRESENTATION_RUN = 'line-grid-run';
const TEXT_PRESENTATION_BLOCK = 'line-grid-block';
const TEXT_PRESENTATION_CARET = 'caret-run';
const INTERNAL_CARET_CHARACTER = '\u200b';
const TEXT_PRESENTATION_SELECTOR = `[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_RUN}"]`;
const TEXT_BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3']);
const TEXT_LINE_TAGS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3']);

function removeFirstInternalCaretCharacter(wrapper: HTMLElement) {
  const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const index = node.data.indexOf(INTERNAL_CARET_CHARACTER);
    if (index < 0) continue;
    node.deleteData(index, INTERNAL_CARET_CHARACTER.length);
    return;
  }
}

function unwrapCaretRun(wrapper: HTMLElement, removeEmpty = true) {
  removeFirstInternalCaretCharacter(wrapper);
  const parent = wrapper.parentNode;
  if (!parent) return;
  if (!wrapper.textContent && removeEmpty) {
    wrapper.remove();
    return;
  }
  while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
  wrapper.remove();
}

function unwrapTextLineCaretRuns(editor: HTMLElement, removeEmpty = true) {
  editor
    .querySelectorAll<HTMLElement>(`[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`)
    .forEach((wrapper) => unwrapCaretRun(wrapper, removeEmpty));
}

/** Remove display-only text and block wrappers while keeping original child nodes. */
export function unwrapTextLinePresentationRuns(editor: HTMLElement) {
  unwrapTextLineOverflowRuns(editor);
  editor
    .querySelectorAll<HTMLElement>(TEXT_PRESENTATION_SELECTOR)
    .forEach((wrapper) => {
      const parent = wrapper.parentNode;
      if (!parent) return;
      while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
      wrapper.remove();
    });
  editor
    .querySelectorAll<HTMLElement>(`[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_BLOCK}"]`)
    .forEach((block) => block.removeAttribute(TEXT_PRESENTATION_ATTRIBUTE));
  editor
    .querySelectorAll<HTMLElement>('li')
    .forEach((item) => item.style.removeProperty('--text-line-marker-size'));
}

/** Remove only helper-owned caret markers before returning to ordinary text layout. */
export function removeTextLineCaretRuns(editor: HTMLElement) {
  unwrapTextLineCaretRuns(editor);
}

function wrapDirectInlineContent(editor: HTMLElement) {
  let group: Node[] = [];
  const flush = () => {
    const hasVisibleContent = group.some((node) =>
      node instanceof Element
        ? node.tagName === 'BR' || Boolean(node.textContent)
        : node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
    );
    if (hasVisibleContent && group.length) {
      const block = document.createElement('div');
      block.setAttribute(TEXT_PRESENTATION_ATTRIBUTE, TEXT_PRESENTATION_BLOCK);
      editor.insertBefore(block, group[0]);
      group.forEach((node) => block.appendChild(node));
    }
    group = [];
  };

  for (const node of Array.from(editor.childNodes)) {
    if (node instanceof Element && TEXT_BLOCK_TAGS.has(node.tagName)) {
      flush();
    } else {
      group.push(node);
    }
  }
  flush();
}

function collectTextRuns(editor: HTMLElement, rootFontSize: number, presentedOnly = false) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const runs: Array<{ node: Text; fontSize: number }> = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data) continue;
    const caretRun = node.parentElement?.closest(
      `[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`,
    );
    if (caretRun && node.data.replace(INTERNAL_CARET_CHARACTER, '') === '') continue;
    const alreadyPresented = Boolean(node.parentElement?.closest(
      `[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_RUN}"]`,
    ));
    if (presentedOnly && alreadyPresented) continue;
    const parent = node.parentElement;
    const size = parent
      ? Number.parseFloat(window.getComputedStyle(parent).fontSize)
      : rootFontSize;
    runs.push({ node, fontSize: Number.isFinite(size) && size > 0 ? size : rootFontSize });
  }
  return runs;
}

function hasVisibleLineContent(element: Element) {
  return Array.from(element.childNodes).some((node) => {
    if (node instanceof Element) {
      if (node.hasAttribute(TEXT_PRESENTATION_ATTRIBUTE)) {
        return node.getAttribute(TEXT_PRESENTATION_ATTRIBUTE) === TEXT_PRESENTATION_CARET &&
          Boolean(node.textContent?.replace(INTERNAL_CARET_CHARACTER, '').trim());
      }
      return Boolean(node.textContent?.replace(INTERNAL_CARET_CHARACTER, '').trim());
    }
    return node.nodeType === Node.TEXT_NODE &&
      Boolean(node.textContent?.replace(INTERNAL_CARET_CHARACTER, '').trim());
  });
}

function isEmptyTextLine(element: HTMLElement) {
  if (element.querySelector(Array.from(TEXT_LINE_TAGS).join(','))) return false;
  return !hasVisibleLineContent(element);
}

function setCaretRunFontSize(run: HTMLElement, size: number) {
  run.style.display = 'inline';
  run.style.fontSize = `${size}px`;
  run.style.lineHeight = 'var(--text-line-spacing, 24px)';
  run.style.verticalAlign = 'top';
}

function insertCaretRun(target: HTMLElement, fontSize: number, selectionRange: Range | null) {
  const existing = target.querySelector<HTMLElement>(
    `[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`,
  );
  if (existing) {
    setCaretRunFontSize(existing, fontSize);
    return null;
  }

  const run = document.createElement('span');
  run.setAttribute(TEXT_PRESENTATION_ATTRIBUTE, TEXT_PRESENTATION_CARET);
  run.appendChild(document.createTextNode(INTERNAL_CARET_CHARACTER));
  setCaretRunFontSize(run, fontSize);
  const firstBreak = target.querySelector(':scope > br');
  firstBreak?.remove();
  target.appendChild(run);

  if (
    selectionRange?.collapsed &&
    (selectionRange.startContainer === target || target.contains(selectionRange.startContainer))
  ) {
    const caret = document.createRange();
    caret.setStart(run.firstChild!, 1);
    caret.collapse(true);
    return caret;
  }
  return null;
}

function ensureEmptyBlockLine(editor: HTMLElement) {
  const block = document.createElement('div');
  block.setAttribute(TEXT_PRESENTATION_ATTRIBUTE, TEXT_PRESENTATION_BLOCK);
  editor.appendChild(block);
  return block;
}

function ensureTextLineCaretRuns(
  editor: HTMLElement,
  mode: 'everywhere' | 'blocks',
  rootFontSize: number,
  selectionRange: Range | null,
) {
  if (mode === 'blocks') {
    const hasDirectLineBlock = Array.from(editor.children).some((child) =>
      TEXT_BLOCK_TAGS.has(child.tagName),
    );
    const hasDirectInlineText = Array.from(editor.childNodes).some((node) =>
      node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
    );
    if (!hasDirectLineBlock && !hasDirectInlineText) ensureEmptyBlockLine(editor);
  }

  const candidates = Array.from(editor.querySelectorAll<HTMLElement>(Array.from(TEXT_LINE_TAGS).join(',')))
    .filter(isEmptyTextLine);
  const rootHasLineBlock = Array.from(editor.children).some((child) => TEXT_BLOCK_TAGS.has(child.tagName));
  if (mode === 'everywhere' && !rootHasLineBlock && !hasVisibleLineContent(editor)) {
    candidates.unshift(editor);
  }

  let restoredCaret: Range | null = null;
  candidates.forEach((target) => {
    const size = Number.parseFloat(window.getComputedStyle(target).fontSize);
    const nextRange = insertCaretRun(
      target,
      Number.isFinite(size) && size > 0 ? size : rootFontSize,
      selectionRange,
    );
    if (nextRange) restoredCaret = nextRange;
  });
  return restoredCaret ?? selectionRange;
}

function normalizeCaretRunsWithContent(editor: HTMLElement) {
  editor
    .querySelectorAll<HTMLElement>(`[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`)
    .forEach((wrapper) => {
      if (wrapper.textContent === INTERNAL_CARET_CHARACTER) return;
      unwrapCaretRun(wrapper, false);
    });
}

/** Move a collapsed caret from an empty line's block boundary into its visible-font landing run. */
export function focusEmptyTextLineCaret(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.getRangeAt(0).collapsed) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) && range.startContainer !== editor) return;

  let line: HTMLElement | null = null;
  if (range.startContainer === editor) {
    const adjacent = editor.childNodes[range.startOffset] ?? editor.childNodes[range.startOffset - 1];
    const adjacentElement = adjacent instanceof HTMLElement
      ? adjacent
      : adjacent?.parentElement;
    line = adjacentElement?.closest<HTMLElement>(Array.from(TEXT_LINE_TAGS).join(',')) ?? null;
  } else {
    const startElement = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
    line = startElement?.closest<HTMLElement>(Array.from(TEXT_LINE_TAGS).join(',')) ?? null;
  }
  if (!line || !editor.contains(line) || !isEmptyTextLine(line)) return;

  const caretRun = line.querySelector<HTMLElement>(
    `[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`,
  );
  const text = caretRun?.firstChild;
  if (!(text instanceof Text) || text.data !== INTERNAL_CARET_CHARACTER) return;
  const nextRange = document.createRange();
  nextRange.setStart(text, 1);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}

function wrapTextRuns(runs: Array<{ node: Text; fontSize: number }>) {
  runs.forEach(({ node, fontSize }) => {
    if (!node.parentNode) return;
    const run = document.createElement('span');
    run.setAttribute(TEXT_PRESENTATION_ATTRIBUTE, TEXT_PRESENTATION_RUN);
    run.style.display = 'inline';
    run.style.fontSize = `${fontSize}px`;
    run.style.lineHeight = 'var(--text-line-spacing, 24px)';
    run.style.verticalAlign = 'top';
    node.parentNode.insertBefore(run, node);
    run.appendChild(node);
  });
}

function copyTextRunFontStyle(source: CSSStyleDeclaration, target: HTMLElement) {
  target.style.fontFamily = source.fontFamily;
  target.style.fontSize = source.fontSize;
  target.style.fontWeight = source.fontWeight;
  target.style.fontStyle = source.fontStyle;
  target.style.fontVariant = source.fontVariant;
  target.style.fontStretch = source.fontStretch;
  target.style.fontKerning = source.fontKerning;
  target.style.fontFeatureSettings = source.fontFeatureSettings;
  target.style.fontVariationSettings = source.fontVariationSettings;
  target.style.letterSpacing = source.letterSpacing;
  target.style.wordSpacing = source.wordSpacing;
  target.style.textTransform = source.textTransform;
}

/** Measure the browser's own baseline within one fixed-pitch, top-aligned row. */
function measureRunBaselineOffset(run: HTMLElement, lineSpacing: number) {
  const sourceStyle = window.getComputedStyle(run);
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-100000px';
  probe.style.top = '-100000px';
  probe.style.display = 'block';
  probe.style.width = `${Math.max(100, lineSpacing * 16)}px`;
  probe.style.height = `${lineSpacing}px`;
  probe.style.margin = '0';
  probe.style.padding = '0';
  probe.style.border = '0';
  probe.style.overflow = 'visible';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.whiteSpace = 'nowrap';
  probe.style.fontSize = '0';
  probe.style.lineHeight = `${lineSpacing}px`;

  const sample = document.createElement('span');
  sample.style.display = 'inline';
  sample.style.lineHeight = `${lineSpacing}px`;
  sample.style.verticalAlign = 'top';
  copyTextRunFontStyle(sourceStyle, sample);

  const marker = document.createElement('span');
  marker.style.display = 'inline-block';
  marker.style.width = '0';
  marker.style.height = '0';
  marker.style.margin = '0';
  marker.style.padding = '0';
  marker.style.border = '0';
  marker.style.lineHeight = '0';
  marker.style.verticalAlign = 'baseline';

  sample.append(marker, document.createTextNode('Hg'));
  probe.appendChild(sample);
  document.body.appendChild(probe);
  const offset = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  return Number.isFinite(offset) ? offset : lineSpacing / 2;
}

/** Align each presentation run to the center of the painted rule without changing flow. */
function alignTextRunBaselines(editor: HTMLElement, lineSpacing: number, lineCenter: number) {
  const offsets = new Map<string, number>();
  editor.querySelectorAll<HTMLElement>(
    `[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_RUN}"], [${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`,
  ).forEach((run) => {
    const style = window.getComputedStyle(run);
    const key = [
      style.fontFamily,
      style.fontSize,
      style.fontWeight,
      style.fontStyle,
      style.fontVariant,
      style.fontStretch,
      style.fontKerning,
      style.fontFeatureSettings,
      style.fontVariationSettings,
      style.letterSpacing,
      style.wordSpacing,
      style.textTransform,
      lineSpacing,
    ].join('|');
    let baselineOffset = offsets.get(key);
    if (baselineOffset === undefined) {
      baselineOffset = measureRunBaselineOffset(run, lineSpacing);
      offsets.set(key, baselineOffset);
    }
    run.style.position = 'relative';
    run.style.top = `${lineCenter - baselineOffset}px`;
  });
}

function collectMarkerFontSizes(editor: HTMLElement, rootFontSize: number, refresh: boolean) {
  const markerSizes = new Map<HTMLElement, number>();
  editor.querySelectorAll<HTMLElement>('li').forEach((item) => {
    if (!refresh && item.style.getPropertyValue('--text-line-marker-size')) return;
    const size = Number.parseFloat(window.getComputedStyle(item).fontSize);
    markerSizes.set(item, Number.isFinite(size) && size > 0 ? size : rootFontSize);
  });
  return markerSizes;
}

function setMarkerFontSizes(editor: HTMLElement, rootFontSize: number, markerSizes: Map<HTMLElement, number>) {
  editor.style.setProperty('--text-line-marker-size', `${rootFontSize}px`);
  markerSizes.forEach((size, item) => {
    item.style.setProperty('--text-line-marker-size', `${size}px`);
  });
}


const TEXT_LAYOUT_INSERTION_ATTRIBUTE = 'data-text-layout-insertion';
const TEXT_LAYOUT_MARKER_ATTRIBUTE = 'data-text-layout-marker';
const TEXT_OVERFLOW_BLOCK = 'line-grid-overflow-block';

export interface TextLineLayout {
  pitch: number;
  availableHeight: number;
  contentHeight: number;
  viewportHeight: number;
  fullRows: number;
  rulesEnabled: boolean;
  uniformRows: boolean;
  rows: Array<{ top: number; bottom: number; baseline?: number; inserted?: boolean; insertedText?: boolean; insertedBreak?: boolean; listItemPath?: number[] }>;
  overflowText: Array<{ path: number[]; offset: number }>;
}

interface InlineBoxExtents {
  above: number;
  below: number;
}

function getTextLineMode(editor: HTMLElement) {
  if (editor.classList.contains('text-lines-everywhere')) return 'everywhere';
  if (editor.classList.contains('text-lines-blocks')) return 'blocks';
  return null;
}

function getNearestTextLineBlock(editor: HTMLElement, element: HTMLElement | null) {
  const lineSelector = Array.from(TEXT_LINE_TAGS).join(',');
  const block = element?.closest<HTMLElement>(lineSelector);
  return block && editor.contains(block) ? block : editor;
}

function getInlineBoxExtents(source: HTMLElement, sampleText: string, cache: Map<string, InlineBoxExtents>) {
  const style = window.getComputedStyle(source);
  const key = [
    style.fontFamily,
    style.fontSize,
    style.fontWeight,
    style.fontStyle,
    style.fontVariant,
    style.fontStretch,
    style.fontKerning,
    style.fontFeatureSettings,
    style.fontVariationSettings,
    style.letterSpacing,
    style.wordSpacing,
    style.textTransform,
    style.lineHeight,
    sampleText,
  ].join('|');
  const cached = cache.get(key);
  if (cached) return cached;

  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-100000px';
  probe.style.top = '0';
  probe.style.display = 'block';
  probe.style.width = 'max-content';
  probe.style.margin = '0';
  probe.style.padding = '0';
  probe.style.border = '0';
  probe.style.overflow = 'visible';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.whiteSpace = 'nowrap';
  probe.style.fontSize = '0';
  probe.style.lineHeight = '0';

  const run = document.createElement('span');
  run.style.display = 'inline';
  run.style.lineHeight = style.lineHeight;
  run.style.verticalAlign = 'baseline';
  copyTextRunFontStyle(style, run);

  const marker = document.createElement('span');
  marker.style.display = 'inline-block';
  marker.style.width = '0';
  marker.style.height = '0';
  marker.style.margin = '0';
  marker.style.padding = '0';
  marker.style.border = '0';
  marker.style.lineHeight = '0';
  marker.style.verticalAlign = 'baseline';
  run.append(document.createTextNode(sampleText || 'Hg'), marker);
  probe.appendChild(run);
  document.body.appendChild(probe);

  const box = probe.getBoundingClientRect();
  const baseline = marker.getBoundingClientRect().top;
  const above = Math.max(0, baseline - box.top);
  const below = Math.max(0, box.bottom - baseline);
  probe.remove();
  const result = { above, below };
  cache.set(key, result);
  return result;
}

function getTextLineStrutPitch(editor: HTMLElement, cache: Map<string, InlineBoxExtents>) {
  const extents = getInlineBoxExtents(editor, 'Hg', cache);
  return Math.max(1, extents.above + extents.below);
}

/** Read local CSS box dimensions without integer clientWidth/clientHeight rounding. */
function getLocalContentBoxSize(element: HTMLElement, axis: 'width' | 'height') {
  const style = window.getComputedStyle(element);
  const horizontal = axis === 'width';
  const value = Number.parseFloat(style[axis]);
  const padding = horizontal
    ? (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
    : (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  const border = horizontal
    ? (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0)
    : (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
  if (Number.isFinite(value)) {
    return Math.max(0, value - (style.boxSizing === 'border-box' ? padding + border : 0));
  }
  const clientSize = horizontal ? element.clientWidth : element.clientHeight;
  return Math.max(0, clientSize - padding);
}

function findTextFragmentStart(node: Text, targetTop: number) {
  let low = 0;
  let high = node.length;
  const getCharacterTop = (offset: number) => {
    if (offset < 0 || offset >= node.length) return Number.POSITIVE_INFINITY;
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    return range.getBoundingClientRect().top;
  };
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const top = getCharacterTop(middle);
    if (!Number.isFinite(top) || top < targetTop - 0.75) low = middle + 1;
    else high = middle;
  }
  for (let offset = Math.max(0, low - 2); offset < Math.min(node.length, low + 3); offset += 1) {
    if (Math.abs(getCharacterTop(offset) - targetTop) <= 0.75) return offset;
  }
  return Math.min(Math.max(0, low), Math.max(0, node.length - 1));
}

function createTextLayoutMarker() {
  const marker = document.createElement('span');
  marker.setAttribute(TEXT_LAYOUT_MARKER_ATTRIBUTE, 'true');
  marker.style.display = 'inline-block';
  marker.style.width = '0';
  marker.style.height = '0';
  marker.style.margin = '0';
  marker.style.padding = '0';
  marker.style.border = '0';
  marker.style.lineHeight = '0';
  marker.style.verticalAlign = 'baseline';
  marker.style.pointerEvents = 'none';
  return marker;
}

function measureNativeTextRows(
  editor: HTMLElement,
  initialViewportContentHeight: number,
  pitch: number,
  rulesEnabled: boolean,
  lineCenter: number,
  cache: Map<string, InlineBoxExtents>,
) {
  const groups: Array<{ baseline: number; block: HTMLElement; listItemPath?: number[]; above: number; below: number; inserted: boolean; insertedText: boolean; insertedBreak: boolean; segments: Array<{ path: number[]; offset: number }> }> = [];
  let viewportContentHeight = initialViewportContentHeight;
  const editorTop = editor.getBoundingClientRect().top;
  const paddingTop = Number.parseFloat(window.getComputedStyle(editor).paddingTop) || 0;
  const textNodes: Array<{ node: Text; path: number[]; listItemPath?: number[]; source: HTMLElement; block: HTMLElement; inserted: boolean }> = [];
  const rootExtents = getInlineBoxExtents(editor, 'Hg', cache);
  let maxMeasuredLineExtent = rootExtents.above + rootExtents.below;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data) continue;
    if (node.parentElement?.closest(`[${TEXT_LAYOUT_MARKER_ATTRIBUTE}]`)) continue;
    if (node.parentElement?.closest(`[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`) &&
      node.data.replace(INTERNAL_CARET_CHARACTER, '') === '' &&
      !node.parentElement.closest(`[${TEXT_LAYOUT_INSERTION_ATTRIBUTE}]`)) continue;
    const source = node.parentElement ?? editor;
    const path = getNodePath(editor, node);
    if (!path) continue;
    const listItem = source.closest<HTMLElement>('li');
    const listItemPath = listItem && editor.contains(listItem) ? getNodePath(editor, listItem) ?? undefined : undefined;
    const block = getNearestTextLineBlock(editor, source);
    const sourceExtents = getInlineBoxExtents(source, 'Hg', cache);
    const strutExtents = getInlineBoxExtents(block, 'Hg', cache);
    maxMeasuredLineExtent = Math.max(maxMeasuredLineExtent,
      sourceExtents.above + sourceExtents.below,
      strutExtents.above + strutExtents.below);
    textNodes.push({
      node,
      path,
      listItemPath,
      source,
      block,
      inserted: Boolean(node.parentElement?.closest(`[${TEXT_LAYOUT_INSERTION_ATTRIBUTE}]`)),
    });
  }
  editor.querySelectorAll<HTMLElement>('li').forEach((item) => {
    const extents = getInlineBoxExtents(item, 'Hg', cache);
    maxMeasuredLineExtent = Math.max(maxMeasuredLineExtent, extents.above + extents.below);
  });

  // Keep the search band above the viewport by the largest measured inline
  // extent plus one pitch. A large glyph can overflow while its painted top
  // still lies inside the viewport, so viewport.bottom alone is not a safe
  // cutoff. The first overflow marker remains the final authority.
  const scanThroughTop = editorTop + paddingTop + viewportContentHeight + maxMeasuredLineExtent + pitch + 0.75;
  const addMarkerRecord = (
    marker: HTMLElement,
    source: HTMLElement,
    block: HTMLElement,
    sample: string,
    inserted: boolean,
    isBreak = false,
    path?: number[],
    listItemPath?: number[],
    offset?: number,
  ) => {
    const baseline = marker.getBoundingClientRect().top;
    const runExtents = getInlineBoxExtents(source, sample, cache);
    const strutExtents = getInlineBoxExtents(block, sample, cache);
    const above = Math.max(runExtents.above, strutExtents.above);
    const below = Math.max(runExtents.below, strutExtents.below);
    let group = groups.find((candidate) => candidate.block === block && Math.abs(candidate.baseline - baseline) <= 0.75);
    if (group) {
      group.above = Math.max(group.above, above);
      group.below = Math.max(group.below, below);
      group.inserted ||= inserted;
      group.insertedText ||= inserted && !isBreak;
      group.insertedBreak ||= inserted && isBreak;
      group.listItemPath ??= listItemPath;
      if (path && offset !== undefined && !group.segments.some((segment) =>
        segment.offset === offset && segment.path.length === path.length && segment.path.every((index, position) => index === path[position]),
      )) group.segments.push({ path, offset });
    } else {
      group = {
        baseline,
        block,
        listItemPath,
        above,
        below,
        inserted,
        insertedText: inserted && !isBreak,
        insertedBreak: inserted && isBreak,
        segments: path && offset !== undefined ? [{ path, offset }] : [],
      };
      groups.push(group);
    }
    const top = rulesEnabled
      ? baseline - lineCenter - editorTop - paddingTop
      : baseline - group.above - editorTop - paddingTop;
    const bottom = rulesEnabled
      ? top + pitch
      : baseline + group.below - editorTop - paddingTop;
    const crossesViewport = !rulesEnabled && top < viewportContentHeight - 0.75 && bottom > viewportContentHeight + 0.75;
    if (crossesViewport) viewportContentHeight = Math.min(viewportContentHeight, Math.max(0, top));
    return top >= viewportContentHeight - 0.75 || crossesViewport;
  };

  const addTextOffsetMarker = (
    node: Text,
    offset: number,
    record: (typeof textNodes)[number],
  ) => {
    const sample = node.data.slice(offset, offset + 1) || 'Hg';
    const suffix = node.splitText(offset);
    const marker = createTextLayoutMarker();
    suffix.parentNode?.insertBefore(marker, suffix);
    const overflow = addMarkerRecord(marker, record.source, record.block, sample,
      record.inserted, false, record.path, record.listItemPath, offset);
    marker.remove();
    node.appendData(suffix.data);
    suffix.remove();
    return overflow;
  };

  for (const record of textNodes) {
    const { node } = record;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    const seenTops = new Set<number>();
    for (const rect of rects) {
      const topKey = Math.round(rect.top * 4) / 4;
      if (seenTops.has(topKey)) continue;
      seenTops.add(topKey);
      const offset = findTextFragmentStart(node, rect.top);
      const beyondSafeBand = rect.top > scanThroughTop;
      const overflow = addTextOffsetMarker(node, offset, record);
      if (overflow) break;
      // If a fragment outside the conservative band does not measure as
      // overflow, keep following actual browser geometry rather than hiding it.
      if (beyondSafeBand) continue;
    }
  }

  for (const lineBreak of editor.querySelectorAll<HTMLBRElement>('br')) {
    const source = lineBreak.parentElement instanceof HTMLElement ? lineBreak.parentElement : editor;
    const block = getNearestTextLineBlock(editor, source);
    const listItem = source.closest<HTMLElement>('li');
    const listItemPath = listItem && editor.contains(listItem) ? getNodePath(editor, listItem) ?? undefined : undefined;
    const inserted = Boolean(lineBreak.closest(`[${TEXT_LAYOUT_INSERTION_ATTRIBUTE}]`));
    if (!inserted && lineBreak.getBoundingClientRect().top > scanThroughTop) continue;
    const before = createTextLayoutMarker();
    lineBreak.parentNode?.insertBefore(before, lineBreak);
    const beforeOverflow = addMarkerRecord(before, block, block, 'Hg', inserted, true, undefined, listItemPath);
    before.remove();
    const after = createTextLayoutMarker();
    lineBreak.parentNode?.insertBefore(after, lineBreak.nextSibling);
    const afterOverflow = addMarkerRecord(after, block, block, 'Hg', inserted, true, undefined, listItemPath);
    after.remove();
    if (inserted && (beforeOverflow || afterOverflow)) break;
  }

  const measuredListItems = new Set(groups.flatMap((group) => group.listItemPath ? [group.listItemPath.join('.')] : []));
  for (const item of editor.querySelectorAll<HTMLElement>('li')) {
    const path = getNodePath(editor, item);
    if (!path || measuredListItems.has(path.join('.'))) continue;
    const rect = item.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const rowTop = rect.top - editorTop - paddingTop;
    const baseline = rulesEnabled ? rect.top + lineCenter : rect.top;
    groups.push({
      baseline,
      block: item,
      listItemPath: path,
      above: 0,
      below: rulesEnabled ? 0 : rect.height,
      inserted: false,
      insertedText: false,
      insertedBreak: false,
      segments: [],
    });
    if (!rulesEnabled && rowTop < viewportContentHeight - 0.75 && rect.bottom - editorTop - paddingTop > viewportContentHeight + 0.75) {
      viewportContentHeight = Math.min(viewportContentHeight, Math.max(0, rowTop));
    }
  }

  return {
    viewportContentHeight,
    rows: groups.map((group) => ({
    top: rulesEnabled
      ? group.baseline - lineCenter - editorTop - paddingTop
      : group.baseline - group.above - editorTop - paddingTop,
    bottom: rulesEnabled
      ? group.baseline - lineCenter - editorTop - paddingTop + pitch
      : group.baseline + group.below - editorTop - paddingTop,
    baseline: group.baseline,
    inserted: group.inserted,
    insertedText: group.insertedText,
    insertedBreak: group.insertedBreak,
    listItemPath: group.listItemPath,
    segments: group.segments,
    })),
  };
}

function getEditorContentBox(editor: HTMLElement, maximumHeight?: number) {
  const style = window.getComputedStyle(editor);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const parentHeight = editor.parentElement
    ? getLocalContentBoxSize(editor.parentElement, 'height')
    : getLocalContentBoxSize(editor, 'height');
  const boundedHeight = Number.isFinite(maximumHeight) && maximumHeight! > 0
    ? Math.min(parentHeight || maximumHeight!, maximumHeight!)
    : parentHeight;
  return {
    paddingTop,
    paddingBottom,
    contentHeight: Math.max(0, boundedHeight - paddingTop - paddingBottom),
    availableHeight: Math.max(0, boundedHeight),
  };
}

function createTextLayoutClone(editor: HTMLElement) {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone.classList.remove('text-line-capacity-limited');
  clone.style.removeProperty('--text-line-viewport-height');
  clone.style.position = 'fixed';
  clone.style.left = '-100000px';
  clone.style.top = '0';
  clone.style.width = window.getComputedStyle(editor).width;
  clone.style.height = 'auto';
  clone.style.minHeight = '0';
  clone.style.maxHeight = 'none';
  clone.style.overflow = 'visible';
  clone.style.overflowX = 'visible';
  clone.style.transform = 'none';
  clone.style.visibility = 'hidden';
  clone.style.pointerEvents = 'none';
  clone.setAttribute('contenteditable', 'true');
  document.body.appendChild(clone);
  return clone;
}

type TextEditorContentBox = ReturnType<typeof getEditorContentBox>;

function computeTextLineLayout(
  editor: HTMLElement,
  maximumHeight?: number,
  isMeasurementClone = false,
  sourceContentBox?: TextEditorContentBox,
): TextLineLayout {
  const cache = new Map<string, InlineBoxExtents>();
  const mode = getTextLineMode(editor);
  const rulesEnabled = Boolean(mode);
  const computedSpacing = Number.parseFloat(window.getComputedStyle(editor).getPropertyValue('--text-line-spacing'));
  const pitch = rulesEnabled && Number.isFinite(computedSpacing) && computedSpacing > 0
    ? computedSpacing
    : getTextLineStrutPitch(editor, cache);
  // Detached candidates use their source editor's frame box. Their parent is
  // the document body, so deriving capacity from the clone would count outer
  // border pixels as usable rows and can admit an insertion the live editor
  // cannot display.
  const box = sourceContentBox ?? getEditorContentBox(editor, maximumHeight);
  const rowEpsilon = Number.EPSILON * Math.max(1, box.contentHeight, pitch) * 4;
  const fullRows = Math.floor((box.contentHeight + rowEpsilon) / pitch);
  let viewportContentHeight = fullRows * pitch;
  const lineStart = Number.parseFloat(window.getComputedStyle(editor).getPropertyValue('--text-line-start'));
  const lineEnd = Number.parseFloat(window.getComputedStyle(editor).getPropertyValue('--text-line-end'));
  const lineCenter = Number.isFinite(lineStart) && Number.isFinite(lineEnd)
    ? (lineStart + lineEnd) / 2
    : pitch / 2;
  const measurementClone = isMeasurementClone ? editor : createTextLayoutClone(editor);
  let rows: Array<{ top: number; bottom: number; baseline?: number; inserted?: boolean; insertedText?: boolean; insertedBreak?: boolean; segments?: Array<{ path: number[]; offset: number }> }>;
  try {
    const measured = measureNativeTextRows(measurementClone, viewportContentHeight, pitch, rulesEnabled, lineCenter, cache);
    viewportContentHeight = measured.viewportContentHeight;
    rows = measured.rows;
    if (!rulesEnabled) {
      const epsilon = 0.75;
      rows.forEach((row) => {
        if (row.top < viewportContentHeight - epsilon && row.bottom > viewportContentHeight + epsilon) {
          viewportContentHeight = Math.min(viewportContentHeight, Math.max(0, row.top));
        }
      });
    }
  } finally {
    if (!isMeasurementClone) measurementClone.remove();
  }
  const uniformRows = rulesEnabled || rows.every((row) => Math.abs((row.bottom - row.top) - pitch) <= 1);
  const finalViewportContentHeight = Math.max(0, viewportContentHeight);
  const overflowByPath = new Map<string, { path: number[]; offset: number }>();
  rows.filter((row) => row.top >= finalViewportContentHeight - 0.75).forEach((row) => {
    (row.segments ?? []).forEach((segment) => {
      const key = segment.path.join('.');
      const existing = overflowByPath.get(key);
      if (existing) existing.offset = Math.min(existing.offset, segment.offset);
      else overflowByPath.set(key, { ...segment });
    });
  });
  const overflowText = [...overflowByPath.values()];
  return {
    pitch,
    availableHeight: box.availableHeight,
    contentHeight: box.contentHeight,
    viewportHeight: finalViewportContentHeight + box.paddingTop + box.paddingBottom,
    fullRows,
    rulesEnabled,
    uniformRows,
    rows,
    overflowText,
  };
}

function unwrapTextLineOverflowRuns(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>(`[${TEXT_PRESENTATION_ATTRIBUTE}="line-grid-overflow"]`).forEach((wrapper) => {
    const parent = wrapper.parentNode;
    if (!parent) return;
    while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
    wrapper.remove();
  });
  editor.querySelectorAll<HTMLElement>(`li[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_OVERFLOW_BLOCK}"]`).forEach((item) => {
    item.removeAttribute(TEXT_PRESENTATION_ATTRIBUTE);
  });
}

function applyTextLineViewport(editor: HTMLElement, layout: TextLineLayout) {
  const splitNodes: Array<{ original: Text; splitOffset: number; suffix: Text }> = [];
  unwrapTextLineOverflowRuns(editor);
  editor.classList.add('text-line-capacity-limited');
  editor.style.setProperty('--text-line-viewport-height', `${layout.viewportHeight}px`);
  editor.dataset.textLineViewportRows = String(layout.fullRows);
  editor.dataset.textLineViewportHeight = String(layout.viewportHeight);
  const style = window.getComputedStyle(editor);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const visibleContentHeight = layout.viewportHeight - paddingTop - paddingBottom;
  const listPaths = new Map<string, number[]>();
  layout.rows.forEach((row) => {
    if (row.listItemPath) listPaths.set(row.listItemPath.join('.'), row.listItemPath);
  });
  listPaths.forEach((path) => {
    const item = resolveNodePath(editor, path);
    if (!(item instanceof HTMLElement) || item.tagName !== 'LI') return;
    const itemRows = layout.rows.filter((row) => row.listItemPath?.length === path.length &&
      row.listItemPath.every((index, position) => index === path[position]),
    );
    if (itemRows.length && itemRows.every((row) => row.top >= visibleContentHeight - 0.75)) {
      item.setAttribute(TEXT_PRESENTATION_ATTRIBUTE, TEXT_OVERFLOW_BLOCK);
    }
  });
  const overflowTargets = layout.overflowText.flatMap(({ path, offset }) => {
    const node = resolveNodePath(editor, path);
    return node instanceof Text && offset >= 0 && offset < node.length
      ? [{ node, offset }]
      : [];
  });
  overflowTargets.forEach(({ node, offset }) => {
    // A whole hidden row commonly starts at offset zero in its own paragraph.
    // Move that Text node intact so native ranges keep their node identity.
    const hiddenSuffix = offset === 0 ? node : node.splitText(offset);
    if (offset > 0) splitNodes.push({ original: node, splitOffset: offset, suffix: hiddenSuffix });
    const parent = hiddenSuffix.parentNode;
    if (!parent) return;
    const wrapper = document.createElement('span');
    wrapper.setAttribute(TEXT_PRESENTATION_ATTRIBUTE, 'line-grid-overflow');
    parent.insertBefore(wrapper, hiddenSuffix);
    wrapper.appendChild(hiddenSuffix);
  });
  return splitNodes;
}

function captureNativeTextSelection(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !(selection.anchorNode instanceof Text) || !(selection.focusNode instanceof Text) ||
      !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null;
  return {
    anchor: { node: selection.anchorNode, offset: selection.anchorOffset },
    focus: { node: selection.focusNode, offset: selection.focusOffset },
  };
}

function restoreNativeTextSelection(
  editor: HTMLElement,
  points: NonNullable<ReturnType<typeof captureNativeTextSelection>>,
  splitNodes: Array<{ original: Text; splitOffset: number; suffix: Text }>,
) {
  const remap = (point: { node: Text; offset: number }) => {
    const split = splitNodes.find((item) => item.original === point.node && point.offset >= item.splitOffset);
    return split
      ? { node: split.suffix, offset: point.offset - split.splitOffset }
      : point;
  };
  const anchor = remap(points.anchor);
  const focus = remap(points.focus);
  if (!editor.contains(anchor.node) || !editor.contains(focus.node)) return;
  window.getSelection()?.setBaseAndExtent(
    anchor.node,
    Math.min(anchor.offset, anchor.node.length),
    focus.node,
    Math.min(focus.offset, focus.node.length),
  );
}

/** Derive the full-row viewport in local CSS pixels and apply its clip to the editor. */
export function syncTextLineViewport(editor: HTMLElement, maximumHeight?: number) {
  const selection = captureNativeTextSelection(editor);
  unwrapTextLineOverflowRuns(editor);
  const layout = computeTextLineLayout(editor, maximumHeight);
  const splitNodes = applyTextLineViewport(editor, layout);
  if (selection) restoreNativeTextSelection(editor, selection, splitNodes);
  return layout;
}

function getNodePath(root: Node, node: Node) {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return current === root ? path : null;
}

function resolveNodePath(root: Node, path: number[]) {
  let current: Node = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

function cloneRangeIntoEditor(source: HTMLElement, clone: HTMLElement, range: Range) {
  const startPath = getNodePath(source, range.startContainer);
  const endPath = getNodePath(source, range.endContainer);
  if (!startPath || !endPath) return null;
  const start = resolveNodePath(clone, startPath);
  const end = resolveNodePath(clone, endPath);
  if (!start || !end) return null;
  const candidate = document.createRange();
  try {
    candidate.setStart(start, Math.min(range.startOffset, start instanceof Text ? start.length : start.childNodes.length));
    candidate.setEnd(end, Math.min(range.endOffset, end instanceof Text ? end.length : end.childNodes.length));
    return candidate;
  } catch {
    return null;
  }
}

function makeCandidateCaretRun(editor: HTMLElement) {
  const caret = document.createElement('span');
  caret.setAttribute(TEXT_PRESENTATION_ATTRIBUTE, TEXT_PRESENTATION_CARET);
  caret.setAttribute(TEXT_LAYOUT_INSERTION_ATTRIBUTE, 'true');
  caret.appendChild(document.createTextNode(INTERNAL_CARET_CHARACTER));
  const size = Number.parseFloat(window.getComputedStyle(editor).fontSize) || 16;
  setCaretRunFontSize(caret, size);
  return caret;
}

function insertCandidateParagraph(editor: HTMLElement, range: Range) {
  range.deleteContents();
  const startContainer = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  const block = startContainer?.closest<HTMLElement>(Array.from(TEXT_LINE_TAGS).join(','));
  const target = block && editor.contains(block) ? block : editor;
  const newBlock = target === editor
    ? document.createElement('div')
    : target.cloneNode(false) as HTMLElement;
  newBlock.removeAttribute(TEXT_PRESENTATION_ATTRIBUTE);
  newBlock.removeAttribute(TEXT_LAYOUT_INSERTION_ATTRIBUTE);
  const trailing = document.createRange();
  trailing.setStart(range.startContainer, range.startOffset);
  trailing.setEnd(target, target.childNodes.length);
  newBlock.appendChild(trailing.extractContents());
  if (!newBlock.childNodes.length) newBlock.appendChild(document.createElement('br'));
  if (target === editor) editor.appendChild(newBlock);
  else target.parentNode?.insertBefore(newBlock, target.nextSibling);
  const caret = makeCandidateCaretRun(editor);
  newBlock.insertBefore(caret, newBlock.firstChild);
  return caret;
}

function insertCandidateContent(editor: HTMLElement, range: Range, inputType: string, data: string, html?: string) {
  if (inputType === 'insertParagraph') return insertCandidateParagraph(editor, range);
  range.deleteContents();
  const inserted = document.createElement('span');
  inserted.setAttribute(TEXT_LAYOUT_INSERTION_ATTRIBUTE, 'true');
  if (html !== undefined) {
    inserted.style.display = 'contents';
    inserted.appendChild(range.createContextualFragment(html));
  } else if (inputType === 'insertLineBreak') {
    inserted.appendChild(document.createElement('br'));
    inserted.appendChild(makeCandidateCaretRun(editor));
  } else {
    const normalized = data.replace(/\r\n?/g, '\n');
    const pieces = normalized.split('\n');
    pieces.forEach((piece, index) => {
      if (piece) inserted.appendChild(document.createTextNode(piece));
      if (index < pieces.length - 1) {
        inserted.appendChild(document.createElement('br'));
        inserted.appendChild(makeCandidateCaretRun(editor));
      }
    });
  }
  range.insertNode(inserted);
  return inserted;
}

function getInsertionProbeRange(inserted: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(inserted);
  return range;
}

function measureGlyphBaselineDelta(source: HTMLElement, sampleText: string) {
  const style = window.getComputedStyle(source);
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-100000px';
  probe.style.top = '0';
  probe.style.display = 'block';
  probe.style.width = 'max-content';
  probe.style.margin = '0';
  probe.style.padding = '0';
  probe.style.border = '0';
  probe.style.overflow = 'visible';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.whiteSpace = 'nowrap';
  probe.style.fontSize = '0';
  probe.style.lineHeight = '0';
  const run = document.createElement('span');
  run.style.display = 'inline';
  run.style.lineHeight = style.lineHeight;
  copyTextRunFontStyle(style, run);
  const text = document.createTextNode(sampleText || 'M');
  const marker = createTextLayoutMarker();
  run.append(text, marker);
  probe.appendChild(run);
  document.body.appendChild(probe);
  const textRange = document.createRange();
  textRange.selectNodeContents(text);
  const textTop = textRange.getBoundingClientRect().top;
  const baseline = marker.getBoundingClientRect().top;
  probe.remove();
  return Number.isFinite(textTop) && Number.isFinite(baseline) ? baseline - textTop : 0;
}

function hasOnlyTranslationTransforms(editor: HTMLElement) {
  for (let current: HTMLElement | null = editor; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.zoom && style.zoom !== '1' && style.zoom !== 'normal') return false;
    if (style.transform && style.transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(style.transform);
      if (Math.abs(matrix.a - 1) > 0.0001 || Math.abs(matrix.b) > 0.0001 ||
        Math.abs(matrix.c) > 0.0001 || Math.abs(matrix.d - 1) > 0.0001) return false;
    }
  }
  return true;
}

/** Fast path only when rows are uniform and the last measured row leaves one full row unused. */
export function canUseFastSingleCharacterInsert(
  editor: HTMLElement,
  layout: TextLineLayout | null,
  range: Range,
  data: string | null,
) {
  if (!layout?.uniformRows || layout.overflowText.length > 0 || !range.collapsed || !data || Array.from(data).length !== 1 || !hasOnlyTranslationTransforms(editor)) return false;
  const editorStyle = window.getComputedStyle(editor);
  const paddingTop = Number.parseFloat(editorStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(editorStyle.paddingBottom) || 0;
  const visibleContentHeight = Math.max(0, layout.viewportHeight - paddingTop - paddingBottom);
  const lastRowBottom = layout.rows.reduce((bottom, row) => Math.max(bottom, row.bottom), 0);
  // A character at an earlier row can reflow existing later text. Only bypass
  // cloned preflight when the entire current document has one row of headroom.
  if (lastRowBottom + layout.pitch > visibleContentHeight + 0.75) return false;
  if (!(range.startContainer instanceof Text) || !range.startContainer.length) return false;
  const node = range.startContainer;
  const textOffset = range.startOffset > 0 ? range.startOffset - 1 : Math.min(range.startOffset, node.length - 1);
  const sample = node.data.slice(textOffset, textOffset + 1);
  const source = node.parentElement ?? editor;
  if (source.closest(`[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`)) return false;

  const cache = new Map<string, InlineBoxExtents>();
  const incoming = getInlineBoxExtents(source, data, cache);
  const current = getInlineBoxExtents(source, sample, cache);
  if (Math.abs(incoming.above - current.above) > 0.75 || Math.abs(incoming.below - current.below) > 0.75) return false;

  const characterRange = document.createRange();
  characterRange.setStart(node, textOffset);
  characterRange.setEnd(node, textOffset + 1);
  const glyphRect = characterRange.getBoundingClientRect();
  const delta = measureGlyphBaselineDelta(source, sample);
  const baseline = glyphRect.top + delta;
  const block = getNearestTextLineBlock(editor, source);
  const editorTop = editor.getBoundingClientRect().top;
  let rowTop: number;
  if (layout.rulesEnabled) {
    const lineStart = Number.parseFloat(window.getComputedStyle(editor).getPropertyValue('--text-line-start'));
    const lineEnd = Number.parseFloat(window.getComputedStyle(editor).getPropertyValue('--text-line-end'));
    const center = Number.isFinite(lineStart) && Number.isFinite(lineEnd)
      ? (lineStart + lineEnd) / 2
      : layout.pitch / 2;
    rowTop = baseline - center - editorTop - paddingTop;
  } else {
    const sourceExtents = getInlineBoxExtents(source, sample, cache);
    const strutExtents = getInlineBoxExtents(block, sample, cache);
    rowTop = baseline - Math.max(sourceExtents.above, strutExtents.above) - editorTop - paddingTop;
  }
  const rowBottom = rowTop + layout.pitch;
  return rowTop >= -0.75 && rowBottom + layout.pitch <= layout.contentHeight + 0.75;
}
/** Preflight only risky insertions against browser-laid-out content; never trims text. */
export function preflightTextInsertion(
  editor: HTMLElement,
  range: Range,
  inputType: string,
  data: string,
  maximumHeight?: number,
  html?: string,
): TextLineLayout | null {
  const sourceContentBox = getEditorContentBox(editor, maximumHeight);
  const clone = createTextLayoutClone(editor);
  try {
    const candidateRange = cloneRangeIntoEditor(editor, clone, range);
    if (!candidateRange) return null;
    const inserted = insertCandidateContent(clone, candidateRange, inputType, data, html);
    if (!inserted) return null;
    if (getTextLineMode(clone)) syncTextLinePresentation(clone);
    const layout = computeTextLineLayout(clone, maximumHeight, true, sourceContentBox);
    const insertedRows = layout.rows.filter((row) => row.insertedText || row.insertedBreak);
    if (!insertedRows.length) {
      const insertedRange = getInsertionProbeRange(inserted);
      const origin = clone.getBoundingClientRect().top + (Number.parseFloat(window.getComputedStyle(clone).paddingTop) || 0);
      const contentViewportHeight = layout.viewportHeight - (Number.parseFloat(window.getComputedStyle(clone).paddingTop) || 0) - (Number.parseFloat(window.getComputedStyle(clone).paddingBottom) || 0);
      return Array.from(insertedRange.getClientRects()).every((rect) => rect.bottom - origin <= contentViewportHeight + 0.75)
        ? layout
        : null;
    }
    return insertedRows.every((row) => row.top >= -0.75 && row.bottom <= layout.viewportHeight - (Number.parseFloat(window.getComputedStyle(clone).paddingTop) || 0) - (Number.parseFloat(window.getComputedStyle(clone).paddingBottom) || 0) + 0.75)
      ? layout
      : null;
  } catch {
    return null;
  } finally {
    clone.remove();
  }
}
/** Check the committed composition range in a clone without changing the live IME DOM. */
export function canKeepTextRangeWithinFullRows(editor: HTMLElement, range: Range, maximumHeight?: number) {
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return false;
  const sourceContentBox = getEditorContentBox(editor, maximumHeight);
  const clone = createTextLayoutClone(editor);
  try {
    const candidateRange = cloneRangeIntoEditor(editor, clone, range);
    if (!candidateRange) return false;
    const inserted = document.createElement('span');
    inserted.setAttribute(TEXT_LAYOUT_INSERTION_ATTRIBUTE, 'true');
    inserted.style.display = 'contents';
    inserted.appendChild(candidateRange.extractContents());
    candidateRange.insertNode(inserted);
    if (getTextLineMode(clone)) syncTextLinePresentation(clone);
    const layout = computeTextLineLayout(clone, maximumHeight, true, sourceContentBox);
    const insertedRows = layout.rows.filter((row) => row.insertedText || row.insertedBreak);
    if (!insertedRows.length) return false;
    const paddingTop = Number.parseFloat(window.getComputedStyle(clone).paddingTop) || 0;
    const paddingBottom = Number.parseFloat(window.getComputedStyle(clone).paddingBottom) || 0;
    const visibleContentHeight = layout.viewportHeight - paddingTop - paddingBottom;
    return insertedRows.every((row) => row.top >= -0.75 && row.bottom <= visibleContentHeight + 0.75);
  } catch {
    return false;
  } finally {
    clone.remove();
  }
}
/** Apply fixed-pitch line-grid styles, rebuilding only for style/structure refreshes. */
export function syncTextLinePresentation(
  editor: HTMLElement,
  options: { incremental?: boolean } = {},
) {
  const mode = editor.classList.contains('text-lines-everywhere')
    ? 'everywhere'
    : editor.classList.contains('text-lines-blocks')
      ? 'blocks'
      : null;
  unwrapTextLineOverflowRuns(editor);
  if (!mode || typeof window.getComputedStyle !== 'function') {
    unwrapTextLinePresentationRuns(editor);
    removeTextLineCaretRuns(editor);
    return;
  }

  const currentSelection = window.getSelection();
  const selectionRange = currentSelection?.rangeCount &&
    editor.contains(currentSelection.getRangeAt(0).commonAncestorContainer)
    ? currentSelection.getRangeAt(0).cloneRange()
    : null;
  const selectionStart = selectionRange?.startContainer ?? null;
  const selectionEnd = selectionRange?.endContainer ?? null;
  const selectionStartOffset = selectionRange?.startOffset ?? 0;
  const selectionEndOffset = selectionRange?.endOffset ?? 0;
  const ruleClass = mode === 'everywhere' ? 'text-lines-everywhere' : 'text-lines-blocks';
  if (!options.incremental) {
    unwrapTextLinePresentationRuns(editor);
  }
  normalizeCaretRunsWithContent(editor);
  editor.classList.remove(ruleClass);
  const rootFontSize = Number.parseFloat(window.getComputedStyle(editor).fontSize) || 16;
  const runs = collectTextRuns(editor, rootFontSize, Boolean(options.incremental));
  const markerSizes = collectMarkerFontSizes(editor, rootFontSize, !options.incremental);

  if (mode === 'blocks') wrapDirectInlineContent(editor);
  const nextSelection = editor.isContentEditable
    ? ensureTextLineCaretRuns(editor, mode, rootFontSize, selectionRange)
    : (removeTextLineCaretRuns(editor), selectionRange);
  editor.classList.add(ruleClass);
  setMarkerFontSizes(editor, rootFontSize, markerSizes);
  wrapTextRuns(runs);
  const computedSpacing = Number.parseFloat(
    window.getComputedStyle(editor).getPropertyValue('--text-line-spacing'),
  );
  const lineSpacing = Number.isFinite(computedSpacing) && computedSpacing > 0
    ? computedSpacing
    : 24;
  const lineStart = Number.parseFloat(
    window.getComputedStyle(editor).getPropertyValue('--text-line-start'),
  );
  const lineEnd = Number.parseFloat(
    window.getComputedStyle(editor).getPropertyValue('--text-line-end'),
  );
  const lineCenter = Number.isFinite(lineStart) && Number.isFinite(lineEnd)
    ? (lineStart + lineEnd) / 2
    : lineSpacing / 2;
  alignTextRunBaselines(editor, lineSpacing, lineCenter);
  let selectionToRestore = nextSelection;
  if (
    nextSelection === selectionRange &&
    selectionStart instanceof Text &&
    selectionEnd instanceof Text &&
    editor.contains(selectionStart) &&
    editor.contains(selectionEnd)
  ) {
    selectionToRestore = document.createRange();
    selectionToRestore.setStart(selectionStart, Math.min(selectionStartOffset, selectionStart.length));
    selectionToRestore.setEnd(selectionEnd, Math.min(selectionEndOffset, selectionEnd.length));
  }
  if (selectionToRestore && editor.contains(selectionToRestore.commonAncestorContainer)) {
    currentSelection?.removeAllRanges();
    currentSelection?.addRange(selectionToRestore);
  }
}

function styleTextRange(
  editor: HTMLElement,
  range: Range,
  property: 'color' | 'fontSize',
  value: string,
): Range | null {
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
  const originalStart = range.startContainer;
  const originalEnd = range.endContainer;
  const originalStartOffset = range.startOffset;
  const originalEndOffset = range.endOffset;
  unwrapTextLinePresentationRuns(editor);
  let workingRange = range;
  if (
    originalStart instanceof Text &&
    originalEnd instanceof Text &&
    editor.contains(originalStart) &&
    editor.contains(originalEnd)
  ) {
    workingRange = document.createRange();
    workingRange.setStart(originalStart, Math.min(originalStartOffset, originalStart.length));
    workingRange.setEnd(originalEnd, Math.min(originalEndOffset, originalEnd.length));
  }
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; start: number; end: number }[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const caretRun = node.parentElement?.closest(
      `[${TEXT_PRESENTATION_ATTRIBUTE}="${TEXT_PRESENTATION_CARET}"]`,
    );
    if (caretRun && node.data.replace(INTERNAL_CARET_CHARACTER, '') === '') continue;
    if (!workingRange.intersectsNode(node)) continue;
    const start = node === workingRange.startContainer ? workingRange.startOffset : 0;
    const end = node === workingRange.endContainer ? workingRange.endOffset : node.length;
    if (end > start) pieces.push({ node, start, end });
  }
  const colored: Text[] = [];
  for (const { node, start, end } of pieces) {
    if (end < node.length) node.splitText(end);
    const text = start > 0 ? node.splitText(start) : node;
    const span = document.createElement('span');
    span.style[property] = value;
    text.replaceWith(span);
    span.append(text);
    colored.push(text);
  }
  if (!colored.length) return null;
  const selection = document.createRange();
  selection.setStart(colored[0], 0);
  selection.setEnd(colored[colored.length - 1], colored[colored.length - 1].length);
  return selection;
}

/** Color only the text nodes covered by a live editing range, preserving markup. */
export function colorTextRange(editor: HTMLElement, range: Range, color: string): Range | null {
  return styleTextRange(editor, range, 'color', color);
}

/** Change only the selected text run's pixel size, keeping the selection usable. */
export function fontSizeTextRange(editor: HTMLElement, range: Range, fontSizePx: number): Range | null {
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) return null;
  return styleTextRange(editor, range, 'fontSize', `${fontSizePx}px`);
}

export function getTextSelectionOffsets(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(editor);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { start, end: start + range.toString().length };
}

export function restoreTextSelection(editor: HTMLElement, offsets: { start: number; end: number }) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let count = 0;
  let started = false;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const next = count + node.length;
    if (!started && offsets.start <= next) {
      range.setStart(node, Math.max(0, offsets.start - count));
      started = true;
    }
    if (started && offsets.end <= next) {
      range.setEnd(node, Math.max(0, offsets.end - count));
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return range;
    }
    count = next;
  }
  return null;
}

/** Sanitization must not throw away a caret or selection inside edited markup. */
export function replaceTextEditorHtml(editor: HTMLElement, html: string) {
  if (editor.innerHTML === html) return;
  removeTextLineCaretRuns(editor);
  const offsets = getTextSelectionOffsets(editor);
  unwrapTextLinePresentationRuns(editor);
  if (editor.innerHTML === html) {
    if (offsets) restoreTextSelection(editor, offsets);
    return;
  }
  editor.innerHTML = html;
  if (offsets) restoreTextSelection(editor, offsets);
}
