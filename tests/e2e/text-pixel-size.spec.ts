import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const boardId = 'text-pixel-size-range';
const boardTitle = 'Text pixel size range';

const board = {
  id: boardId,
  title: boardTitle,
  version: 4,
  width: 1100,
  height: 700,
  workspaceWidth: 1500,
  workspaceHeight: 1000,
  boardX: 64,
  boardY: 0,
  viewportCenterX: 640,
  viewportCenterY: 328,
  updatedAt: Date.now(),
  editorSettings: {
    activeTool: 'text',
    keepToolActive: true,
    customColors: { text: ['#ff0000', '', '', ''] },
  },
  elements: [
    {
      id: 'empty-text',
      type: 'text',
      position: { x: 620, y: 100 },
      size: { width: 360, height: 130 },
      content: '',
      fontSize: 16,
      textScale: 1,
      textScaling: true,
      textSnapToGrid: true,
      textLinesMode: 'text-only',
      textLineColor: '#cc0000',
      textLineThickness: 1,
      textLineSpacing: 10,
      zIndex: 2,
    },
    {
      id: 'scaled-text',
      type: 'text',
      position: { x: 100, y: 100 },
      size: { width: 460, height: 180 },
      content: '<p>Alpha Bravo Charlie and enough text to wrap across the ruled surface.</p>',
      fontSize: 16,
      textScale: 1.5,
      textScaling: true,
      textSnapToGrid: true,
      textLinesMode: 'everywhere',
      textLineColor: '#cc0000',
      textLineThickness: 1,
      textLineSpacing: 10,
      borderWidth: 2,
      borderColor: '#0033ff',
      zIndex: 1,
    },
  ],
};

async function seedBoard(request: APIRequestContext) {
  await request.delete(`/api/pages/${boardId}`);
  const response = await request.post('/api/pages', { data: [board] });
  expect(response.ok()).toBeTruthy();
}

async function readBoard(request: APIRequestContext) {
  const pages = await (await request.get('/api/pages')).json();
  return pages.find((page: { id: string }) => page.id === boardId);
}

