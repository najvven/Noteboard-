import {
  expect,
  test,
  type APIRequestContext,
  type Page as BrowserPage,
} from "@playwright/test";

const OTHER_BOARD_TITLE = "Unrelated Planning Board";

const clearIsolatedBoards = async (request: APIRequestContext) => {
  const response = await request.get("/api/pages");
  expect(response.ok()).toBeTruthy();
  const pages = (await response.json()) as Array<{ id: string }>;
  for (const page of pages) {
    const deleted = await request.delete(`/api/pages/${page.id}`);
    expect(deleted.ok()).toBeTruthy();
  }
};

const seedUnrelatedBoard = async (request: APIRequestContext) => {
  const timestamp = Date.now();
  const response = await request.post("/api/pages", {
    data: [
      {
        id: "e2e-unrelated-board",
        title: OTHER_BOARD_TITLE,
        version: 3,
        width: 1280,
        height: 720,
        elements: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });
  expect(response.ok()).toBeTruthy();
};

const dragOnBoard = async (
  page: BrowserPage,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const board = page.locator('[data-board-root="true"]');
  const bounds = await board.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + from.x, bounds!.y + from.y);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.move(bounds!.x + to.x, bounds!.y + to.y, { steps: 12 });
  await page.mouse.up();
};

const startMovingToolsToMore = async (page: BrowserPage) => {
  await page.getByRole("button", { name: "General Settings", exact: true }).click();
  await page.locator('[data-toolbar-editor-toggle="true"]').click();
  await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeVisible();
};
const moveToolbarToolIntoMore = async (page: BrowserPage, itemId: string) => {
  const item = page.locator(`[data-toolbar-item="${itemId}"]`);
  await item.dragTo(page.locator('[data-toolbar-item="more"]'));
  await expect(item).toBeHidden();
};
const returnToolFromMore = async (page: BrowserPage, id: string, label: string, cancel = false) => {
  const row = page.locator(`[data-more-toolbar-item="${id}"]`);
  if (!(await row.isVisible())) await page.getByRole('button', { name: 'More', exact: true }).click();
  const box = (await row.getByRole('button', { name: `Move ${label} to toolbar` }).boundingBox())!;
  const toolbar = (await page.locator('[data-toolbar-surface="true"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 30, box.y + 16, { steps: 5 });
  await page.mouse.move(cancel ? 20 : toolbar.x + 50, cancel ? 600 : toolbar.y + toolbar.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0);
};

const createSectionOnBoard = async (
  page: BrowserPage,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  await page.getByRole("button", { name: "Choose shape" }).click();
  await page.getByRole("button", { name: "Section", exact: true }).click();
  await dragOnBoard(page, from, to);
};

test.beforeEach(async ({ request }) => clearIsolatedBoards(request));
test.afterEach(async ({ request }) => clearIsolatedBoards(request));

test("keeps ordinary Sections available without spreadsheet editor controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Ordinary Sections");
  await page.getByRole("button", { name: "Create Noteboard" }).click();

  await createSectionOnBoard(page, { x: 120, y: 100 }, { x: 360, y: 220 });
  await expect(
    page.locator('.content-editable-text[contenteditable="true"]'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Make spreadsheet" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Section Spreadsheet" }),
  ).toHaveCount(0);
});

test("renames a board from the keyboard-accessible card control", async ({
  page,
  request,
}) => {
  await seedUnrelatedBoard(request);
  await page.goto("/");

  const boardCard = page.getByRole("article", { name: OTHER_BOARD_TITLE });
  const renameButton = boardCard.getByRole("button", {
    name: `Rename ${OTHER_BOARD_TITLE}`,
  });

  await expect(renameButton).toHaveAttribute("type", "button");
  await renameButton.focus();
  await expect(renameButton).toBeFocused();
  await page.keyboard.press("Space");

  const renameInput = boardCard.getByRole("textbox");
  await expect(renameInput).toBeFocused();
  await renameInput.fill("Keyboard Renamed Board");
  await renameInput.press("Enter");

  await expect(
    page.getByRole("article", { name: "Keyboard Renamed Board" }),
  ).toBeVisible();
});

