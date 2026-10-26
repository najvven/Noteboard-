import { deleteFixtureBoard } from './fixture-storage';
import { expect, test, type APIRequestContext, type Page } from './test';
import sharp from 'sharp';

const boardId = 'text-line-capacity';
const boardTitle = 'Full-row capacity';

const ruled = {
  fontSize: 16,
  textScale: 1,
  textScaling: false,
  textSnapToGrid: true,
  textLinesMode: 'everywhere',
  textLineColor: '#cc0000',
  textLineThickness: 1,
  textLineSpacing: 10,
};

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
  editorSettings: { activeTool: 'text', keepToolActive: true },
  elements: [
    {
      id: 'overflow-row',
      type: 'text',
      position: { x: 80, y: 100 },
      size: { width: 260, height: 61.99 },
      content: `${'<p><br></p>'.repeat(5)}<ul><li style="font-size:30px"><span>MMMMMMMM</span><b>TAIL</b></li></ul>`,
      ...ruled,
      zIndex: 1,
    },
    {
      id: 'limited-entry',
      type: 'text',
      position: { x: 390, y: 100 },
      size: { width: 260, height: 61.99 },
      content: '',
      ...ruled,
      zIndex: 2,
    },
    {
      id: 'natural-mixed',
      type: 'text',
      position: { x: 700, y: 100 },
      size: { width: 260, height: 58 },
      content: '<ul><li><span style="font-size:30px">MMMM</span></li><li><span style="font-size:30px">TAIL</span></li></ul>',
      fontSize: 16,
      textScale: 1,
      textScaling: true,
      textSnapToGrid: false,
      zIndex: 3,
    },
    {
      id: 'unruled-empty',
      type: 'text',
      position: { x: 700, y: 330 },
      size: { width: 260, height: 61.99 },
      content: '',
      fontSize: 16,
      textScale: 1,
      textScaling: false,
      textSnapToGrid: false,
      zIndex: 4,
    },
    {
      id: 'unruled-overflow',
      type: 'text',
      position: { x: 700, y: 430 },
      size: { width: 464, height: 252 },
      content: `<br>${'<div><br></div>'.repeat(10)}`,
      fontSize: 16,
      textScale: 1,
      textScaling: false,
      textSnapToGrid: false,
      zIndex: 5,
    },
  ],
};

async function seedBoard(request: APIRequestContext) {
  await deleteFixtureBoard(request, `/api/pages/${boardId}`);
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

async function countDarkPixels(image: Buffer) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index] < 100 && data[index + 1] < 100 && data[index + 2] < 100) count += 1;
  }
  return count;
}

