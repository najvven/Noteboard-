import { expect, test } from './test';
import sharp from 'sharp';

const createBoard = (id: string, elements: unknown[]) => ({
  id,
  title: id,
  width: 700,
  height: 500,
  workspaceWidth: 1400,
  workspaceHeight: 900,
  boardX: 350,
  boardY: 200,
  viewportCenterX: 700,
  viewportCenterY: 450,
  zoom: 1,
  boardColor: '#ffffff',
  updatedAt: Date.now(),
  elements,
  editorSettings: { activeTool: 'select', keepToolActive: true, fillToolColor: '#ff0000' },
});

test('Fill Tool fills the visible pixels inside a simple shape without native capture', async ({ page, request }) => {
  const id = 'browser-fill-visible-pixels';
  const board = Object.assign(createBoard(id, [{
    id: 'outlined-square',
    type: 'rectangle',
    position: { x: 250, y: 170 },
    size: { width: 180, height: 120 },
    content: '',
    color: '#ffffff',
    borderColor: '#000000',
    borderWidth: 8,
    zIndex: 1,
  }]), {
    showGrid: true,
    gridSize: 24,
    gridThickness: 2,
    gridColor: '#9ca3af',
  });
  const created = await request.post('/api/pages', { data: [board] });
  expect(created.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${id}`, exact: true }).click();
  const square = page.locator('[data-board-element-id="outlined-square"]');
  await expect(square).toBeVisible();
  const bounds = await square.boundingBox();
  expect(bounds).not.toBeNull();

  await page.getByTitle('Fill Tool').click();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await expect.poll(async () => {
    const response = await request.get('/api/pages');
    const pages = await response.json() as Array<{
      id: string;
      boardColor?: string;
      elements: Array<{ id: string; color?: string; borderColor?: string; isPixelFill?: boolean; content?: string; size?: { width: number; height: number } }>;
    }>;
    const saved = pages.find(candidate => candidate.id === id);
    return saved?.elements.some(element => element.isPixelFill) && saved.elements.find(element => element.id === 'outlined-square')?.color;
  }).toBe('#ffffff');

  const response = await request.get('/api/pages');
  const pages = await response.json() as Array<{
    id: string;
    boardColor?: string;
    elements: Array<{ id: string; color?: string; borderColor?: string; isPixelFill?: boolean; pixelFillBoardId?: string; content?: string; size?: { width: number; height: number } }>;
  }>;
  const saved = pages.find(candidate => candidate.id === id)!;
  const squareData = saved.elements.find(element => element.id === 'outlined-square')!;
  expect(saved.boardColor).toBe('#ffffff');
  expect(squareData).toMatchObject({ color: '#ffffff', borderColor: '#000000' });
  const fill = saved.elements.find(element => element.isPixelFill)!;
  expect(fill.pixelFillBoardId).toBe('main-board');
  expect(fill.content).toMatch(/^data:image\/png;base64,/);
  expect(fill.size?.width).toBeGreaterThan(100);
  expect(fill.size?.height).toBeGreaterThan(60);
  const rendered = await sharp(Buffer.from(fill.content!.split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const offset = (y * rendered.info.width + x) * rendered.info.channels;
    return [...rendered.data.subarray(offset, offset + 4)];
  };
  expect(pixel(Math.floor(rendered.info.width / 2), Math.floor(rendered.info.height / 2))).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => {
    const current = await request.get('/api/pages');
    const documents = await current.json() as Array<{ id: string; elements: Array<{ id: string; isPixelFill?: boolean }> }>;
    return documents.find(candidate => candidate.id === id)?.elements.some(element => element.isPixelFill);
  }).toBe(false);
});

test('Fill outside a closed outline preserves the enclosed region and board color', async ({ page, request }) => {
  const id = 'browser-fill-outside-loop';
  const board = createBoard(id, [{
    id: 'closed-square',
    type: 'rectangle',
    position: { x: 250, y: 170 },
    size: { width: 180, height: 120 },
    content: '',
    color: '#ffffff',
    borderColor: '#000000',
    borderWidth: 8,
    zIndex: 1,
  }]);
  const created = await request.post('/api/pages', { data: [board] });
  expect(created.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${id}`, exact: true }).click();
  await page.getByTitle('Fill Tool').click();
  const surface = page.locator('#main-board');
  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + 8, bounds!.y + 8);

  await expect.poll(async () => {
    const pages = await request.get('/api/pages').then(response => response.json()) as Array<{
      id: string;
      boardColor?: string;
      elements: Array<{ id: string; color?: string; borderColor?: string; isPixelFill?: boolean }>;
    }>;
    const saved = pages.find(candidate => candidate.id === id);
    return saved?.elements.filter(element => element.isPixelFill).length;
  }, { timeout: 45000 }).toBe(1);

  const pages = await request.get('/api/pages').then(response => response.json()) as Array<{
    id: string;
    boardColor?: string;
    elements: Array<{ id: string; color?: string; borderColor?: string; isPixelFill?: boolean }>;
  }>;
  const saved = pages.find(candidate => candidate.id === id)!;
  expect(saved.boardColor).toBe('#ffffff');
  expect(saved.elements.find(element => element.id === 'closed-square')).toMatchObject({
    color: '#ffffff',
    borderColor: '#000000',
  });
});

