import { deleteFixtureBoard } from './fixture-storage';
import { test, expect, type Page, type APIRequestContext } from './test';

async function openFixture(page: Page, request: APIRequestContext, elements: unknown[]) {
  for (const item of await (await request.get('/api/pages')).json()) await deleteFixtureBoard(request, `/api/pages/${item.id}`);
  await request.post('/api/pages', { data: [{ id: 'consistency', title: 'Consistency checks', version: 3, width: 1100, height: 650, workspaceWidth: 1500, workspaceHeight: 1000, boardX: 64, boardY: 0, viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(), isPinned: false, elements, editorSettings: { activeTool: 'text', keepToolActive: true, enableObjectSnapping: false } }] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Consistency checks', exact: true }).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
}

test('white and custom text colors preserve the caret, selection and immediate typing', async ({ page, request }) => {
  await openFixture(page, request, [{ id: 'text', type: 'text', position: { x: 100, y: 90 }, size: { width: 450, height: 110 }, content: 'Alpha <b>bravo</b> Charlie', textColor: '#000000', zIndex: 1 }]);
  const editor = page.locator('[data-board-element-editor-id="text"]');
  const selectWord = async () => {
    await editor.click(); await page.keyboard.press('Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  };
  await selectWord();
  const palette = page.locator('[data-bottom-toolbar] [title="Text Color"]');
  await palette.locator('button').first().click();
  await expect(editor).toBeFocused();
  await expect(editor.locator('b span')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(editor.locator('b span')).toHaveCSS('caret-color', 'rgb(37, 99, 235)');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('bravo');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('!');
  await expect(editor).toHaveText('Alpha bravo! Charlie');
  await expect(editor.locator('b')).toHaveText('bravo!');

  await selectWord();
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  const picker = palette.locator('input[type="color"]');
  await picker.focus();
  await picker.fill('#c026d3');
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('?');
  await expect(editor).toContainText('bravo?');
  await editor.press('End');
  await palette.locator('button').first().click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS('caret-color', 'rgb(37, 99, 235)');
  await page.keyboard.type(' end');
  await expect(editor).toContainText('Charlie end');

  const content = await editor.innerText();
  const duplicate = page.locator('[data-bottom-toolbar]').getByRole('button', { name: 'Duplicate', exact: true });
  await duplicate.click();
  await expect(page.locator('[data-board-element-type="text"]')).toHaveCount(2);
  await expect(duplicate).toHaveAttribute('data-duplicate-feedback', 'true');
  await expect(page.locator('[data-board-element-editor-id]').last()).toHaveText(content);
  await expect(duplicate).not.toHaveAttribute('data-duplicate-feedback', 'true', { timeout: 2500 });
});

test('a stalled browser embed offers recovery and becomes usable if its response arrives late', async ({ page, request }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://www.youtube-nocookie.com/embed/**', async route => {
    await pending;
    await route.fulfill({ contentType: 'text/html', body: '<h1>Recovered embedded player</h1>' });
  });
  await openFixture(page, request, [{ id: 'web', type: 'embed', position: { x: 100, y: 90 }, size: { width: 600, height: 350 }, content: 'https://youtu.be/M7lc1UVf-VE', zIndex: 1 }]);
  const field = page.locator('[data-board-element-id="web"]');
  await expect(field.getByRole('status')).toContainText('Loading page');
  try {
    await expect(field.getByRole('alert')).toContainText('did not load', { timeout: 20000 });
    await expect(field.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(field.getByRole('link', { name: 'Open in browser', exact: true })).toHaveAttribute('href', 'https://youtu.be/M7lc1UVf-VE');
    release!();
    await expect(field.frameLocator('iframe').getByRole('heading')).toHaveText('Recovered embedded player');
    await expect(field.getByRole('alert')).toHaveCount(0);
    await expect(field.getByRole('status')).toHaveCount(0);
  } finally { release!(); }
});