test('Text accepts only full rows and keeps overflow text selectable, hidden, and canonical', async ({ page, request }) => {
  const rawDropRequests: string[] = [];
  page.on('request', (requestEvent) => {
    if (requestEvent.url().includes('__raw_html_drop_probe.png')) rawDropRequests.push(requestEvent.url());
  });
  await seedBoard(request);
  try {
    await openBoard(page);
    const overflowEditor = page.locator('[data-board-element-editor-id="overflow-row"]');
    await expect.poll(() => overflowEditor.locator('[data-noteboard-text-presentation="line-grid-overflow"]').count()).toBeGreaterThan(0);

    const viewport = await overflowEditor.evaluate((editor) => ({
      rows: Number(editor.getAttribute('data-text-line-viewport-rows')),
      height: Number(editor.getAttribute('data-text-line-viewport-height')),
      boxHeight: editor.getBoundingClientRect().height,
      outerHeight: editor.parentElement?.parentElement?.getBoundingClientRect().height ?? 0,
      frameClientHeight: editor.parentElement?.clientHeight ?? 0,
      frameContentHeight: Number.parseFloat(getComputedStyle(editor.parentElement!).height) -
        (Number.parseFloat(getComputedStyle(editor.parentElement!).borderTopWidth) || 0) -
        (Number.parseFloat(getComputedStyle(editor.parentElement!).borderBottomWidth) || 0),
      overflowRuns: editor.querySelectorAll('[data-noteboard-text-presentation="line-grid-overflow"]').length,
    }));
    expect(viewport.rows).toBe(5);
    expect(viewport.height).toBe(50);
    expect(viewport.outerHeight).toBeCloseTo(61.99, 1);
    expect(viewport.frameClientHeight).toBe(60);
    expect(viewport.frameContentHeight).toBeLessThan(60);
    expect(viewport.overflowRuns).toBeGreaterThanOrEqual(2);
    const hiddenMarkerColor = await overflowEditor.locator('li').evaluate((item) => getComputedStyle(item, '::marker').color);
    expect(hiddenMarkerColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

    const hiddenPixels = await countDarkPixels(await overflowEditor.screenshot());
    const unmaskedPixels = await overflowEditor.evaluate((editor) => {
      editor.querySelectorAll<HTMLElement>('[data-noteboard-text-presentation="line-grid-overflow"]').forEach((run) => {
        run.dataset.restoreOverflowMarker = 'true';
        run.removeAttribute('data-noteboard-text-presentation');
      });
      const item = editor.querySelector<HTMLElement>('li');
      if (item) {
        item.dataset.restoreListMarker = 'true';
        item.removeAttribute('data-noteboard-text-presentation');
      }
      return true;
    }).then(async () => countDarkPixels(await overflowEditor.screenshot()));
    await overflowEditor.evaluate((editor) => {
      editor.querySelectorAll<HTMLElement>('[data-restore-overflow-marker="true"]').forEach((run) => {
        run.setAttribute('data-noteboard-text-presentation', 'line-grid-overflow');
        delete run.dataset.restoreOverflowMarker;
      });
      const item = editor.querySelector<HTMLElement>('[data-restore-list-marker="true"]');
      if (item) {
        item.setAttribute('data-noteboard-text-presentation', 'line-grid-overflow-block');
        delete item.dataset.restoreListMarker;
      }
    });
    expect(hiddenPixels).toBeLessThan(3);
    expect(unmaskedPixels).toBeGreaterThan(hiddenPixels + 5);

    const selectionText = await overflowEditor.evaluate((editor) => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let text: Text | null = null;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (node.data.includes('MMMMMMMM')) {
          text = node;
          break;
        }
      }
      if (!text) throw new Error('Expected retained overflow text');
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? '';
    });
    expect(selectionText).toBe('MMMMMMMM');
    const limitedEditor = page.locator('[data-board-element-editor-id="limited-entry"]');
    await expect.poll(() => limitedEditor.getAttribute('data-text-line-viewport-rows')).toBe('5');
    await limitedEditor.click();
    await limitedEditor.pressSequentially('A');
    for (let index = 0; index < 4; index += 1) await limitedEditor.press('Enter');
    const beforeRejectedEnter = await limitedEditor.evaluate((editor) => ({
      rows: Array.from(editor.children).filter((child) => /^(DIV|P|LI|BLOCKQUOTE|H[1-3])$/.test(child.tagName)).length +
        (Array.from(editor.childNodes).some((node) => node.nodeType === Node.TEXT_NODE ||
          (node instanceof Element && !/^(DIV|P|LI|BLOCKQUOTE|H[1-3])$/.test(node.tagName))) ? 1 : 0),
      text: editor.textContent?.replace(/\u200b/g, ''),
      html: editor.innerHTML,
      childTags: Array.from(editor.children).map((child) => child.tagName),
    }));
    expect(beforeRejectedEnter.rows, JSON.stringify(beforeRejectedEnter)).toBe(5);
    expect(beforeRejectedEnter.text).toBe('A');
    await limitedEditor.evaluate((editor) => {
      const events: Array<Record<string, unknown>> = [];
      const record = (event: Event) => {
        const input = event as InputEvent;
        events.push({
          type: event.type,
          inputType: input.inputType,
          cancelable: event.cancelable,
          defaultPrevented: event.defaultPrevented,
          data: input.data,
        });
      };
      editor.addEventListener('beforeinput', record);
      editor.addEventListener('input', record);
      (window as any).__textCapacityEvents = events;
    });
    await limitedEditor.press('Enter');
    const rejectedEnter = await limitedEditor.evaluate((editor) => ({
      rows: Array.from(editor.children).filter((child) => /^(DIV|P|LI|BLOCKQUOTE|H[1-3])$/.test(child.tagName)).length +
        (Array.from(editor.childNodes).some((node) => node.nodeType === Node.TEXT_NODE ||
          (node instanceof Element && !/^(DIV|P|LI|BLOCKQUOTE|H[1-3])$/.test(node.tagName))) ? 1 : 0),
      text: editor.textContent?.replace(/\u200b/g, ''),
      html: editor.innerHTML,
      childTags: Array.from(editor.children).map((child) => child.tagName),
      events: (window as any).__textCapacityEvents,
    }));
    expect(rejectedEnter.events).toMatchObject([
      { type: 'beforeinput', inputType: 'insertParagraph', cancelable: true, defaultPrevented: true },
    ]);
    expect(rejectedEnter.events).toHaveLength(1);
    expect({ rows: rejectedEnter.rows, text: rejectedEnter.text, html: rejectedEnter.html, childTags: rejectedEnter.childTags },
      JSON.stringify({ before: beforeRejectedEnter, after: rejectedEnter }))
      .toEqual(beforeRejectedEnter);

    const pasteRejected = await limitedEditor.evaluate((editor) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'PASTE\nOVERFLOW');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      editor.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(pasteRejected).toBe(true);
    expect(await limitedEditor.textContent()).not.toContain('PASTE');

    const dropResult = await limitedEditor.evaluate((editor) => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let text: Text | null = null;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (node.data.includes('A')) {
          text = node;
          break;
        }
      }
      if (!text) throw new Error('Expected the first visible text row');
      const range = document.createRange();
      const offset = text.data.indexOf('A') + 1;
      range.setStart(text, offset);
      range.collapse(true);
      editor.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'DROP');
      transfer.setData('text/html', '<b onclick="document.body.dataset.rawDrop=\'true\'">DROP</b><img src="/__raw_html_drop_probe.png">');
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      editor.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        text: editor.textContent?.replace(/\u200b/g, ''),
        images: editor.querySelectorAll('img').length,
        inlineHandler: editor.querySelector('[onclick]') !== null,
        rawSideEffect: document.body.dataset.rawDrop === 'true',
      };
    });
    expect(dropResult.prevented).toBe(true);
    expect(dropResult.text).toContain('DROP');
    expect(dropResult.images).toBe(0);
    expect(dropResult.inlineHandler).toBe(false);
    expect(dropResult.rawSideEffect).toBe(false);
    expect(rawDropRequests).toHaveLength(0);

    const naturalEditor = page.locator('[data-board-element-editor-id="natural-mixed"]');
    const naturalBefore = await naturalEditor.evaluate((editor) => ({
      lineHeight: getComputedStyle(editor.querySelector('li')!).lineHeight,
      ruled: editor.classList.contains('text-lines-everywhere') || editor.classList.contains('text-lines-blocks'),
      largeFont: getComputedStyle(editor.querySelector('li span')!).fontSize,
      viewport: Number(editor.getAttribute('data-text-line-viewport-height')),
      outerHeight: editor.parentElement?.parentElement?.getBoundingClientRect().height ?? 0,
      maskedTail: editor.querySelectorAll('[data-noteboard-text-presentation="line-grid-overflow"]').length,
    }));
    expect(naturalBefore.ruled).toBe(false);
    expect(naturalBefore.largeFont).toBe('30px');
    expect(naturalBefore.lineHeight).not.toBe('10px');
    expect(naturalBefore.viewport).toBeLessThan(naturalBefore.outerHeight);
    expect(naturalBefore.maskedTail).toBeGreaterThan(0);
    const hiddenNaturalMarker = await naturalEditor.locator('li').nth(1).evaluate((item) => getComputedStyle(item, '::marker').color);
    expect(hiddenNaturalMarker).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await naturalEditor.evaluate((editor) => {
      const text = editor.querySelector('li')?.querySelector('span')?.firstChild;
      if (!(text instanceof Text)) throw new Error('Expected large mixed-size text');
      const range = document.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      editor.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await naturalEditor.press('Enter');
    expect(await naturalEditor.textContent()).toContain('TAIL');
    expect(await naturalEditor.locator(':scope > ul > li').count()).toBe(2);

    const overflowNode = page.locator('[data-board-element-id="overflow-row"]');
    await page.getByTitle('Select Tool').click();
    await overflowNode.click();
    const originalBox = await overflowNode.boundingBox();
    const growHandle = overflowNode.locator('.cursor-se-resize');
    await expect(growHandle).toBeVisible();
    const growHandleBox = await growHandle.boundingBox();
    if (!originalBox || !growHandleBox) throw new Error('Expected the selected text resize handle');
    const growStart = { x: growHandleBox.x + growHandleBox.width / 2, y: growHandleBox.y + growHandleBox.height / 2 };
    await page.mouse.move(growStart.x, growStart.y);
    await page.mouse.down();
    await page.mouse.move(growStart.x, growStart.y + 42, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await overflowEditor.getAttribute('data-text-line-viewport-rows'))).toBeGreaterThan(5);
    await expect.poll(() => overflowEditor.locator('[data-noteboard-text-presentation="line-grid-overflow"]').count()).toBe(0);
    expect(await overflowEditor.textContent()).toContain('MMMMMMMM');
    expect(await overflowEditor.textContent()).toContain('TAIL');
    const expandedBox = await overflowNode.boundingBox();
    const shrinkHandle = overflowNode.locator('.cursor-se-resize');
    const shrinkHandleBox = await shrinkHandle.boundingBox();
    if (!expandedBox || !shrinkHandleBox) throw new Error('Expected the expanded text resize handle');
    const shrinkStart = { x: shrinkHandleBox.x + shrinkHandleBox.width / 2, y: shrinkHandleBox.y + shrinkHandleBox.height / 2 };
    await page.mouse.move(shrinkStart.x, shrinkStart.y);
    await page.mouse.down();
    await page.mouse.move(shrinkStart.x, shrinkStart.y - (expandedBox.height - originalBox.height), { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await overflowEditor.getAttribute('data-text-line-viewport-rows'))).toBe(5);
    await expect.poll(() => overflowEditor.locator('[data-noteboard-text-presentation="line-grid-overflow"]').count()).toBeGreaterThan(0);

    await expect.poll(async () => {
      const saved = await readBoard(request);
      return saved?.elements.find((element: { id: string }) => element.id === 'limited-entry')?.content ?? '';
    }).toContain('A');
    const saved = await readBoard(request);
    const overflowCanonical = saved.elements.find((element: { id: string }) => element.id === 'overflow-row')?.content ?? '';
    const limitedCanonical = saved.elements.find((element: { id: string }) => element.id === 'limited-entry')?.content ?? '';
    const naturalCanonical = saved.elements.find((element: { id: string }) => element.id === 'natural-mixed')?.content ?? '';
    expect(overflowCanonical).toContain('MMMMMMMM');
    expect(overflowCanonical).toContain('TAIL');
    expect(overflowCanonical).not.toContain('data-noteboard-text-presentation');
    expect(limitedCanonical).toContain('A');
    expect(limitedCanonical).toContain('DROP');
    expect(limitedCanonical).not.toContain('PASTE');
    expect(limitedCanonical).not.toContain('\u200b');
    expect((limitedCanonical.match(/<div/g) ?? []).length).toBe(4);
    expect(naturalCanonical).toContain('TAIL');
    expect(naturalCanonical).not.toContain('data-noteboard-text-presentation');
  } finally {
    await deleteFixtureBoard(request, `/api/pages/${boardId}`);
  }
});