test('Fill ignores middle-button clicks and preserves workspace panning', async ({ page, request }) => {
  const id = 'browser-fill-middle-pan';
  const board = createBoard(id, [{
    id: 'outlined-square',
    type: 'rectangle',
    position: { x: 250, y: 170 },
    size: { width: 180, height: 120 },
    content: '',
    color: '#ffffff',
    borderColor: '#000000',
    borderWidth: 8,
    zIndex: 1,
  }]);
  board.workspaceWidth = 2400;
  board.workspaceHeight = 1600;
  board.boardX = 850;
  board.boardY = 550;
  board.viewportCenterX = 1200;
  board.viewportCenterY = 800;
  const created = await request.post('/api/pages', { data: [board] });
  expect(created.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${id}`, exact: true }).click();
  const workspace = page.locator('.workspace-scroll');
  const square = page.locator('[data-board-element-id="outlined-square"]');
  await expect(square).toBeVisible();
  await page.getByTitle('Fill Tool').click();

  const before = await workspace.evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop }));
  const bounds = (await square.boundingBox())!;
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(start.x - 80, start.y - 50, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(() => workspace.evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop })))
    .not.toEqual(before);

  const pages = await request.get('/api/pages').then(response => response.json()) as Array<{
    id: string;
    elements: Array<{ id: string; color?: string; isPixelFill?: boolean }>;
  }>;
  const savedPage = pages.find(candidate => candidate.id === id)!;
  const savedSquare = savedPage.elements.find(element => element.id === 'outlined-square');
  expect(savedSquare?.color).toBe('#ffffff');
  expect(savedPage.elements.some(element => element.isPixelFill)).toBe(false);
});

test('Fill Tool uses a scene raster for a closed freehand contour in browser preview', async ({ page, request }) => {
  test.setTimeout(60000);
  const id = 'browser-fill-drawing-region';
  const board = createBoard(id, [{
    id: 'closed-drawing',
    type: 'draw',
    position: { x: 250, y: 170 },
    size: { width: 180, height: 120 },
    points: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 120 }, { x: 0, y: 120 }, { x: 0, y: 0 }],
    content: '',
    color: 'transparent',
    borderColor: '#000000',
    borderWidth: 8,
    zIndex: 1,
  }]);
  const created = await request.post('/api/pages', { data: [board] });
  expect(created.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${id}`, exact: true }).click();
  const drawing = page.locator('[data-board-element-id="closed-drawing"]');
  await expect(drawing).toBeVisible();
  const bounds = await drawing.boundingBox();
  expect(bounds).not.toBeNull();

  await page.getByTitle('Fill Tool').click();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await expect.poll(async () => {
    const response = await request.get('/api/pages');
    const pages = await response.json() as Array<{ id: string; elements: Array<{ isPixelFill?: boolean; content: string }> }>;
    return Boolean(pages.find(candidate => candidate.id === id)?.elements.find(element => element.isPixelFill)?.content);
  }, { timeout: 45000 }).toBe(true);
  const pagesResponse = await request.get('/api/pages');
  const pages = await pagesResponse.json() as Array<{ id: string; elements: Array<{ isPixelFill?: boolean; content: string }> }>;
  const fill = pages.find(candidate => candidate.id === id)?.elements.find(element => element.isPixelFill);
  expect(fill?.content).toMatch(/^data:image\/png;base64,/);
});
