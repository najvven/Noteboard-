import { expect, test } from './test';

test('Fill Tool captures visible board pixels in browser preview', async ({ page, request }) => {
  test.setTimeout(60000);
  const id = 'browser-fill-preview';
  const board = {
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
    elements: [{
      id: 'browser-fill-square',
      type: 'rectangle',
      position: { x: 250, y: 170 },
      size: { width: 180, height: 120 },
      content: '',
      color: '#ffffff',
      borderColor: '#000000',
      borderWidth: 8,
      zIndex: 1,
    }],
    editorSettings: { activeTool: 'select', keepToolActive: true, fillToolColor: '#ff0000' },
  };
  const created = await request.post('/api/pages', { data: [board] });
  expect(created.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${id}`, exact: true }).click();
  const square = page.locator('[data-board-element-id="browser-fill-square"]');
  await expect(square).toBeVisible();
  const bounds = await square.boundingBox();
  expect(bounds).not.toBeNull();
  const interior = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };

  await page.getByTitle('Fill Tool').click();
  await page.mouse.click(interior.x, interior.y);
  await expect.poll(async () => {
    const response = await request.get('/api/pages');
    const pages = await response.json() as Array<{ id: string; elements: Array<{ isPixelFill?: boolean; content: string }> }>;
    return Boolean(pages.find(candidate => candidate.id === id)?.elements.find(element => element.isPixelFill)?.content);
  }, { timeout: 45000 }).toBe(true);
  const pagesResponse = await request.get('/api/pages');
  const pages = await pagesResponse.json() as Array<{ id: string; elements: Array<{ isPixelFill?: boolean; content: string }> }>;
  const content = pages.find(candidate => candidate.id === id)?.elements.find(element => element.isPixelFill)?.content;
  expect(content).toMatch(/^data:image\/png;base64,/);
  const centerPixel = await page.evaluate(async dataUrl => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
  }, content!);
  expect(centerPixel).toEqual([255, 0, 0, 255]);
});
