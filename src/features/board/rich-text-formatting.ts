/** Color only the text nodes covered by a live editing range, preserving markup. */
export function colorTextRange(editor: HTMLElement, range: Range, color: string): Range | null {
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; start: number; end: number }[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end > start) pieces.push({ node, start, end });
  }
  const colored: Text[] = [];
  for (const { node, start, end } of pieces) {
    if (end < node.length) node.splitText(end);
    const text = start > 0 ? node.splitText(start) : node;
    const span = document.createElement('span');
    span.style.color = color;
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
  const offsets = getTextSelectionOffsets(editor);
  editor.innerHTML = html;
  if (offsets) restoreTextSelection(editor, offsets);
}
