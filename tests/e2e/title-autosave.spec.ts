import { expect, test } from '@playwright/test';

const BOARD_ID = 'title-autosave';
const ORIGINAL_TITLE = 'Autosave target';
const UPDATED_TITLE = 'Automatically saved board';

test.afterEach(async ({ request }) => {
  await request.delete(`/api/pages/${BOARD_ID}`);
});

test('board title autosaves and survives closing and reopening the editor', async ({
  context,
  page,
  request,
}) => {
  await request.delete(`/api/pages/${BOARD_ID}`);
  const updatedAt = Date.now();
  const seeded = await request.put(`/api/pages/${BOARD_ID}`, {
    data: {
      id: BOARD_ID,
      title: ORIGINAL_TITLE,
      width: 1100,
      height: 700,
      workspaceWidth: 1500,
      workspaceHeight: 1000,
      boardX: 64,
      boardY: 0,
      updatedAt,
      elements: [],
    },
  });
  expect(seeded.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${ORIGINAL_TITLE}`, exact: true }).click();

  const nameField = page.getByRole('textbox', { name: 'Board name' });
  await expect(nameField).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save title' })).toHaveCount(0);
  const fieldBounds = await nameField.boundingBox();
  expect(fieldBounds?.width).toBeGreaterThanOrEqual(240);

  const restingStyle = await nameField.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderColor };
  });
  await nameField.hover();
  const hoverStyle = await nameField.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderColor };
  });
  expect(hoverStyle).not.toEqual(restingStyle);

  await page.mouse.move(0, 0);
  await nameField.focus();
  const focusStyle = await nameField.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderColor };
  });
  expect(focusStyle).not.toEqual(restingStyle);

  const titleSave = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== 'PUT' || !response.url().endsWith(`/api/pages/${BOARD_ID}`)) return false;
    return request.postDataJSON()?.title === UPDATED_TITLE;
  });
  await nameField.fill(UPDATED_TITLE);
  await nameField.press('Tab');
  expect((await titleSave).status()).toBe(200);

  const persisted = (await (await request.get('/api/pages')).json()).find(
    (board: { id: string }) => board.id === BOARD_ID,
  );
  expect(persisted?.title).toBe(UPDATED_TITLE);

  await page.close();
  const reopenedPage = await context.newPage();
  await reopenedPage.goto('/');
  await reopenedPage.getByRole('button', { name: `Open ${UPDATED_TITLE}`, exact: true }).click();
  await expect(reopenedPage.getByRole('textbox', { name: 'Board name' })).toHaveValue(UPDATED_TITLE);
  await reopenedPage.close();
});