test("centers Main Settings and uses one Size pixel tooltip", async ({
  page,
}) => {
  await page.goto("/");
  const settingsButton = page.locator('[data-main-settings-button="true"]');
  const search = page.getByLabel("Search noteboards");
  const settingsBox = await settingsButton.boundingBox();
  const searchBox = await search.boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(settingsBox!.width).toBe(250);
  expect(settingsBox!.height).toBe(40);
  expect(settingsBox!.x).toBeLessThan(searchBox!.x);
  expect(Math.abs(settingsBox!.y - searchBox!.y)).toBeLessThan(0.5);

  await settingsButton.click();
  const settingsDialog = page.locator('[data-settings-dialog="true"]');
  await expect(settingsDialog).toBeVisible();
  const dialogBox = await settingsDialog.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(dialogBox!.width).toBe(1024);
  expect(dialogBox!.height).toBe(Math.min(680, viewport!.height * 0.9));
  expect(
    Math.abs(dialogBox!.x - (viewport!.width - dialogBox!.width) / 2),
  ).toBeLessThan(1);
  expect(
    Math.abs(dialogBox!.y - (viewport!.height - dialogBox!.height) / 2),
  ).toBeLessThan(1);
  await expect(settingsDialog.getByText("Visual", { exact: true })).toHaveCount(2);
  await expect(settingsDialog.locator("#global-brightness")).toBeVisible();
  await expect(
    settingsDialog.locator("nav h3 svg, nav button svg, #visual-settings-title svg"),
  ).toHaveCount(0);
  await settingsDialog
    .getByRole("button", { name: "Close settings dialog" })
    .click();

  await page.getByRole("button", { name: "New Noteboard" }).click();
  const createDialog = page.locator('[data-new-noteboard-dialog="true"]');
  const before = await createDialog.boundingBox();
  const sizeToggle = page.locator('[data-size-toggle="true"]');
  const sizeRow = sizeToggle.locator("..");
  await expect(sizeRow.locator("svg.lucide-info")).toHaveCount(1);
  await expect(
    page.locator('#new-noteboard-size-fields svg.lucide-info'),
  ).toHaveCount(0);
  const sizeInfo = sizeRow.locator(
    '[aria-label="Board/workspace dimensions use pixels"]',
  );
  await sizeInfo.hover();
  const tooltip = sizeRow.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const panel = page.locator('[data-new-noteboard-settings-panel="true"]');
  await expect
    .poll(() =>
      panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  const tooltipBox = await tooltip.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(tooltipBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(
    panelBox!.x + panelBox!.width,
  );
  await expect
    .poll(() => tooltip.evaluate((element) => getComputedStyle(element).zIndex))
    .toBe("200");
  await sizeToggle.click();
  const after = await createDialog.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.height).toBe(before!.height);

  await page.setViewportSize({ width: 520, height: 720 });
  await sizeInfo.hover();
  await expect(tooltip).toBeVisible();
  await expect
    .poll(() =>
      panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("keeps the primary toolbar usable at compact desktop widths", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Responsive Toolbar");
  await page.getByRole("button", { name: "Create Noteboard" }).click();

  for (const width of [1000, 800]) {
    await page.setViewportSize({ width, height: 720 });
    const essentialButtons = [
      page.getByTitle("Back"),
      page.getByRole("button", { name: "More", exact: true }),
      page.getByRole("button", { name: "Open Layers Panel", exact: true }),
      page.getByRole("button", { name: "Save", exact: true }),
    ];
    for (const button of essentialButtons) {
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await expect
      .poll(() =>
        page
          .locator("header")
          .evaluate((header) => header.scrollWidth <= header.clientWidth),
      )
      .toBe(true);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Section Spreadsheet" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "More", exact: true }).click();
  }
});

test("keeps General Settings fixed and preserves workflow pins", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Settings Placement");
  await page.getByRole("button", { name: "Create Noteboard" }).click();

  await page.locator('[data-toolbar-item="generalSettings"] > button').click();
  const generalMenu = page.locator(
    '[data-toolbar-item="generalSettings"] > .toolbar-dropdown',
  );
  const generalRows = generalMenu.locator("[data-general-settings-section]");
  await expect(generalRows.nth(0)).toHaveAttribute(
    "data-general-settings-section",
    "toolbarCustomization",
  );
  await expect(generalRows).toHaveCount(5);
  await expect(
    generalMenu.getByText("Manage Settings", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-settings-more-drop-target="true"]'),
  ).toHaveCount(0);

  const toolbarEditorSection = generalMenu.locator(
    '[data-general-settings-section="toolbarCustomization"]',
  );
  const toolbarEditorToggle = generalMenu.locator(
    '[data-toolbar-editor-toggle="true"]',
  );
  await expect(toolbarEditorSection).toBeVisible();
  await expect(toolbarEditorToggle).toHaveText("Edit");
  await toolbarEditorToggle.click();
  await expect(generalMenu).toBeHidden();
  const finishToolbarEditing = page.getByRole("button", {
    name: "Finish",
  });
  await expect(finishToolbarEditing).toBeVisible();

  // Editing owns the toolbar surface: ordinary tool and settings menus cannot
  // be opened until the edit session is finished.
  await page.locator('[data-toolbar-item="generalSettings"] > button').click();
  await expect(generalMenu).toBeHidden();
  await page.getByRole("button", { name: "Open media settings" }).click();
  await expect(
    page.locator('[data-toolbar-item="media"] > .toolbar-dropdown'),
  ).toBeHidden();
  await page.getByRole("button", { name: "Open Layers Panel" }).click();
  await expect(
    page.locator('[data-toolbar-item="layers"] > .toolbar-dropdown'),
  ).toBeHidden();
  await page.getByRole("button", { name: "More", exact: true }).click();
  const editMoreMenu = page.locator(
    '[data-toolbar-item="more"] > .toolbar-dropdown',
  );
  await expect(editMoreMenu).toBeHidden();
  await finishToolbarEditing.click();

  await page.locator('[data-toolbar-item="generalSettings"] > button').click();
  await expect(generalMenu).toBeVisible();

  for (const sectionId of [
    "grid",
    "toolDefaults",
    "behaviorSettings",
    "shortcutSettings",
  ]) {
    const section = generalMenu.locator(
      `[data-general-settings-section="${sectionId}"]`,
    );
    await expect(section).toBeVisible();
    await expect(section).not.toHaveAttribute("draggable");
    await expect(section).not.toHaveAttribute("data-settings-manage-active");
  }
  await expect(
    generalMenu.locator('[data-general-settings-section="presetSettings"]'),
  ).toHaveCount(0);

  await page.locator('[data-toolbar-item="generalSettings"] > button').click();
  await page.locator('[data-toolbar-item="more"] > button').click();

  const moreMenu = page.locator(
    '[data-toolbar-item="more"] > .toolbar-dropdown',
  );
  await expect(moreMenu.locator("[data-more-toolbar-item]")).toHaveCount(4);
  for (const id of ["embed", "board", "link", "object-presets"]) {
    await expect(
      moreMenu.locator(`[data-more-toolbar-item="${id}"]`),
    ).toBeVisible();
  }
  await expect(
    moreMenu.locator('[data-menu-always-on-top="more"]'),
  ).toHaveAttribute("aria-pressed", "false");

  const webRow = moreMenu.locator('[data-more-tool="embed"]');
  await webRow.getByRole("button", { name: "Web settings" }).click();
  await expect(webRow.getByText("Device mode")).toBeVisible();
  await expect(webRow.getByRole('button', { name: 'Block popups', exact: true })).toBeEnabled();
  await expect(webRow.getByText("Remember session")).toHaveCount(0);
  await expect(webRow.getByRole('button', { name: /^Ad blocker/ })).toBeDisabled();
  await expect(webRow.getByRole('group', { name: 'Cookie blocker' }).getByRole('button', { name: 'All', exact: true })).toBeDisabled();
  await page.mouse.click(20, 300);
  await expect(moreMenu).toBeHidden();

  await page.locator('[data-toolbar-item="more"] > button').click();
  const linkRow = moreMenu.locator('[data-more-tool="link"]');
  await linkRow
    .getByRole("button", { name: "Object Links settings" })
    .click();
  await expect(
    linkRow.locator('[data-menu-always-on-top="link"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(20, 300);
  await expect(moreMenu).toBeVisible();

  const presetRow = moreMenu.locator('[data-more-tool="object-presets"]');
  await presetRow
    .getByRole("button", { name: "Object Presets settings" })
    .click();
  await expect(
    presetRow.locator('[data-menu-always-on-top="object-presets"]'),
  ).toHaveAttribute("aria-pressed", "true");

  const linkPin = moreMenu.locator('[data-menu-always-on-top="link"]');
  await linkPin.click();
  await expect(linkPin).toHaveAttribute("aria-pressed", "false");
  const presetPin = moreMenu.locator(
    '[data-menu-always-on-top="object-presets"]',
  );
  await presetPin.click();
  await expect(presetPin).toHaveAttribute("aria-pressed", "false");

  await page.mouse.click(20, 300);
  await expect(moreMenu).toBeHidden();

  await page.getByRole("button", { name: "Open media settings" }).click();
  const mediaMenu = page.locator(
    '[data-toolbar-item="media"] > .toolbar-dropdown',
  );
  const compactFooter = mediaMenu.locator(
    '.menu-settings-block[data-compact="true"]',
  );
  await expect(compactFooter).toBeVisible();
  const titleBox = await mediaMenu.getByText("Media Settings").boundingBox();
  const footerButton = compactFooter.getByRole("button", {
    name: "Tool settings",
  });
  const footerBox = await footerButton.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y - (titleBox!.y + titleBox!.height)).toBeLessThanOrEqual(24);
  await footerButton.click();
  const toggle = compactFooter.locator('[data-menu-toggle="true"]').first();
  await expect(toggle).toBeVisible();
  await expect
    .poll(() => toggle.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe("none");
});

test("keeps tool settings footers aligned without horizontal scrolling", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Tool Footer Geometry");
  await page.getByRole("button", { name: "Create Noteboard" }).click();

  const toolMenus = [
    { id: "select", button: "Select settings", title: "Select Settings" },
    { id: "text", button: "Open text settings", title: "Text Settings" },
    { id: "media", button: "Open media settings", title: "Media Settings" },
    { id: "eraser", button: "Open eraser settings", title: "Eraser Settings" },
  ] as const;
  const headerHeights: number[] = [];

  for (const tool of toolMenus) {
    await page.getByRole("button", { name: tool.button }).click();
    const menu = page.locator(
      `[data-toolbar-item="${tool.id}"] > .toolbar-dropdown`,
    );
    await expect(menu.getByText(tool.title, { exact: true })).toBeVisible();
    const footer = menu.locator(".menu-settings-block");
    const header = footer.locator(".menu-settings-header");
    const headerBox = await header.boundingBox();
    const captionBox = await footer
      .locator('[data-menu-settings-caption="true"]')
      .boundingBox();
    const footerBox = await footer.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(captionBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    headerHeights.push(headerBox!.height);
    await expect
      .poll(() => header.evaluate((element) => getComputedStyle(element).height))
      .toBe("24px");

    if (tool.id === "text") {
      await expect(menu.locator('[class*="border-t-[3px]"]')).toHaveCount(0);
    }

    if (tool.id !== "media") {
      const captionCenter = captionBox!.y + captionBox!.height / 2;
      const above = captionCenter - footerBox!.y;
      const below = menuBox!.y + menuBox!.height - captionCenter;
      expect(Math.abs(above - below)).toBeLessThanOrEqual(4);
    }

    await header.click();
    const scrollSurface = footer.locator(".menu-settings-content");
    const initialMetrics = await scrollSurface.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    expect(initialMetrics.overflowX).toBe("hidden");
    expect(initialMetrics.scrollWidth).toBeLessThanOrEqual(
      initialMetrics.clientWidth,
    );
    await expect
      .poll(() => menu.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);

    await page.getByRole("button", { name: tool.button }).click();
  }

  expect(Math.max(...headerHeights) - Math.min(...headerHeights)).toBeLessThan(
    0.5,
  );
  expect(headerHeights[0]).toBeGreaterThan(23);
  expect(headerHeights[0]).toBeLessThan(25);

  await page.getByRole("button", { name: "Open Layers Panel" }).click();
  const layersMenu = page.locator(
    '[data-toolbar-item="layers"] > .toolbar-dropdown',
  );
  const layersBox = await layersMenu.boundingBox();
  expect(layersBox).not.toBeNull();
  expect(layersBox!.width).toBeGreaterThanOrEqual(220);
  expect(layersBox!.width).toBeLessThanOrEqual(228);
  const layersFooter = layersMenu.locator(".menu-settings-block");
  await layersFooter.getByRole("button", { name: "Tool settings" }).click();
  await expect
    .poll(() =>
      layersMenu.evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);

  for (const width of [800, 600]) {
    await page.setViewportSize({ width, height: 720 });
    await expect
      .poll(async () => {
        const box = await layersMenu.boundingBox();
        return Boolean(
          box &&
            box.width >= 220 &&
            box.width <= 228 &&
            box.x >= 7 &&
            box.x + box.width <= width - 7,
        );
      })
      .toBe(true);
    const compactBox = await layersMenu.boundingBox();
    expect(compactBox).not.toBeNull();
    expect(compactBox!.width).toBeGreaterThanOrEqual(220);
    expect(compactBox!.width).toBeLessThanOrEqual(228);
    expect(compactBox!.x).toBeGreaterThanOrEqual(7);
    expect(compactBox!.x + compactBox!.width).toBeLessThanOrEqual(width - 7);
  }

  await page.getByRole("button", { name: "Open Layers Panel" }).click();
  await page.getByRole("button", { name: "Select settings" }).click();
  const selectMenu = page.locator(
    '[data-toolbar-item="select"] > .toolbar-dropdown',
  );
  const switchBoxes = await Promise.all(
    ["lock-time", "spin-snap"].map((id) =>
      selectMenu
        .locator(`[data-select-setting-toggle="${id}"] [data-menu-toggle="true"]`)
        .boundingBox(),
    ),
  );
  const ratioSwitchBox = await selectMenu
    .getByText("Ratio Scaling", { exact: true })
    .locator("..")
    .locator('[data-menu-toggle="true"]')
    .boundingBox();
  expect(ratioSwitchBox).not.toBeNull();
  for (const box of switchBoxes) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - ratioSwitchBox!.width)).toBeLessThan(0.5);
    expect(Math.abs(box!.height - ratioSwitchBox!.height)).toBeLessThan(0.5);
    expect(
      Math.abs(
        box!.x + box!.width - (ratioSwitchBox!.x + ratioSwitchBox!.width),
      ),
    ).toBeLessThan(0.5);
  }
});

test("keeps Select gestures owned and stable toward the upper-left", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Select Pointer Ownership");
  await page.getByRole("button", { name: "Create Noteboard" }).click();
  await page.getByTitle("Select Tool").click();
  await page.getByRole("button", { name: "Select settings" }).click();
  const selectSettings = page.locator(
    '[data-toolbar-item="select"] > .toolbar-dropdown',
  );
  await selectSettings.locator('input[type="number"]').first().fill("800");
  await page.getByRole("button", { name: "Select settings" }).click();

  const board = page.locator('[data-board-root="true"]');
  const bounds = await board.boundingBox();
  expect(bounds).not.toBeNull();
  const start = { x: bounds!.x + 430, y: bounds!.y + 300 };
  const activeRegion = page.locator('[data-selection-region="active"]');

  // Restore the pre-change Lock Time contract: a locked marquee remains
  // inactive until the full delay and cannot commit early.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(activeRegion).toBeHidden();
  await page.mouse.move(start.x - 80, start.y - 60, { steps: 2 });
  await expect(activeRegion).toBeHidden();
  await page.mouse.up();
  await expect(activeRegion).toBeHidden();
  await expect(
    page.locator('[data-selection-region="committed"]'),
  ).toHaveCount(0);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(activeRegion).toBeHidden();
  await page.waitForTimeout(300);
  await page.mouse.move(start.x - 30, start.y - 20, { steps: 2 });
  await expect(activeRegion).toBeHidden();
  await page.waitForTimeout(550);
  await expect(activeRegion).toBeVisible();
  const armedOrigin = await activeRegion.boundingBox();
  expect(armedOrigin).not.toBeNull();
  expect(armedOrigin!.width).toBeGreaterThan(20);
  expect(armedOrigin!.width).toBeLessThan(60);
  expect(Math.abs(armedOrigin!.width - armedOrigin!.height)).toBeLessThan(1);
  expect(Math.abs(armedOrigin!.x - (start.x - 30))).toBeLessThan(2);
  expect(Math.abs(armedOrigin!.y - (start.y - 20))).toBeLessThan(2);
  await page.mouse.move(start.x - 3, start.y - 3);

  await expect(activeRegion).toBeVisible();
  const tinyRegion = await activeRegion.boundingBox();
  expect(tinyRegion).not.toBeNull();
  expect(tinyRegion!.width).toBeGreaterThan(20);
  expect(tinyRegion!.width).toBeLessThan(60);
  expect(tinyRegion!.height).toBeGreaterThan(20);
  expect(tinyRegion!.height).toBeLessThan(60);

  await board.evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 77,
        clientX: 1,
        clientY: 1,
      }),
    );
  });
  await expect(activeRegion).toBeVisible();

  await page.mouse.move(start.x - 220, start.y - 160, { steps: 10 });
  const upperLeftRegion = await activeRegion.boundingBox();
  expect(upperLeftRegion).not.toBeNull();
  expect(upperLeftRegion!.width).toBeGreaterThan(175);
  expect(upperLeftRegion!.height).toBeGreaterThan(125);
  expect(upperLeftRegion!.x).toBeLessThan(start.x - 190);
  expect(upperLeftRegion!.y).toBeLessThan(start.y - 130);
  await page.mouse.up();

  const committedRegion = page.locator(
    '[data-selection-region="committed"]',
  );
  await expect(committedRegion).toBeVisible();
  const committedBox = await committedRegion.boundingBox();
  expect(committedBox).not.toBeNull();
  expect(Math.abs(committedBox!.width - upperLeftRegion!.width)).toBeLessThan(2);
  expect(Math.abs(committedBox!.height - upperLeftRegion!.height)).toBeLessThan(2);

  await page.getByRole("button", { name: "Select settings" }).click();
  await selectSettings
    .locator('[data-select-setting-toggle="lock-time"]')
    .click();
  await page.getByRole("button", { name: "Select settings" }).click();

  // A fast second gesture must not depend on a React render completing between
  // pointerdown, pointermove and pointerup.
  await page.mouse.move(bounds!.x + 180, bounds!.y + 130);
  await page.mouse.down();
  await expect(activeRegion).toBeVisible();
  const initialUnlockedRegion = await activeRegion.boundingBox();
  expect(initialUnlockedRegion).not.toBeNull();
  expect(initialUnlockedRegion!.width).toBeGreaterThan(20);
  expect(initialUnlockedRegion!.width).toBeLessThan(60);
  expect(
    Math.abs(initialUnlockedRegion!.width - initialUnlockedRegion!.height),
  ).toBeLessThan(1);
  await page.mouse.move(bounds!.x + 390, bounds!.y + 330, { steps: 2 });
  await page.mouse.up();
  await expect(committedRegion).toBeVisible();
  const fastBox = await committedRegion.boundingBox();
  expect(fastBox).not.toBeNull();
  expect(fastBox!.width).toBeGreaterThan(190);
  expect(fastBox!.height).toBeGreaterThan(180);

  for (const [from, to] of [
    [{ x: 650, y: 140 }, { x: 500, y: 310 }],
    [{ x: 240, y: 340 }, { x: 410, y: 170 }],
  ] as const) {
    await page.mouse.move(bounds!.x + from.x, bounds!.y + from.y);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + to.x, bounds!.y + to.y, { steps: 4 });
    await page.mouse.up();
    const directionalBox = await committedRegion.boundingBox();
    expect(directionalBox).not.toBeNull();
    expect(directionalBox!.width).toBeGreaterThan(140);
    expect(directionalBox!.height).toBeGreaterThan(140);
  }

  await page.getByRole("button", { name: "Choose shape" }).click();
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Rectangle", exact: true })
    .click();
  await dragOnBoard(page, { x: 520, y: 170 }, { x: 700, y: 290 });
  await page.getByTitle("Select Tool").click();

  const rectangle = page.locator('[data-board-element="true"]').first();
  const beforeResize = await rectangle.boundingBox();
  expect(beforeResize).not.toBeNull();
  const northWestHandle = rectangle.locator(".cursor-nw-resize");
  const handleBox = await northWestHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.evaluate(() => {
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 99,
        clientX: 0,
        clientY: 0,
      }),
    );
  });
  await page.mouse.move(handleBox!.x - 60, handleBox!.y - 45, { steps: 6 });
  await page.mouse.up();
  const afterResize = await rectangle.boundingBox();
  expect(afterResize).not.toBeNull();
  expect(afterResize!.width).toBeGreaterThan(beforeResize!.width + 40);
  expect(afterResize!.height).toBeGreaterThan(beforeResize!.height + 25);
});