test('Empty Enter at unruled text capacity keeps the caret visible', async ({ page, request }) => {
  await seedBoard(request);
  try {
    await openBoard(page);
    const editor = page.locator('[data-board-element-editor-id="unruled-empty"]');
    await expect.poll(() => editor.getAttribute('data-text-line-viewport-rows')).not.toBeNull();
    const capacity = Number(await editor.getAttribute('data-text-line-viewport-rows'));
    expect(capacity).toBeGreaterThan(0);
    const lineHeight = await editor.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight));
    const clickY = Math.min((capacity - 0.5) * lineHeight, (await editor.boundingBox())!.height - 2);
    await editor.click();
    for (let index = 0; index < capacity; index += 1) await editor.press('Enter');
    await editor.click({ position: { x: 5, y: clickY } });

    await editor.evaluate((element) => {
      const events: Array<{ inputType: string; defaultPrevented: boolean }> = [];
      element.addEventListener('beforeinput', (event) => {
        const input = event as InputEvent;
        events.push({ inputType: input.inputType, defaultPrevented: input.defaultPrevented });
      });
      (window as any).__unruledEnterEvents = events;
    });
    const beforeHtml = await editor.evaluate((element) => element.innerHTML);
    await editor.press('Enter');
    const state = await editor.evaluate((element) => {
      const editorBox = element.getBoundingClientRect();
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
      const line = anchorElement?.closest<HTMLElement>('p,div,li,blockquote,h1,h2,h3');
      const lineBox = line?.getBoundingClientRect();
      return {
        events: (window as any).__unruledEnterEvents,
        focused: document.activeElement === element,
        inside: Boolean(window.getSelection()?.anchorNode && element.contains(window.getSelection()!.anchorNode)),
        html: element.innerHTML,
        lineIndex: line ? Array.from(element.children).indexOf(line) : -1,
        lineBox: lineBox ? { top: lineBox.top, bottom: lineBox.bottom } : null,
        editorBox: { top: editorBox.top, bottom: editorBox.bottom },
      };
    });
    expect(state.events).toEqual([{ inputType: 'insertParagraph', defaultPrevented: true }]);
    expect(state.focused).toBe(true);
    expect(state.inside).toBe(true);
    expect(state.html).toBe(beforeHtml);
    expect(state.lineIndex).toBe(capacity - 1);
    expect(state.lineBox?.top).toBeGreaterThanOrEqual(state.editorBox.top);
    expect(state.lineBox?.bottom).toBeLessThanOrEqual(state.editorBox.bottom + 0.75);
  } finally {
    await deleteFixtureBoard(request, `/api/pages/${boardId}`);
  }
});

