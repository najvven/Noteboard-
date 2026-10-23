import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSimpleWorkbook } from '../../src/features/spreadsheet/simple-workbook';
import { gridObjectSize } from '../../src/features/spreadsheet/grid-geometry';

async function createBoard(request: APIRequestContext, id: string, elements: unknown[]) {
  await request.delete(`/api/pages/${id}`);
  const response = await request.post('/api/pages', { data: [{
    id, title: id, version: 4, width: 1100, height: 700,
    workspaceWidth: 1500, workspaceHeight: 1000, boardX: 64, boardY: 0,
    viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(), elements,
    editorSettings: { activeTool: 'select', keepToolActive: true, enableObjectSnapping: false },
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

async function flipSelected(page: Page, id: string, axis: 'horizontal' | 'vertical') {
  await page.locator(`[data-board-element-id="${id}"]`).click();
  const button = page.getByRole('toolbar', { name: 'Element properties' })
    .getByRole('button', { name: `Flip ${axis === 'horizontal' ? 'Horizontally' : 'Vertically'}`, exact: true });
  await expect(button).toBeVisible();
  await button.click();
}

async function selectFromLayers(page: Page, id: string) {
  await page.getByRole('button', { name: 'Open Layers Panel', exact: true }).click();
  const tile = page.locator(`[data-layer-tile-id="${id}"]`);
  await expect(tile).toBeVisible();
  const box = await tile.boundingBox();
  if (!box) throw new Error(`Expected visible Layers tile ${id}`);
  const point = { x: box.x + Math.min(16, box.width / 4), y: box.y + box.height - 10 };
  const hit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return {
      tileId: target?.closest<HTMLElement>('[data-layer-tile-id]')?.dataset.layerTileId,
      input: Boolean(target?.closest('input')),
    };
  }, point);
  expect(hit).toEqual({ tileId: id, input: false });
  await page.mouse.click(point.x, point.y);
  await expect(tile).toHaveClass(/border-gray-400/);
  await page.getByRole('button', { name: 'Open Layers Panel', exact: true }).click();
}

test('text, drawing, group, board surface and checklist expose shared flip controls', async ({ page, request }) => {
  const id = 'task021-flip-visuals';
  await createBoard(request, id, [
    { id: 'flip-text', type: 'text', position: { x: 100, y: 90 }, size: { width: 200, height: 60 }, content: '<p>Text</p>', zIndex: 1 },
    { id: 'flip-draw', type: 'draw', position: { x: 330, y: 90 }, size: { width: 120, height: 70 }, points: [{ x: 0, y: 20 }, { x: 110, y: 20 }], borderWidth: 4, borderColor: '#111111', content: '', zIndex: 2 },
    { id: 'flip-group', type: 'group', position: { x: 480, y: 90 }, size: { width: 140, height: 100 }, content: '', zIndex: 3 },
    { id: 'group-child', type: 'rectangle', parentId: 'flip-group', position: { x: 510, y: 120 }, size: { width: 40, height: 30 }, color: '#60a5fa', content: '', zIndex: 1 },
    { id: 'flip-board', type: 'board', position: { x: 680, y: 90 }, size: { width: 130, height: 90 }, content: '', zIndex: 4 },
    { id: 'flip-checklist', type: 'checklist', position: { x: 680, y: 240 }, size: { width: 150, height: 100 }, content: 'Check', zIndex: 5 },
  ]);
  try {
    await openBoard(page, id);
    await flipSelected(page, 'flip-text', 'horizontal');
    await expect.poll(async () => (await readBoard(request, id))?.elements.find((element: any) => element.id === 'flip-text')?.flipX).toBe(true);
    await flipSelected(page, 'flip-draw', 'vertical');
    await expect.poll(async () => (await readBoard(request, id))?.elements.find((element: any) => element.id === 'flip-draw')?.flipY).toBe(true);
    await flipSelected(page, 'flip-group', 'horizontal');
    await expect.poll(async () => (await readBoard(request, id))?.elements.find((element: any) => element.id === 'flip-group')?.flipX).toBe(true);
    await expect.poll(async () => (await readBoard(request, id))?.elements.find((element: any) => element.id === 'group-child')?.flipX).toBe(true);

    await selectFromLayers(page, 'flip-board');
    const groupBeforeBoardFlip = await readBoard(request, id);
    expect(groupBeforeBoardFlip.elements.find((element: any) => element.id === 'flip-group')?.flipX).toBe(true);
    expect(groupBeforeBoardFlip.elements.find((element: any) => element.id === 'flip-board')?.flipY).not.toBe(true);
    await expect(page.locator('[data-layer-tile-id="flip-group"]')).not.toHaveClass(/border-gray-400/);
    await expect(page.locator('[data-layer-tile-id="flip-board"]')).toHaveClass(/border-gray-400/);
    const propertiesToolbar = page.getByRole('toolbar', { name: 'Element properties' });
    await expect(propertiesToolbar).toHaveCount(1);
    await propertiesToolbar.getByRole('button', { name: 'Flip Vertically', exact: true }).click();
    await expect(propertiesToolbar.getByRole('button', { name: 'Preserve Ratio', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await readBoard(request, id))?.elements.find((element: any) => element.id === 'flip-board')?.flipY).toBe(true);
    await expect.poll(async () => (await readBoard(request, id))?.elements.find((element: any) => element.id === 'flip-group')?.flipX).toBe(true);
    await flipSelected(page, 'flip-checklist', 'horizontal');
    await expect.poll(async () => (await readBoard(request, id))?.elements.find((element: any) => element.id === 'flip-checklist')?.flipX).toBe(true);
  } finally {
    await request.delete(`/api/pages/${id}`);
  }
});

test('flipped spreadsheet still receives clicks at the visible cell location', async ({ page, request }) => {
  const id = 'task021-flip-spreadsheet';
  const workbook = createSimpleWorkbook(348, 142, { width: 100, height: 24 });
  workbook.workbook.sheets!['sheet-1'].cellData = { 0: { 0: { v: 'Left' }, 2: { v: 'Right' } } };
  await createBoard(request, id, [{
    id: 'flip-sheet', type: 'table', position: { x: 120, y: 120 },
    size: gridObjectSize(workbook), content: JSON.stringify(workbook), zIndex: 1,
  }]);
  try {
    await openBoard(page, id);
    await flipSelected(page, 'flip-sheet', 'horizontal');
    const sheet = page.locator('[data-board-element-id="flip-sheet"]');
    await sheet.click({ position: { x: 80, y: 15 } });
    const grid = page.frameLocator('iframe[title="Spreadsheet cells"]').locator('canvas[id^="univer-sheet-main-canvas_"]');
    await expect(grid).toBeVisible();
    await grid.click({ position: { x: 90, y: 32 } });
    await page.keyboard.type('mapped after flip');
    await page.keyboard.press('Enter');
    await expect.poll(async () => {
      const board = await readBoard(request, id);
      const document = JSON.parse(board?.elements.find((element: any) => element.id === 'flip-sheet')?.content ?? '{}');
      return document.workbook?.sheets?.['sheet-1']?.cellData?.[0]?.[2]?.v;
    }).toBe('mapped after flip');
  } finally {
    await request.delete(`/api/pages/${id}`);
  }
});