test("keeps the floating tool bar height and corner inset consistent", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Bottom Toolbar Geometry");
  await page.getByRole("button", { name: "Create Noteboard" }).click();

  const toolbar = page.locator('[data-bottom-toolbar="true"]');
  const heights: number[] = [];
  for (const title of ["Text Tool", "Media Tool", "Fill Tool", "Eraser Tool"]) {
    await page.getByTitle(title).click();
    await expect(toolbar).toBeVisible();
    await expect.poll(() => toolbar.evaluate(element => {
      const viewport = element.querySelector('.bottom-toolbar-scroll')!;
      return (viewport.scrollWidth > viewport.clientWidth + 1) === Boolean(element.querySelector('[data-property-scroll-row]'));
    })).toBe(true);
    heights.push(await toolbar.evaluate(element => element.getBoundingClientRect().height - (element.querySelector('[data-property-scroll-row]')?.getBoundingClientRect().height ?? 0)));
  }

  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5);
  expect(heights[0]).toBeGreaterThanOrEqual(64);

  await page.getByTitle("Fill Tool").click();
  await expect(
    toolbar.getByText("Click inside any element to fill", { exact: true }),
  ).toHaveCount(0);

  await page.setViewportSize({ width: 600, height: 720 });
  await page.getByTitle("Text Tool").click();
  const overflowMetrics = await toolbar.locator(".bottom-toolbar-scroll").evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  expect(overflowMetrics.width).toBeLessThanOrEqual(570.5);
  expect(overflowMetrics.scrollWidth).toBeGreaterThan(
    overflowMetrics.clientWidth,
  );
  expect(overflowMetrics.overflowX).toBe("auto");
});