test('Empty Enter from a hidden line returns the caret to the last visible row', async ({ page, request }) => {
  await seedBoard(request);
  try {
    await openBoard(page);
    const editor = page.locator('[data-board-element-editor-id="unruled-overflow"]');
    await expect.poll(() => editor.getAttribute('data-text-line-viewport-rows')).not.toBeNull();
    const capacity = Number(await editor.getAttribute('data-text-line-viewport-rows'));
    await editor.evaluate((element) => {
      const hiddenLine = element.lastElementChild;
      if (!hiddenLine) throw new Error('Expected a persisted overflowing empty line');
      element.focus();
      const range = document.createRange();
      range.setStart(hiddenLine, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await editor.evaluate((element) => {
      const events: Array<{ inputType: string; defaultPrevented: boolean }> = [];
      element.addEventListener('beforeinput', (event) => {
        const input = event as InputEvent;
        events.push({ inputType: input.inputType, defaultPrevented: input.defaultPrevented });
      });
      (window as any).__hiddenEnterEvents = events;
    });
    const beforeHtml = await editor.evaluate((element) => element.innerHTML);
    await editor.press('Enter');
    const state = await editor.evaluate((element) => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
      const line = anchorElement?.closest<HTMLElement>('p,div,li,blockquote,h1,h2,h3');
      const lineBox = line?.getBoundingClientRect();
      const editorBox = element.getBoundingClientRect();
      return {
        events: (window as any).__hiddenEnterEvents,
        html: element.innerHTML,
        focused: document.activeElement === element,
        inside: Boolean(anchor && element.contains(anchor)),
        lineIndex: line ? Array.from(element.children).indexOf(line) : -1,
        lineVisible: Boolean(lineBox && lineBox.top >= editorBox.top && lineBox.bottom <= editorBox.bottom + 0.75),
      };
    });
    expect(state.events).toEqual([{ inputType: 'insertParagraph', defaultPrevented: true }]);
    expect(state.html).toBe(beforeHtml);
    expect(state.focused).toBe(true);
    expect(state.inside).toBe(true);
    expect(state.lineIndex).toBe(capacity - 1);
    expect(state.lineVisible).toBe(true);
  } finally {
    await deleteFixtureBoard(request, `/api/pages/${boardId}`);
  }
});
