import { deleteFixtureBoard } from './fixture-storage';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

async function open(page: Page, request: APIRequestContext, elements: unknown[] = []) {
  for (const item of await (await request.get('/api/pages')).json()) await deleteFixtureBoard(request, `/api/pages/${item.id}`);
  await request.post('/api/pages', { data: [{ id: 'zoom-colors', title: 'Zoom and colors', version: 3, width: 1000, height: 600, boardX: 1500, boardY: 1400, workspaceWidth: 4000, workspaceHeight: 4000, viewportCenterX: 2000, viewportCenterY: 1700, zoom: 1, updatedAt: Date.now(), isPinned: false, elements, editorSettings: { activeTool: 'select', keepToolActive: true, enableObjectSnapping: false } }] });
  await page.goto('/'); await page.getByRole('button', { name: 'Open Zoom and colors' }).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
}

async function pointUnderCursor(page: Page, x: number, y: number) {
  return page.locator('[data-board-root]').evaluate((el, point) => {
    const r = el.getBoundingClientRect(), zoom = r.width / 1000;
    return { x: (point.x - r.left) / zoom, y: (point.y - r.top) / zoom, zoom };
  }, { x, y });
}

test('Ctrl wheel and Zoom tool keep the cursor anchor, and zoom settings persist', async ({ page, request }) => {
  await open(page, request);
  const root = page.locator('[data-board-root]');
  const box = (await root.boundingBox())!;
  const x = box.x + 180, y = box.y + 220;
  await page.mouse.move(x, y);
  for (const delta of [-100, -80, 70, 110]) {
    const before = await pointUnderCursor(page, x, y);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, delta); await page.keyboard.up('Control');
    await expect.poll(async () => (await pointUnderCursor(page, x, y)).zoom).not.toBe(before.zoom);
    const after = await pointUnderCursor(page, x, y);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  }
  const grayX = 10, grayY = 200;
  const grayBefore = await pointUnderCursor(page, grayX, grayY);
  await page.mouse.move(grayX, grayY);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -80); await page.keyboard.up('Control');
  await expect.poll(async () => (await pointUnderCursor(page, grayX, grayY)).zoom).not.toBe(grayBefore.zoom);
  const grayAfter = await pointUnderCursor(page, grayX, grayY);
  expect(Math.abs(grayAfter.x - grayBefore.x)).toBeLessThan(1);
  expect(Math.abs(grayAfter.y - grayBefore.y)).toBeLessThan(1);
  const scrollBefore = await page.locator('.workspace-scroll').evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, 50);
  await expect.poll(()=>page.locator('.workspace-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(scrollBefore);
  expect((await pointUnderCursor(page, grayX, grayY)).zoom).toBe(grayAfter.zoom);
  await page.getByRole('button', { name: 'Zoom Tool', exact: true }).click();
  const beforeClick = await pointUnderCursor(page, x, y);
  await page.mouse.click(x, y);
  await expect.poll(async () => (await pointUnderCursor(page, x, y)).zoom).toBeGreaterThan(beforeClick.zoom);
  const afterClick = await pointUnderCursor(page, x, y);
  expect(Math.abs(afterClick.x - beforeClick.x)).toBeLessThan(1);
  expect(Math.abs(afterClick.y - beforeClick.y)).toBeLessThan(1);

  await page.getByRole('button', { name: 'General Settings', exact: true }).click();
  await page.locator('[data-general-settings-section="shortcutSettings"]').getByRole('button', { name: 'Shortcuts & Zoom settings', exact: true }).click();
  const settings = page.locator('[data-general-settings-section="shortcutSettings"]');
  await settings.getByRole('group', { name: 'Zoom towards' }).getByRole('button', { name: 'Center', exact: true }).click();
  const recorder = settings.locator('div.flex.items-center.justify-between').filter({ has: page.getByText('Scroll zoom', { exact: true }) }).locator('.shortcut-recorder');
  await recorder.click(); await recorder.press('Shift');
  await page.getByRole('button', { name: 'General Settings', exact: true }).click();
  const viewport = (await page.locator('.workspace-scroll').boundingBox())!;
  const centerX = viewport.x + (await page.locator('.workspace-scroll').evaluate(el => el.clientWidth)) / 2;
  const centerY = viewport.y + (await page.locator('.workspace-scroll').evaluate(el => el.clientHeight)) / 2;
  const center = await pointUnderCursor(page, centerX, centerY);
  await page.mouse.move(x, y); await page.keyboard.down('Shift'); await page.mouse.wheel(0, -100); await page.keyboard.up('Shift');
  await expect.poll(async () => (await pointUnderCursor(page, centerX, centerY)).zoom).not.toBe(center.zoom);
  const changed = await pointUnderCursor(page, centerX, centerY);
  expect(Math.abs(changed.x - center.x)).toBeLessThan(1);
  expect(Math.abs(changed.y - center.y)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Open Zoom and colors' }).click();
  await page.getByRole('button', { name: 'General Settings', exact: true }).click();
  await settings.getByRole('button', { name: 'Shortcuts & Zoom settings', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Center', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(recorder).toHaveText('Shift');
});

test('path tools expose a working stroke color and shape palettes update the actual visuals', async ({ page, request }) => {
  const types = ['line', 'arrow', 'draw', 'rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'section'];
  const elements = types.map((type, i) => ({ id: type, type, position: { x: 50 + i % 3 * 300, y: 50 + Math.floor(i / 3) * 160 }, size: { width: 190, height: 90 }, content: '', points: type === 'draw' ? [{ x: 0, y: 45 }, { x: 190, y: 45 }] : undefined, borderWidth: 3, borderColor: '#000000', color: '#ffffff', zIndex: i + 1 }));
  await open(page, request, elements);
  const bar = page.locator('[data-bottom-toolbar]');
  for (const type of types) {
    const node = page.locator(`[data-board-element-id="${type}"]`);
    await node.click();
    const strokeOnly = ['line', 'arrow', 'draw'].includes(type);
    if (strokeOnly) await expect(bar.locator('[title="Background / Fill Color"]')).toHaveCount(0);
    await bar.locator(`[title="${strokeOnly ? 'Stroke Color' : 'Border Color'}"] input[type="color"]`).fill('#d52c37');
    const svg = node.locator('line, path, polygon').first();
    if (['line', 'arrow', 'draw', 'triangle', 'diamond', 'hexagon'].includes(type)) await expect(svg).toHaveAttribute('stroke', '#d52c37');
    else await expect.poll(() => node.evaluate(el => Array.from(el.querySelectorAll('div')).some(n => getComputedStyle(n).borderTopColor === 'rgb(213, 44, 55)'))).toBe(true);
    if (!strokeOnly) {
      await bar.locator('[title="Background / Fill Color"] input[type="color"]').fill('#1978cf');
      if (['triangle', 'diamond', 'hexagon'].includes(type)) await expect(svg).toHaveAttribute('fill', '#1978cf');
      else await expect.poll(() => node.evaluate(el => Array.from(el.querySelectorAll('div')).some(n => getComputedStyle(n).backgroundColor === 'rgb(25, 120, 207)'))).toBe(true);
    }
  }
  await page.getByRole('button', { name: 'Fill Tool', exact: true }).click();
  await bar.locator('[title="Fill Color"] input[type="color"]').fill('#39a862');
  await page.getByRole('button', { name: 'Fill settings', exact: true }).click();
  await expect(page.locator('[data-toolbar-item="fill"] .toolbar-dropdown input[type="color"]')).toHaveValue('#39a862');
});