test("moves toolbar tools into More by dragging without shifting its slot", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Tool More Drop");
  await page.getByRole("button", { name: "Create Noteboard" }).click();

  const mediaItem = page.locator('[data-toolbar-item="media"]');
  const moreItem = page.locator('[data-toolbar-item="more"]');
  await startMovingToolsToMore(page);
  const before = await moreItem.boundingBox();
  expect(before).not.toBeNull();

  await expect(mediaItem).toHaveAttribute("draggable", "true");
  await expect(
    page.locator('[data-toolbar-item="more"] > .toolbar-dropdown'),
  ).toBeHidden();
  await moveToolbarToolIntoMore(page, "media");
  const afterDrop = await moreItem.boundingBox();
  expect(afterDrop).not.toBeNull();
  expect(Math.abs(afterDrop!.x - before!.x)).toBeLessThan(1.5);
  expect(Math.abs(afterDrop!.width - before!.width)).toBeLessThan(1.5);

  await expect(page.locator('[data-bottom-toolbar="true"]')).toBeHidden();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  const moreMenu = page.locator('[data-toolbar-item="more"] > .toolbar-dropdown');
  const mediaRow = moreMenu.locator('[data-more-toolbar-item="media"]');
  await expect(mediaRow).toBeVisible();
  for (const settingsId of [
    "grid",
    "toolDefaults",
    "presetSettings",
    "behaviorSettings",
    "shortcutSettings",
  ]) {
    await expect(
      moreMenu.locator(`[data-more-toolbar-item="${settingsId}"]`),
    ).toHaveCount(0);
  }

  await expect(
    mediaRow.getByRole("button", { name: "Media", exact: true }),
  ).toBeEnabled();
  for (const nativeId of ["embed", "board", "link", "object-presets"]) {
    await expect(
      moreMenu.locator(`[data-more-toolbar-item="${nativeId}"] [data-more-tool-return]`),
    ).toBeVisible();
  }
  const mediaReturn = mediaRow.getByRole("button", {
    name: "Move Media to toolbar",
  });
  const mediaSettings = mediaRow.getByRole("button", {
    name: "Media settings",
  });
  await expect(mediaReturn).toBeVisible();
  const returnBox = await mediaReturn.boundingBox();
  const settingsBox = await mediaSettings.boundingBox();
  expect(returnBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(returnBox!.x).toBeLessThan(settingsBox!.x);
  await mediaSettings.click();
  await expect(
    mediaRow.getByRole("button", { name: "Tool settings" }),
  ).toBeVisible();
  await returnToolFromMore(page, "media", "Media");
  await expect(mediaRow).toHaveCount(0);
  await expect(mediaItem).toBeVisible();
  await expect
    .poll(async () =>
      Number(await mediaItem.getAttribute("data-toolbar-slot-start")),
    )
    .toBeGreaterThanOrEqual(0);

  await returnToolFromMore(page, "embed", "Web");
  const webToolbarItem = page.locator('[data-toolbar-item="embed"]');
  await expect(webToolbarItem).toBeVisible();
  await webToolbarItem
    .getByRole("button", { name: "Open Web settings" })
    .click();
  await expect(
    webToolbarItem.getByText("Device mode", { exact: true }),
  ).toBeVisible();

  await startMovingToolsToMore(page);
  await moveToolbarToolIntoMore(page, "embed");
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.locator('[data-more-toolbar-item="embed"]'),
  ).toBeVisible();
});

