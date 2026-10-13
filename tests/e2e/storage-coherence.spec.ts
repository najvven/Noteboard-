import { test, expect } from '@playwright/test';

test('stale saves and duplicate batch ids cannot replace the current persisted board', async ({ request }) => {
  const original = { id: 'revision-check', title: 'Newest', width: 800, height: 600, updatedAt: 20, elements: [] };
  await request.delete('/api/pages/revision-check');
  expect((await request.put('/api/pages/revision-check', { data: original })).ok()).toBe(true);
  expect((await request.put('/api/pages/revision-check', { data: { ...original, title: 'Old', updatedAt: 19 } })).status()).toBe(409);
  expect((await request.post('/api/pages', { data: [original, { ...original, updatedAt: 21 }] })).status()).toBe(400);
  const pages = await (await request.get('/api/pages')).json();
  expect(pages.find((p: any) => p.id === original.id).title).toBe('Newest');
  await request.delete('/api/pages/revision-check');
});

test('Home import shortcuts do not consume paste while the New Noteboard dialog is open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Noteboard', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Noteboard', exact: true });
  await expect(dialog).toBeVisible();
  const prevented = await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text', JSON.stringify({ id: 'copied-board', title: 'Unwanted import', width: 800, height: 600, elements: [] }));
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    document.querySelector('[data-new-noteboard-dialog] input')!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-board-root]')).toHaveCount(0);
});

