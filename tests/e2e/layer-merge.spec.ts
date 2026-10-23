import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSimpleWorkbook } from '../../src/features/spreadsheet/simple-workbook';

const id = 'layer-merge-interaction';
const pageData = {
  id, title: id, version: 4, width: 1100, height: 700,
  workspaceWidth: 1500, workspaceHeight: 1000, boardX: 64, boardY: 0,
  viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(),
  editorSettings: { activeTool: 'select', keepToolActive: true, enableObjectSnapping: false },
  elements: [
    { id: 'outer', type: 'layer', position: { x: 0, y: 0 }, content: '', zIndex: 0 },
    { id: 'low', type: 'layer', parentId: 'outer', position: { x: 20, y: 30 }, content: '', zIndex: 1 },
    { id: 'low-child', type: 'rectangle', parentId: 'low', position: { x: 100, y: 120 }, size: { width: 80, height: 60 }, color: '#dbeafe', content: '', zIndex: 7, isHidden: true },
    { id: 'merge-sheet', type: 'table', parentId: 'low', position: { x: 120, y: 240 }, size: { width: 348, height: 142 }, content: JSON.stringify(createSimpleWorkbook(348, 142, { width: 100, height: 24 })), zIndex: 8 },
    { id: 'middle', type: 'layer', parentId: 'outer', position: { x: 25, y: 35 }, content: '', zIndex: 2 },
    { id: 'middle-child', type: 'text', parentId: 'middle', position: { x: 210, y: 120 }, size: { width: 120, height: 40 }, content: 'Keep middle', zIndex: 4 },
    { id: 'high', type: 'layer', parentId: 'outer', position: { x: 40, y: 50 }, content: '', zIndex: 3, isLocked: true },
    { id: 'high-child', type: 'draw', parentId: 'high', position: { x: 360, y: 120 }, size: { width: 80, height: 60 }, points: [{ x: 0, y: 10 }, { x: 70, y: 40 }], content: '', zIndex: 1 },
    { id: 'canvas-selection', type: 'text', position: { x: 620, y: 120 }, size: { width: 120, height: 40 }, content: 'Canvas selection', zIndex: 8 },
  ],
};

async function createPage(request: APIRequestContext) {
  await request.delete(`/api/pages/${id}`);
  const response = await request.post('/api/pages', { data: [pageData] });
  expect(response.ok()).toBeTruthy();
}

