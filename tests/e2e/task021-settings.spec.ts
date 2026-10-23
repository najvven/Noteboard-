import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const textElement = {
  id: 'task021-text', type: 'text', position: { x: 120, y: 120 },
  size: { width: 300, height: 120 }, content: 'Editable text', zIndex: 1,
};

async function createBoard(request: APIRequestContext, id: string, elements: unknown[], editorSettings: Record<string, unknown>) {
  await request.delete(`/api/pages/${id}`);
  const response = await request.post('/api/pages', { data: [{
    id, title: id, version: 4, width: 1100, height: 700,
    workspaceWidth: 1500, workspaceHeight: 1000, boardX: 64, boardY: 0,
    viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(),
    elements, editorSettings,
  }] });
  expect(response.ok()).toBeTruthy();
}

async function openBoard(page: Page, id: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${id}`, exact: true }).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
}

async function readBoard(request: APIRequestContext, id: string) {
  return (await (await request.get('/api/pages')).json()).find((board: any) => board.id === id);
}

async function drawQuickAddRegion(page: Page, overlapWithId?: string) {
  const root = await page.locator('[data-board-root="true"]').boundingBox();
  if (!root) throw new Error('Expected the visible board surface');
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const area = {
    left: Math.max(8, root.x + 8),
    top: Math.max(76, root.y + 8),
    right: Math.min(viewport.width - 8, root.x + root.width - 8),
    bottom: Math.min(viewport.height - 160, root.y + root.height - 160),
  };
  const regionWidth = 150;
  const regionHeight = 95;
  if (area.right - area.left < regionWidth || area.bottom - area.top < regionHeight) {
    throw new Error(`Visible board intersection is too small for a Quick Add region: ${JSON.stringify(area)}`);
  }
  const existing = await page.locator('[data-board-element-id]').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      id: (node as HTMLElement).dataset.boardElementId,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }));
  const positions: Array<{ x: number; y: number }> = [];
  const step = 48;
  for (let y = area.top; y + regionHeight <= area.bottom; y += step) {
    for (let x = area.left; x + regionWidth <= area.right; x += step) positions.push({ x, y });
  }
  positions.sort((left, right) =>
    Math.abs(left.x + regionWidth / 2 - viewport.width / 2) -
      Math.abs(right.x + regionWidth / 2 - viewport.width / 2) || left.y - right.y,
  );
  let start: { x: number; y: number } | undefined;
  for (const point of positions) {
    const candidate = { left: point.x, top: point.y, right: point.x + regionWidth, bottom: point.y + regionHeight };
    const colliding = existing.filter((rect) => candidate.left < rect.right + 4 && candidate.right > rect.left - 4 &&
      candidate.top < rect.bottom + 4 && candidate.bottom > rect.top - 4);
    if (overlapWithId
      ? !colliding.some((rect) => rect.id === overlapWithId) || colliding.some((rect) => rect.id !== overlapWithId)
      : colliding.length > 0) continue;
    const hits = await page.evaluate((bounds) => [
      { x: bounds.left + 2, y: bounds.top + 2 },
      { x: bounds.right - 2, y: bounds.bottom - 2 },
    ].map(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        board: Boolean(target?.closest('[data-board-root="true"]')),
        elementId: target?.closest<HTMLElement>('[data-board-element-id]')?.dataset.boardElementId ?? null,
        blockedControl: Boolean(target?.closest('[data-selection-area-toolbar],button,input,textarea,select')),
      };
    }), candidate);
    const endpointsHaveExpectedTargets = overlapWithId
      ? hits[0].elementId === null
      : hits.every((hit) => hit.elementId === null);
    if (hits.every((hit) => hit.board && !hit.blockedControl) && endpointsHaveExpectedTargets) {
      start = point;
      break;
    }
  }
  if (!start) throw new Error('Could not find empty Quick Add space inside the visible board intersection');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + regionWidth, start.y + regionHeight, { steps: 8 });
  await page.mouse.up();
  const toolbar = page.locator('[data-selection-area-toolbar="true"]');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByTitle('Text')).toBeInViewport();
}

test('Text transform defaults, explicit off settings, persistence, editing and border cursor', async ({ page, request }) => {
  const id = 'task021-text-settings';
  await createBoard(request, id, [textElement], { activeTool: 'text', keepToolActive: true });
  try {
    await openBoard(page, id);
    const node = page.locator('[data-board-element-id="task021-text"]');
    const editor = page.locator('[data-board-element-editor-id="task021-text"]');
    await editor.click();
    await page.getByRole('button', { name: 'Open text settings' }).click();
    const menu = page.locator('[data-toolbar-item="text"] .toolbar-dropdown');
    await menu.getByRole('button', { name: 'Tool settings', exact: true }).click();
    const editing = menu.getByRole('button', { name: 'Allow editing elements', exact: true });
    const moving = menu.getByRole('button', { name: 'Allow moving elements', exact: true });
    await expect(editing).toHaveAttribute('aria-pressed', 'true');
    await expect(moving).toHaveAttribute('aria-pressed', 'true');
    await expect(node.locator('[title="Rotate"]')).toBeVisible();

    await editing.click();
    await moving.click();
    await expect(editing).toHaveAttribute('aria-pressed', 'false');
    await expect(moving).toHaveAttribute('aria-pressed', 'false');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect.poll(async () => {
      const board = await readBoard(request, id);
      return board?.editorSettings?.toolMenuSettingsOverrides?.text;
    }).toMatchObject({ allowEditing: false, allowMoving: false });

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await openBoard(page, id);
    await page.getByRole('button', { name: 'Open text settings' }).click();
    const reopened = page.locator('[data-toolbar-item="text"] .toolbar-dropdown');
    await reopened.getByRole('button', { name: 'Tool settings', exact: true }).click();
    await expect(reopened.getByRole('button', { name: 'Allow editing elements', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(reopened.getByRole('button', { name: 'Allow moving elements', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Text Tool', exact: true }).click();
    await editor.click();
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(node.locator('[title="Rotate"]')).toHaveCount(0);
    await expect.poll(() => node.evaluate(element => getComputedStyle(element).cursor)).not.toBe('move');
  } finally {
    await request.delete(`/api/pages/${id}`);
  }
});

test('Switch tool after placing is off by default and follows quick-add choice when enabled', async ({ page, request }) => {
  const id = 'task021-quick-add-settings';
  await createBoard(request, id, [], {
    activeTool: 'select', keepToolActive: true, autoSelectOnPlace: true,
    isSelectionLockEnabled: false,
  });
  try {
    await openBoard(page, id);
    const settings = page.getByRole('button', { name: 'Select settings', exact: true });
    await settings.click();
    const menu = page.locator('.toolbar-dropdown').filter({ hasText: 'Select Settings' });
    const switchSetting = menu.getByRole('button', { name: 'Switch tool after placing', exact: true });
    await expect(switchSetting.locator('[data-menu-toggle="true"]')).toHaveAttribute('data-state', 'off');
    await settings.click();

    await drawQuickAddRegion(page);
    await page.locator('[data-selection-area-toolbar="true"]').getByTitle('Text').click();
    await expect(page.locator('[data-board-element-type="text"]')).toHaveCount(1);
    await expect.poll(async () => (await readBoard(request, id))?.editorSettings?.activeTool).toBe('select');
    await expect.poll(async () => (await readBoard(request, id))?.editorSettings?.switchToolAfterPlacing).toBe(false);

    await settings.click();
    await menu.getByRole('button', { name: 'Switch tool after placing', exact: true }).click();
    await expect(menu.getByRole('button', { name: 'Switch tool after placing', exact: true }).locator('[data-menu-toggle="true"]')).toHaveAttribute('data-state', 'on');
    await settings.click();
    await page.getByRole('button', { name: 'Select Tool', exact: true }).click();
    await drawQuickAddRegion(page);
    await page.locator('[data-selection-area-toolbar="true"]').getByTitle('Sticky').click();
    await expect(page.locator('[data-board-element-type="sticky"]')).toHaveCount(1);
    await expect.poll(async () => (await readBoard(request, id))?.editorSettings?.activeTool).toBe('sticky');
    await expect.poll(async () => (await readBoard(request, id))?.editorSettings?.switchToolAfterPlacing).toBe(true);
  } finally {
    await request.delete(`/api/pages/${id}`);
  }
});

test('rejected overlapping quick-add does not switch tools', async ({ page, request }) => {
  const id = 'task021-quick-add-rejected';
  await createBoard(request, id, [{
    id: 'overlap', type: 'rectangle', position: { x: 200, y: 200 },
    size: { width: 150, height: 95 }, color: '#dbeafe', content: '', zIndex: 1,
  }], {
    activeTool: 'select', keepToolActive: false, autoSelectOnPlace: false,
    keepToolActiveFallback: 'pan',
    switchToolAfterPlacing: true, isSelectionLockEnabled: false, overlapMode: 'full',
  });
  try {
    await openBoard(page, id);
    await drawQuickAddRegion(page, 'overlap');
    await page.locator('[data-selection-area-toolbar="true"]').getByTitle('Text').click();
    await expect(page.locator('[data-board-element-type="text"]')).toHaveCount(0);
    await expect.poll(async () => (await readBoard(request, id))?.editorSettings?.activeTool).toBe('select');
  } finally {
    await request.delete(`/api/pages/${id}`);
  }
});