test('two open editors cannot silently overwrite each other', async ({ page, context, request }) => {
  const id = 'two-editors';
  await request.delete(`/api/pages/${id}`);
  await request.put(`/api/pages/${id}`, { data: {
    id, title: 'Concurrent board', width: 1100, height: 700, workspaceWidth: 1500, workspaceHeight: 1000,
    boardX: 64, boardY: 0, viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(),
    editorSettings: { activeTool: 'text', keepToolActive: true },
    elements: [{ id: 'shared-text', type: 'text', position: { x: 100, y: 90 }, size: { width: 450, height: 110 }, content: 'Original', zIndex: 1 }],
  } });
  const second = await context.newPage();
  for (const tab of [page, second]) {
    await tab.goto('/'); await tab.getByRole('button', { name: 'Open Concurrent board', exact: true }).click();
    await expect(tab.locator('[data-board-element-editor-id="shared-text"]')).toHaveText('Original');
    if (tab === page) await expect.poll(async () => {
      const stored = (await (await request.get('/api/pages')).json()).find((p: any) => p.id === id);
      return stored?.editorSettings?.previewMode;
    }).toBe('box');
  }
  // Opening an editor also persists its viewport/preferences. The last opened
  // editor writes first; match the actual text edit rather than an earlier save.
  const writer = second, conflicted = page;
  const firstSave = writer.waitForResponse(response => response.url().endsWith(`/api/pages/${id}`) && response.request().method() === 'PUT' && response.request().postDataJSON().elements[0].content.includes('First editor saved'));
  await writer.locator('[data-board-element-editor-id="shared-text"]').fill('First editor saved');
  expect((await firstSave).status()).toBe(200);
  const conflict = conflicted.waitForResponse(response => response.url().endsWith(`/api/pages/${id}`) && response.request().method() === 'PUT' && response.request().postDataJSON().elements[0].content.includes('Second stale edit'));
  await conflicted.locator('[data-board-element-editor-id="shared-text"]').fill('Second stale edit');
  expect((await conflict).status()).toBe(409);
  await expect(conflicted.getByRole('alert')).toContainText('Another editor saved a newer version');
  const newerConflict = conflicted.waitForResponse(response => response.url().endsWith(`/api/pages/${id}`) && response.request().method() === 'PUT' && response.request().postDataJSON().elements[0].content.includes('Latest local draft after conflict'));
  await conflicted.locator('[data-board-element-editor-id="shared-text"]').fill('Latest local draft after conflict');
  const rejected = await newerConflict;
  expect(rejected.status()).toBe(409);
  expect(rejected.request().postDataJSON().elements[0].content).toContain('Latest local draft after conflict');
  const stored = (await (await request.get('/api/pages')).json()).find((p: any) => p.id === id);
  expect(stored.elements[0].content).toContain('First editor saved');
  await conflicted.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = conflicted.getByRole('dialog', { name: 'Save as', exact: true });
  await dialog.getByLabel('Save as name').fill('Conflict copy');
  await dialog.getByRole('button', { name: 'Save as New Board', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('New board saved');
  const copy = (await (await request.get('/api/pages')).json()).find((p: any) => p.title === 'Conflict copy');
  expect(copy.elements[0].content).toContain('Latest local draft after conflict');
  await dialog.getByRole('button', { name: 'Close save dialog', exact: true }).click();
  conflicted.once('dialog', dialog => dialog.dismiss());
  await conflicted.getByRole('button', { name: 'Reload saved version', exact: true }).click();
  await expect(conflicted.locator('[data-board-element-editor-id="shared-text"]')).toContainText('Latest local draft after conflict');
  conflicted.once('dialog', dialog => dialog.accept());
  await conflicted.getByRole('button', { name: 'Reload saved version', exact: true }).click();
  await conflicted.getByRole('button', { name: 'Open Concurrent board', exact: true }).click();
  await expect(conflicted.locator('[data-board-element-editor-id="shared-text"]')).toContainText('First editor saved');
  await expect(conflicted.getByRole('alert')).toHaveCount(0);
  await second.close();
});

test('a failed first create keeps its settings and can be retried into a normally saving editor', async ({ page, request }) => {
  let fail = true;
  await page.route('**/api/pages/page-*', route => {
    if (fail && route.request().method() === 'PUT') {
      fail = false; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Temporary storage failure"}' });
    }
    return route.continue();
  });
  await page.goto('/'); await page.getByRole('button', { name: 'New Noteboard', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Noteboard', exact: true });
  await dialog.locator('#new-noteboard-name').fill('Retried creation');
  await dialog.getByRole('button', { name: 'Create Noteboard', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not create');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create Noteboard', exact: true }).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Retried creation', exact: true })).toBeVisible();
  const stored = (await (await request.get('/api/pages')).json()).find((p: any) => p.title === 'Retried creation');
  expect(stored).toBeTruthy();
});

test('a failed first import keeps Home usable and retries the original file', async ({ page }) => {
  let fail = true;
  await page.route('**/api/pages/page-*', route => {
    if (fail && route.request().method() === 'PUT') {
      fail = false; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Temporary storage failure"}' });
    }
    return route.continue();
  });
  const file = { name: 'Retry.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    id: 'import-original', title: 'Retried import', width: 800, height: 600, updatedAt: 1, elements: [],
  })) };
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(file);
  await expect(page.getByRole('alert')).toContainText('Could not import');
  await expect(page.locator('[data-board-root]')).toHaveCount(0);
  await input.setInputFiles(file);
  await expect(page.locator('[data-board-root]')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Retried import', exact: true })).toBeVisible();
});

test('a lost acknowledgment and immediate reload keep the latest draft without a self-conflict', async ({ page, request }) => {
  const id = 'uncertain-save';
  await request.delete(`/api/pages/${id}`);
  await request.put(`/api/pages/${id}`, { data: {
    id, title: 'Uncertain save', width: 1100, height: 700, workspaceWidth: 1500, workspaceHeight: 1000,
    boardX: 64, boardY: 0, viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(),
    editorSettings: { activeTool: 'text', keepToolActive: true },
    elements: [{ id: 'draft', type: 'text', position: { x: 100, y: 90 }, size: { width: 450, height: 110 }, content: 'Original', zIndex: 1 }],
  } });
  await page.goto('/'); await page.getByRole('button', { name: 'Open Uncertain save', exact: true }).click();
  let loseAcknowledgment = true;
  await page.route(`**/api/pages/${id}`, async route => {
    if (loseAcknowledgment && route.request().method() === 'PUT') {
      loseAcknowledgment = false;
      const saved = await route.fetch(); expect(saved.ok()).toBe(true);
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  const editor = page.locator('[data-board-element-editor-id="draft"]');
  await editor.fill('Committed without acknowledgment');
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await editor.fill('Newer edit after failed acknowledgment');
  await expect.poll(async () => {
    const board = (await (await request.get('/api/pages')).json()).find((p: any) => p.id === id);
    return board.elements[0].content;
  }).toContain('Newer edit after failed acknowledgment');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await editor.fill('Latest draft before immediate reload');
  await page.reload();
  await page.getByRole('button', { name: 'Open Uncertain save', exact: true }).click();
  await expect(editor).toContainText('Latest draft before immediate reload');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a recovery-only unload does not falsely advance the saved base when the page stays open', async ({ page, request }) => {
  const id = 'canceled-large-unload';
  await request.delete(`/api/pages/${id}`);
  await request.put(`/api/pages/${id}`, { data: {
    id, title: 'Large unload', width: 1100, height: 700, workspaceWidth: 1500, workspaceHeight: 1000,
    boardX: 64, boardY: 0, viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(),
    editorSettings: { activeTool: 'text', keepToolActive: true },
    elements: [{ id: 'large-text', type: 'text', position: { x: 100, y: 90 }, size: { width: 450, height: 110 }, content: 'Original', zIndex: 1 }],
  } });
  await page.goto('/'); await page.getByRole('button', { name: 'Open Large unload', exact: true }).click();
  const editor = page.locator('[data-board-element-editor-id="large-text"]');
  await editor.fill('Large pending draft ' + 'x'.repeat(70_000));
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('noteboard:page-recovery:canceled-large-unload:')))).toBe(true);
  await editor.fill('Normal editing after staying open');
  await expect.poll(async () => {
    const board = (await (await request.get('/api/pages')).json()).find((p: any) => p.id === id);
    return board.elements[0].content;
  }).toContain('Normal editing after staying open');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a save in another tab retains a large recovery and exposes its conflicting draft as a separate board', async ({ page, context, request }) => {
  const id = 'owner-isolation';
  await request.delete(`/api/pages/${id}`);
  expect((await request.put(`/api/pages/${id}`, { data: {
    id, title: 'Owner isolation', width: 1100, height: 700, workspaceWidth: 1500, workspaceHeight: 1000,
    boardX: 64, boardY: 0, viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(),
    editorSettings: { activeTool: 'text', keepToolActive: true },
    elements: [{ id: 'isolated-text', type: 'text', position: { x: 100, y: 90 }, size: { width: 450, height: 110 }, content: 'Original', zIndex: 1 }],
  } })).ok()).toBe(true);
  const other = await context.newPage();
  for (const tab of [other, page]) {
    await tab.goto('/');
    await tab.getByRole('button', { name: 'Open Owner isolation', exact: true }).click();
    await expect(tab.locator('[data-board-element-editor-id="isolated-text"]')).toHaveText('Original');
    if (tab === other) await expect.poll(async () => {
      const board = (await (await request.get('/api/pages')).json()).find((value: any) => value.id === id);
      return board.editorSettings?.previewMode;
    }).toBe('box');
  }
  await other.route(`**/api/pages/${id}`, route => route.request().method() === 'PUT' ? route.abort('connectionreset') : route.continue());
  const rawDraft = 'Other tab unsaved draft ' + 'x'.repeat(70_000);
  await other.locator('[data-board-element-editor-id="isolated-text"]').fill(rawDraft);
  await other.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  const recoveryKeys = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('noteboard:page-recovery:owner-isolation:')));
  await expect.poll(recoveryKeys).toHaveLength(1);
  const [recoveryKey] = await recoveryKeys();
  const originalRaw = await page.evaluate(key => localStorage.getItem(key), recoveryKey);
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/pages/${id}`) && response.request().method() === 'PUT' && response.request().postDataJSON().elements[0].content.includes('Writer saved version'));
  await page.locator('[data-board-element-editor-id="isolated-text"]').fill('Writer saved version');
  expect((await saved).status()).toBe(200);
  expect(await page.evaluate(key => localStorage.getItem(key), recoveryKey)).toBe(originalRaw);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Open Recovered — Owner isolation', exact: true })).toBeVisible();
  const boards = await (await request.get('/api/pages')).json();
  expect(boards.find((value: any) => value.id === id).elements[0].content).toContain('Writer saved version');
  const recovered = boards.find((value: any) => value.recoveryOrigin?.boardId === id);
  expect(recovered.elements[0].content).toContain(rawDraft);
  expect(recovered.elements[0].id).not.toBe('isolated-text');
  expect(await page.evaluate(key => localStorage.getItem(key), recoveryKey)).toBeNull();
  await page.getByRole('button', { name: 'Open Recovered — Owner isolation', exact: true }).click();
  await expect(page.locator(`[data-board-element-editor-id="${recovered.elements[0].id}"]`)).toContainText('Other tab unsaved draft');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await other.close();
});