async function openPage(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${id}`, exact: true }).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
}

async function storedPage(request: APIRequestContext) {
  return (await (await request.get('/api/pages')).json()).find((board: any) => board.id === id);
}

async function clickLayerTile(page: Page, id: string, doubleClick = false) {
  const tile = page.locator(`[data-layer-tile-id="${id}"]`);
  await expect(tile).toBeVisible();
  if (doubleClick) await tile.dblclick();
  else await tile.click();
  return tile;
}

test('Layers merges picked siblings once, preserves canvas selection, and undoes in one step', async ({ page, request }) => {
  await createPage(request);
  try {
    await openPage(page);
    await page.getByRole('button', { name: 'Open Layers Panel', exact: true }).click();
    await clickLayerTile(page, 'outer', true);
    await expect(page.getByTitle('Back to Root')).toBeVisible();
    await expect(page.locator('[data-layer-tile-id="low"]')).toBeVisible();
    await page.getByRole('button', { name: 'Open Layers Panel', exact: true }).click();

    const table = page.locator('[data-board-element-id="merge-sheet"]');
    await table.click();
    await expect(table.locator('[title="Rotate"]')).toBeVisible();
    const grid = page.frameLocator('iframe[title="Spreadsheet cells"]').locator('canvas[id^="univer-sheet-main-canvas_"]');
    await expect(grid).toBeVisible();
    await grid.click({ position: { x: 90, y: 32 } });
    await page.keyboard.type('37');
    await page.keyboard.press('Enter');
    const readCell = async () => {
      const board = await storedPage(request);
      const content = board?.elements.find((element: any) => element.id === 'merge-sheet')?.content;
      return content ? JSON.parse(content).workbook.sheets['sheet-1'].cellData?.[0]?.[0]?.v : undefined;
    };
    const liveCell = () => page.locator('iframe[title="Spreadsheet cells"]').evaluate(frame => {
      const snapshot = (frame as HTMLIFrameElement).contentWindow as any;
      return JSON.parse(snapshot.noteboardSheet.snapshot()).workbook.sheets['sheet-1'].cellData?.[0]?.[0]?.v;
    });
    await expect.poll(liveCell).toBe(37);
    await expect(table.locator('[title="Rotate"]')).toBeVisible();
    await expect(page.locator('[data-spreadsheet-panel="true"]')).toBeVisible();
    await page.getByRole('button', { name: 'Open Layers Panel', exact: true }).click();

    const choose = page.getByRole('button', { name: 'Choose layers to merge', exact: true });
    await choose.click();
    const low = await clickLayerTile(page, 'low');
    await expect(low).toHaveAttribute('data-layer-merge-picked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Choose layers to merge', exact: true })).toBeVisible();
    await expect(low).not.toHaveAttribute('data-layer-merge-picked', 'true');
    await expect(table.locator('[title="Rotate"]')).toBeVisible();

    await page.getByRole('button', { name: 'Choose layers to merge', exact: true }).click();
    await clickLayerTile(page, 'low');
    const high = await clickLayerTile(page, 'high'); // Locked rows remain pickable.
    await expect(high).toHaveAttribute('data-layer-merge-picked', 'true');
    await expect(page.locator('[data-spreadsheet-panel="true"]')).toBeVisible();
    await expect(table.locator('[title="Rotate"]')).toBeVisible();
    await page.getByRole('button', { name: 'Merge selected layers', exact: true }).click();

    await expect.poll(async () => {
      const board = await storedPage(request);
      return board?.elements.filter((element: any) => ['low', 'middle', 'high'].includes(element.id)).map((element: any) => element.id).sort();
    }).toEqual(['high', 'middle']);
    let board = await storedPage(request);
    expect(board.elements.find((element: any) => element.id === 'high')?.isLocked).toBe(false);
    expect(board.elements.find((element: any) => element.id === 'low-child')).toMatchObject({ parentId: 'high', isHidden: true });
    expect(board.elements.find((element: any) => element.id === 'high-child')).toMatchObject({ parentId: 'high', isLocked: true });
    expect(board.elements.find((element: any) => element.id === 'middle-child')?.parentId).toBe('middle');
    expect(board.elements.find((element: any) => element.id === 'merge-sheet')?.parentId).toBe('high');
    expect(await readCell()).toBe(37);
    await expect(table.locator('[title="Rotate"]')).toBeVisible();

    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
    await expect.poll(async () => {
      board = await storedPage(request);
      return board?.elements.filter((element: any) => ['low', 'middle', 'high'].includes(element.id)).map((element: any) => element.id).sort();
    }).toEqual(['high', 'low', 'middle']);
    board = await storedPage(request);
    expect(board.elements.find((element: any) => element.id === 'low-child')?.parentId).toBe('low');
    expect(board.elements.find((element: any) => element.id === 'high-child')?.parentId).toBe('high');
    expect(board.elements.find((element: any) => element.id === 'merge-sheet')).toMatchObject({ parentId: 'low' });
    expect(await readCell()).toBe(37);
    await page.getByRole('button', { name: 'Redo (Ctrl+Y)', exact: true }).click();
    await expect.poll(async () => {
      const board = await storedPage(request);
      return board?.elements.find((element: any) => element.id === 'merge-sheet')?.parentId;
    }).toBe('high');
    expect(await readCell()).toBe(37);
  } finally {
    await request.delete(`/api/pages/${id}`);
  }
});