test("moves several toolbar tools into More in one editing session", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Native More Drag");
  await page.getByRole("button", { name: "Create Noteboard" }).click();
  await startMovingToolsToMore(page);

  for (const id of ["media", "shapes", "text"]) {
    await moveToolbarToolIntoMore(page, id);
  }
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  for (const id of ["media", "shapes", "text"]) {
    await expect(page.locator(`[data-more-toolbar-item="${id}"]`)).toBeVisible();
  }
});

test("places a New Board by dragging and accepts objects on it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E New Board Surface");
  await page.getByRole("button", { name: "Create Noteboard" }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "New Board", exact: true }).click();

  const workspacePoint = await page.evaluate(() => {
    for (let y = 100; y < innerHeight - 180; y += 20) {
      for (let x = 20; x < innerWidth - 220; x += 20) {
        if (document.elementFromPoint(x, y)?.id === "workspace-bg") {
          return { x, y };
        }
      }
    }
    return null;
  });
  expect(workspacePoint).not.toBeNull();
  await page.mouse.move(workspacePoint!.x, workspacePoint!.y);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.move(workspacePoint!.x + 180, workspacePoint!.y + 120, {
    steps: 10,
  });
  const boardPreview = page.locator('[data-new-board-preview="true"]');
  await expect(boardPreview).toBeVisible();
  const previewBox = await boardPreview.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(previewBox!.width).toBeGreaterThanOrEqual(175);
  expect(previewBox!.height).toBeGreaterThanOrEqual(115);
  await page.mouse.up();

  const secondaryBoard = page.locator(
    '[data-board-element="true"][data-board-surface="true"]',
  );
  await expect(secondaryBoard).toHaveCount(1);
  const secondaryBox = await secondaryBoard.boundingBox();
  expect(secondaryBox).not.toBeNull();

  await page.getByRole("button", { name: "Choose shape" }).click();
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Rectangle", exact: true })
    .click();
  await page.mouse.move(secondaryBox!.x + 24, secondaryBox!.y + 24);
  await page.mouse.down();
  await page.mouse.move(secondaryBox!.x + 124, secondaryBox!.y + 84, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(
    page.locator(
      '[data-board-element="true"]:not([data-board-surface="true"])',
    ),
  ).toHaveCount(1);
});