async function openBoard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${boardTitle}`, exact: true }).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
}

async function selectText(page: Page, needle: string) {
  const editor = page.locator('[data-board-element-editor-id="scaled-text"]');
  await editor.click();
  await editor.evaluate((element, selectedText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let found: Text | null = null;
    let start = -1;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const index = node.data.indexOf(selectedText);
      if (index >= 0) {
        found = node;
        start = index;
        break;
      }
    }
    if (!found) throw new Error(`Could not find ${selectedText}`);
    const range = document.createRange();
    range.setStart(found, start);
    range.setEnd(found, start + selectedText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, needle);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(needle);
}

async function inspectSavedBravo(page: Page, html: string) {
  return page.evaluate((content) => {
    const root = document.createElement('div');
    root.innerHTML = content;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (node.data.includes('Bravo')) {
        target = node;
        break;
      }
    }
    if (!target) return null;
    let fontSize: number | null = null;
    let color: string | null = null;
    let bold = false;
    for (let element = target.parentElement; element && root.contains(element); element = element.parentElement) {
      if (element.style.fontSize) fontSize = Number.parseFloat(element.style.fontSize);
      if (element.style.color) color = element.style.color;
      if (element.tagName === 'B' || element.tagName === 'STRONG' || Number(getComputedStyle(element).fontWeight) >= 600) {
        bold = true;
      }
    }
    return { fontSize, color, bold, hasPresentationMarker: root.innerHTML.includes('data-noteboard-text-presentation') };
  }, html);
}

test('PX input edits one selected fragment in one undo step and saves the rich text', async ({ context, page, request }) => {
  await seedBoard(request);
  try {
    await openBoard(page);
    const emptyEditor = page.locator('[data-board-element-editor-id="empty-text"]');
    await emptyEditor.click();
    await emptyEditor.pressSequentially('Hello');
    await emptyEditor.press('Enter');
    await expect.poll(() => emptyEditor.locator('[data-noteboard-text-presentation="caret-run"]').count()).toBe(1);
    await emptyEditor.press('Enter');
    await expect.poll(() => emptyEditor.locator('[data-noteboard-text-presentation="caret-run"]').count()).toBe(2);
    const emptyLineGeometry = await emptyEditor.evaluate((editor) =>
      Array.from(editor.children).map((line) => ({
        tag: line.tagName,
        height: line.getBoundingClientRect().height,
        lineHeight: getComputedStyle(line).lineHeight,
      })),
    );
    expect(emptyLineGeometry).toHaveLength(3);
    expect(
      emptyLineGeometry.every((line) => line.tag === 'DIV' && line.height === 10 && line.lineHeight === '10px'),
      JSON.stringify(emptyLineGeometry),
    ).toBe(true);
    const preeditGeometry = await emptyEditor.evaluate((editor) => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let hello: Text | null = null;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (node.data.includes('Hello')) {
          hello = node;
          break;
        }
      }
      if (!hello) throw new Error('Typed text did not produce a visible first line');
      const range = document.createRange();
      range.setStart(hello, hello.data.indexOf('Hello'));
      range.setEnd(hello, hello.data.indexOf('Hello') + 5);
      const box = range.getBoundingClientRect();
      return { glyph: { x: box.x, y: box.y, width: box.width, height: box.height } };
    });
    expect(preeditGeometry.glyph.width).toBeGreaterThan(0);
    expect(preeditGeometry.glyph.height).toBeGreaterThan(0);

    const duringComposition = await emptyEditor.evaluate((editor) => {
      const selection = window.getSelection();
      const anchorParent = selection?.anchorNode instanceof Element
        ? selection.anchorNode
        : selection?.anchorNode?.parentElement;
      const caret = anchorParent?.closest<HTMLElement>('[data-noteboard-text-presentation="caret-run"]');
      const text = caret?.firstChild;
      if (!(text instanceof Text) || text.data !== '\u200b') {
        throw new Error('The empty line has no visible-font caret landing point');
      }
      const selectionInCaret = Boolean(caret);
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      text.data += '漢';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '漢' }));
      const preeditRange = document.createRange();
      preeditRange.setStart(text, 1);
      preeditRange.setEnd(text, 2);
      const glyph = preeditRange.getBoundingClientRect();
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let hello: Text | null = null;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (node.data.includes('Hello')) {
          hello = node;
          break;
        }
      }
      if (!hello) throw new Error('The existing first line disappeared during preedit');
      const helloRange = document.createRange();
      helloRange.setStart(hello, hello.data.indexOf('Hello'));
      helloRange.setEnd(hello, hello.data.indexOf('Hello') + 5);
      const existingGlyph = helloRange.getBoundingClientRect();
      const line = { x: existingGlyph.x, y: existingGlyph.y, width: existingGlyph.width, height: existingGlyph.height };
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '漢' }));
      return {
        selectionInCaret,
        preeditVisible: glyph.width > 0 && glyph.height > 0,
        line,
        classStillActive: editor.classList.contains('text-lines-blocks'),
      };
    });
    expect(duringComposition.selectionInCaret).toBe(true);
    expect(duringComposition.preeditVisible).toBe(true);
    expect(duringComposition.line).toEqual(preeditGeometry.glyph);
    expect(duringComposition.classStillActive).toBe(true);
    await expect.poll(async () => {
      const saved = await readBoard(request);
      return saved?.elements.find((element: { id: string }) => element.id === 'empty-text')?.content ?? '';
    }).toContain('漢');
    await expect(emptyEditor).toContainText('漢');
    expect(await emptyEditor.locator('[data-noteboard-text-presentation="caret-run"]').count()).toBe(1);

    await page.getByTitle('Select Tool').click();
    await expect.poll(() => emptyEditor.evaluate((editor) => (editor as HTMLElement).isContentEditable)).toBe(false);
    await expect(emptyEditor.locator('[data-noteboard-text-presentation="caret-run"]')).toHaveCount(0);
    await page.getByTitle('Text Tool').click();
    await expect.poll(() => emptyEditor.evaluate((editor) => (editor as HTMLElement).isContentEditable)).toBe(true);
    await expect(emptyEditor.locator('[data-noteboard-text-presentation="caret-run"]')).toHaveCount(1);

    const editor = page.locator('[data-board-element-editor-id="scaled-text"]');
    const wrappedGeometry = await editor.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.querySelector('p') ?? element);
      const rects = Array.from(range.getClientRects());
      const rows = [...new Set(rects.map((rect) => rect.y))].sort((a, b) => a - b);
      return {
        rows,
        blockHeight: (element.querySelector('p') ?? element).getBoundingClientRect().height,
        lineHeight: getComputedStyle(element.querySelector('p') ?? element).lineHeight,
      };
    });
    expect(wrappedGeometry.rows.length).toBeGreaterThan(1);
    expect(wrappedGeometry.blockHeight).toBeGreaterThan(0);
    expect(wrappedGeometry.lineHeight).toBe('10px');
    for (let index = 1; index < wrappedGeometry.rows.length; index += 1) {
      expect(wrappedGeometry.rows[index] - wrappedGeometry.rows[index - 1]).toBeCloseTo(15, 1);
    }
    await selectText(page, 'Bravo');
    const sizeInput = page.locator('[data-text-px-control]:visible');
    await expect(sizeInput).toHaveValue('24');

    await sizeInput.click();
    await sizeInput.press('Control+A');
    await sizeInput.type('28');
    await expect(sizeInput).toHaveValue('28');
    await expect(sizeInput).toBeFocused();
    await sizeInput.press('Enter');
    await expect(editor).toBeFocused();

    await expect.poll(async () => {
      const saved = await readBoard(request);
      if (!saved) return null;
      return inspectSavedBravo(page, saved.elements.find((element: { id: string }) => element.id === 'scaled-text')?.content ?? '');
    }).toMatchObject({ fontSize: 18.6667, color: null, bold: false, hasPresentationMarker: false });

    await page.getByTitle('Undo (Ctrl+Z)').click();
    await expect.poll(async () => {
      const saved = await readBoard(request);
      if (!saved) return null;
      return inspectSavedBravo(page, saved.elements.find((element: { id: string }) => element.id === 'scaled-text')?.content ?? '');
    }).toMatchObject({ fontSize: null, bold: false });

    await page.getByTitle('Redo (Ctrl+Y)').click();
    await expect.poll(async () => {
      const saved = await readBoard(request);
      if (!saved) return null;
      return inspectSavedBravo(page, saved.elements.find((element: { id: string }) => element.id === 'scaled-text')?.content ?? '');
    }).toMatchObject({ fontSize: 18.6667 });

    await selectText(page, 'Bravo');
    await page.locator('[title="Text Color"] .color-palette button').nth(2).click();
    await page.getByTitle('Bold', { exact: true }).click();
    await expect.poll(async () => {
      const saved = await readBoard(request);
      if (!saved) return null;
      return inspectSavedBravo(page, saved.elements.find((element: { id: string }) => element.id === 'scaled-text')?.content ?? '');
    }).toMatchObject({ fontSize: 18.6667, color: 'rgb(255, 0, 0)', bold: true, hasPresentationMarker: false });

    const current = await readBoard(request);
    const canonical = current.elements.find((element: { id: string }) => element.id === 'scaled-text')?.content ?? '';
    expect(canonical).not.toContain('data-noteboard-text-presentation');
    const emptyCanonical = current.elements.find((element: { id: string }) => element.id === 'empty-text')?.content ?? '';
    expect(emptyCanonical).not.toContain('data-noteboard-text-presentation');
    expect(emptyCanonical).not.toContain('\u200b');
    expect((emptyCanonical.match(/<div>/g) ?? []).length).toBe(3);
    expect(emptyCanonical).toContain('<div><br></div>');

    await page.close();
    const reopened = await context.newPage();
    await openBoard(reopened);
    await expect(reopened.locator('[data-board-element-editor-id="scaled-text"]')).toContainText('Bravo');
    const reopenedBoard = await readBoard(request);
    const reopenedContent = reopenedBoard.elements.find((element: { id: string }) => element.id === 'scaled-text')?.content ?? '';
    expect(reopenedContent).toBe(canonical);
    await expect(reopened.locator('[data-board-element-editor-id="empty-text"]')).toContainText('Hello');
    await expect(reopened.locator('[data-board-element-editor-id="empty-text"]')).toContainText('漢');
    await reopened.close();
  } finally {
    await request.delete(`/api/pages/${boardId}`);
  }
});