test("shows every moved tool's complete menu inline in More", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Complete More Menus");
  await page.getByRole("button", { name: "Create Noteboard" }).click();

  await startMovingToolsToMore(page);

  const tools = [
    { id: "select", label: "Select", expected: ["Lock Time (ms)", "Spin Snap", "Ratio Scaling"] },
    { id: "pan", label: "Hand", expected: ["Allow Editing Elements", "Allow Moving Elements"] },
    { id: "text", label: "Text", expected: ["Text Color", "Font Size"] },
    { id: "shapes", label: "Shapes", expected: ["Rectangle", "Section", "Ellipse", "Triangle", "Line", "Arrow"] },
    { id: "media", label: "Media", expected: [] },
    { id: "draw", label: "Draw", expected: ["Color", "Stroke Width", "Drawing Assistance"] },
    { id: "fill", label: "Fill", expected: ["Color"] },
    { id: "eraser", label: "Eraser", expected: ["Mode", "Size", "Shape"] },
  ] as const;

  for (const tool of tools) {
    await moveToolbarToolIntoMore(page, tool.id);
  }

  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  const moreMenu = page.locator(
    '[data-toolbar-item="more"] > .toolbar-dropdown',
  );
  await expect(moreMenu).toBeVisible();
  await expect
    .poll(() =>
      moreMenu
        .locator('[data-more-toolbar-item="select"]')
        .evaluate(
          (element) =>
            element.previousElementSibling?.getAttribute("data-more-toolbar-item") ===
            "object-presets",
        ),
    )
    .toBe(true);

  for (const tool of tools) {
    const row = moreMenu.locator(`[data-more-toolbar-item="${tool.id}"]`);
    const returnButton = row.getByRole("button", {
      name: `Move ${tool.label} to toolbar`,
    });
    const settingsButton = row.getByRole("button", {
      name: `${tool.label} settings`,
    });
    await expect(returnButton).toBeVisible();
    await expect(settingsButton).toBeVisible();
    const returnBox = await returnButton.boundingBox();
    const settingsBox = await settingsButton.boundingBox();
    expect(returnBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();
    expect(returnBox!.x).toBeLessThan(settingsBox!.x);

    await settingsButton.click();
    await expect(
      row.getByRole("button", { name: "Tool settings" }),
    ).toBeVisible();
    for (const label of tool.expected) {
      await expect(row.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await settingsButton.click();
  }

  const textRow = moreMenu.locator('[data-more-toolbar-item="text"]');
  await textRow.getByRole("button", { name: "Text settings" }).click();
  await textRow
    .getByText("Font Size", { exact: true })
    .locator("..")
    .locator("input")
    .fill("24");
  await textRow.getByRole("button", { name: "Text settings" }).click();

  const shapesRow = moreMenu.locator('[data-more-toolbar-item="shapes"]');
  await shapesRow.getByRole("button", { name: "Shapes settings" }).click();
  await shapesRow
    .getByRole("button", { name: "Ellipse", exact: true })
    .click();
  await expect(moreMenu).toBeHidden();
  await expect(page.locator('[data-bottom-toolbar="true"]')).toBeVisible();

  await page.getByRole("button", { name: "More", exact: true }).click();
  await returnToolFromMore(page, "shapes", "Shapes");
  await expect(shapesRow).toHaveCount(0);
  await expect(page.locator('[data-toolbar-item="shapes"]')).toBeVisible();
  await returnToolFromMore(page, "text", "Text");
  await expect(textRow).toHaveCount(0);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Open text settings" }).click();
  await expect(
    page
      .locator('[data-toolbar-item="text"] > .toolbar-dropdown')
      .getByText("Font Size", { exact: true })
      .locator("..")
      .locator("input"),
  ).toHaveValue("24");
});

test("persists bottom-bar object defaults immediately and reapplies them", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Noteboard" }).click();
  await page.getByLabel("Noteboard Name").fill("E2E Object Defaults");
  await page.getByRole("button", { name: "Create Noteboard" }).click();

  await page.getByRole("button", { name: "Choose shape" }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();

  const bottomToolbar = page.locator('[data-bottom-toolbar="true"]');
  await expect(page.locator('[data-board-element="true"]')).toHaveCount(0);
  await bottomToolbar.locator('[title="Border Radius"] input').fill("18");
  await bottomToolbar.locator('[title="Opacity"] input').evaluate((input) => {
    const range = input as HTMLInputElement;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeValueSetter?.call(range, "55");
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const saveDefaults = bottomToolbar.getByTitle(
    "Save settings for this object type",
  );
  await bottomToolbar.locator(".bottom-toolbar-scroll").evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const saveDefaultsBox = await saveDefaults.boundingBox();
  expect(saveDefaultsBox).not.toBeNull();
  const saveHitTarget = await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null;
      return {
        x,
        y,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        tag: target?.tagName ?? null,
        title: target?.closest("button")?.getAttribute("title") ?? null,
      };
    },
    {
      x: saveDefaultsBox!.x + saveDefaultsBox!.width / 2,
      y: saveDefaultsBox!.y + saveDefaultsBox!.height / 2,
    },
  );
  expect(saveHitTarget.title).toBe("Save settings for this object type");
  await page.mouse.click(
    saveDefaultsBox!.x + saveDefaultsBox!.width / 2,
    saveDefaultsBox!.y + saveDefaultsBox!.height / 2,
  );
  await expect(saveDefaults).toHaveClass(/text-green-700/);

  await expect
    .poll(
      async () => {
        const response = await request.get("/api/pages");
        expect(response.ok()).toBeTruthy();
        const boards = (await response.json()) as Array<{
          title: string;
          editorSettings?: {
            objectDefaults?: Record<
              string,
              { borderRadius?: number; opacity?: number }
            >;
          };
        }>;
        const defaults = boards.find(
          (board) => board.title === "E2E Object Defaults",
        )?.editorSettings?.objectDefaults?.rectangle;
        return [defaults?.borderRadius, defaults?.opacity];
      },
      { timeout: 900, intervals: [50, 100, 150] },
    )
    .toEqual([18, 55]);

  await dragOnBoard(page, { x: 120, y: 100 }, { x: 320, y: 220 });
  await expect
    .poll(async () => {
      const response = await request.get("/api/pages");
      const boards = (await response.json()) as Array<{
        title: string;
        elements?: Array<{
          type: string;
          borderRadius?: number;
          opacity?: number;
        }>;
      }>;
      const rectangle = boards
        .find((board) => board.title === "E2E Object Defaults")
        ?.elements?.find((element) => element.type === "rectangle");
      return [rectangle?.borderRadius, rectangle?.opacity];
    })
    .toEqual([18, 55]);

  await page.reload();
  await page
    .getByRole("article", { name: "E2E Object Defaults" })
    .click();
  await page.getByRole("button", { name: "Choose shape" }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await dragOnBoard(page, { x: 380, y: 120 }, { x: 560, y: 240 });

  await expect
    .poll(async () => {
      const response = await request.get("/api/pages");
      expect(response.ok()).toBeTruthy();
      const boards = (await response.json()) as Array<{
        title: string;
        elements?: Array<{
          type: string;
          borderRadius?: number;
          opacity?: number;
        }>;
      }>;
      const rectangles =
        boards
          .find((board) => board.title === "E2E Object Defaults")
          ?.elements?.filter((element) => element.type === "rectangle") ?? [];
      const latest = rectangles.at(-1);
      return [rectangles.length, latest?.borderRadius, latest?.opacity];
    })
    .toEqual([2, 18, 55]);
});

test("opens the three Save as destinations", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Noteboard' }).click();
  await page.getByLabel('Noteboard Name').fill('E2E Save Dialog');
  await page.getByRole('button', { name: 'Create Noteboard' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-save-as-kind]')).toHaveCount(3);
  await expect(dialog.getByRole('button', {name:'Save as Template'})).toBeVisible();
  await expect(dialog.getByRole('button', {name:'Save as New Board'})).toBeVisible();
  await expect(dialog.getByRole('button', {name:'Save as File'})).toBeVisible();
  await dialog.getByRole('button', { name: 'Close save dialog' }).click();
  await expect(dialog).toHaveCount(0);
});
