import { test, expect, type Page } from "@playwright/test";
import { createWorkbookDocument } from "../../src/features/spreadsheet/workbook";

const board = (id: string, elements: any[] = [], settings = {}) => ({
  id,
  title: id,
  width: 1300,
  height: 850,
  boardX: 64,
  boardY: 0,
  workspaceWidth: 1800,
  workspaceHeight: 1100,
  viewportCenterX: 704,
  viewportCenterY: 388,
  zoom: 1,
  updatedAt: Date.now(),
  elements,
  editorSettings: {
    activeTool: "select",
    keepToolActive: true,
    enableObjectSnapping: false,
    isSelectionLockEnabled: false,
    ...settings,
  },
});
const sheet = (id: string, x: number, y: number, width = 100, height = 24) => ({
  id,
  type: "table",
  position: { x, y },
  size: { width: 650, height: 430 },
  content: JSON.stringify(createWorkbookDocument(id, [], { width, height })),
  zIndex: 1,
});
const read = async (page: Page) =>
  page
    .locator('iframe[title="Spreadsheet cells"]')
    .evaluate((frame) =>
      JSON.parse(
        (
          (frame as HTMLIFrameElement).contentWindow as any
        ).noteboardSheet.snapshot(),
      ),
    );

test("cell sizing preserves the live workbook, cell Undo and canvas Undo after switching sheets", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await request.post("/api/pages", {
    data: [
      board("sheet-size-undo", [sheet("a", 80, 120), sheet("b", 800, 120)]),
    ],
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open sheet-size-undo", exact: true })
    .click();
  const a = page.locator('[data-board-element-id="a"]');
  await a.click({ position: { x: 80, y: 15 } });
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
  const grid = page
    .frameLocator('iframe[title="Spreadsheet cells"]')
    .locator('canvas[id^="univer-sheet-main-canvas_"]');
  await grid.click({ position: { x: 90, y: 32 } });
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  const gridBounds = (await grid.boundingBox())!;
  await page.mouse.move(gridBounds.x + 190, gridBounds.y + 56);
  await page.mouse.down();
  await page.mouse.move(gridBounds.x + 90, gridBounds.y + 32, { steps: 6 });
  await page.mouse.up();
  const panel = page.getByRole("complementary", {
    name: "Spreadsheet settings",
  });
  await panel.getByLabel("Cell value or formula").fill("99");
  await panel
    .getByRole("button", { name: "Apply to active cell", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].cellData?.[1]?.[1]?.v,
    )
    .toBe(99);
  expect((await read(page)).workbook.sheets["sheet-1"].cellData[0][0].v).toBe(
    12,
  );
  await page.getByLabel("Cell width", { exact: true }).fill("90");
  await page.getByLabel("Cell width", { exact: true }).press("Tab");
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].columnData?.[0]?.w,
    )
    .toBe(90);
  await page
    .getByRole("button", { name: "Undo spreadsheet change", exact: true })
    .click();
  await expect
    .poll(async () => {
      const sheet = (await read(page)).workbook.sheets["sheet-1"];
      return sheet.columnData?.[0]?.w ?? sheet.defaultColumnWidth;
    })
    .toBe(100);
  await page
    .getByRole("button", { name: "Redo spreadsheet change", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].columnData?.[0]?.w,
    )
    .toBe(90);
  const root = (await page.locator("[data-board-root]").boundingBox())!;
  await page.mouse.click(root.x + 10, root.y + 600);
  await page
    .locator('[data-board-element-id="b"]')
    .click({ position: { x: 80, y: 15 } });
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
  await page.mouse.click(root.x + 10, root.y + 600);
  await page.keyboard.press("Control+z");
  await a.click({ position: { x: 80, y: 15 } });
  await expect(page.getByLabel("Cell width", { exact: true })).toHaveValue(
    "100",
  );
  await expect(page.locator('[data-spreadsheet-inline]').getByRole('status')).toHaveCount(0,{timeout:30000});
  expect((await read(page)).workbook.sheets['sheet-1'].cellData[0][0].v).toBe(12);
  expect((await read(page)).workbook.sheets['sheet-1'].cellData[1][1].v).toBe(99);
  expect(errors).toEqual([]);
});

test("Select has exactly three variations and polygon stays open until the first vertex is connected", async ({
  page,
  request,
}) => {
  const data = board("select-modes", [
    {
      id: "box",
      type: "rectangle",
      position: { x: 200, y: 220 },
      size: { width: 40, height: 40 },
      content: "",
      zIndex: 1,
    },
  ]);
  await request.post("/api/pages", { data: [data] });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open select-modes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select settings", exact: true })
    .click();
  const modes = page.getByRole("group", {
    name: "Selection mode",
    exact: true,
  });
  await expect(modes.getByRole("button")).toHaveCount(3);
  await modes.getByRole("button", { name: "Polygon", exact: true }).click();
  await page
    .getByRole("button", { name: "Select settings", exact: true })
    .click();
  const root = (await page.locator("[data-board-root]").boundingBox())!;
  for (const [x, y] of [
    [100, 150],
    [400, 150],
    [400, 380],
  ])
    await page.mouse.click(root.x + x, root.y + y);
  const outline = page.locator('[data-selection-outline="polygon"]');
  await expect(outline.locator("circle")).toHaveCount(3);
  await expect(outline.locator("path")).toHaveAttribute("fill", "none");
  expect(await outline.locator("path").getAttribute("d")).not.toContain("Z");
  await expect(page.locator('[data-selection-region="committed"]')).toHaveCount(
    0,
  );

  await page.keyboard.press("Backspace");
  await expect(outline.locator("circle")).toHaveCount(2);
  await page.mouse.click(root.x + 400, root.y + 380);
  await page.mouse.click(root.x + 100, root.y + 380);
  await page.mouse.click(root.x + 100, root.y + 150);
  await expect(outline).toHaveCount(0);
  await expect(
    page.locator('[data-selection-region="committed"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.locator(
      '[data-more-toolbar-item="lasso"],[data-more-toolbar-item="polygon-select"]',
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect
    .poll(async () => {
      const pages = await (await request.get("/api/pages")).json();
      return pages.find((b: any) => b.id === "select-modes")?.editorSettings
        .selectMode;
    })
    .toBe("polygon");
});

test("automatic tool selection retains a spreadsheet for direct editing", async ({
  page,
  request,
}) => {
  await request.post("/api/pages", {
    data: [
      board("sheet-auto", [sheet("a", 80, 120)], { autoToolOnSelect: true }),
    ],
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open sheet-auto", exact: true })
    .click();
  await page
    .locator('[data-board-element-id="a"]')
    .click({ position: { x: 80, y: 15 } });
  await expect(page.locator("[data-spreadsheet-inline]")).toBeVisible();
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
  const grid = page
    .frameLocator('iframe[title="Spreadsheet cells"]')
    .locator('canvas[id^="univer-sheet-main-canvas_"]');
  await grid.click({ position: { x: 90, y: 32 } });
  await page.keyboard.type("27");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.v,
    )
    .toBe(27);
  await expect(page.getByLabel("Cell width", { exact: true })).toHaveValue(
    "100",
  );
});

test("inline spreadsheet edits, selects whole cells and shares its session and undo with expanded mode", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await request.post("/api/pages", {
    data: [board("inline-sheet", [sheet("a", 80, 120)])],
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open inline-sheet", exact: true })
    .click();
  await page
    .locator('[data-board-element-id="a"]')
    .click({ position: { x: 80, y: 15 } });
  const inline = page.locator("[data-spreadsheet-inline]");
  await expect(inline.getByRole("status")).toHaveCount(0, { timeout: 30000 });
  const panel = page.getByRole("complementary", {
    name: "Spreadsheet settings",
  });
  await expect(panel).toBeVisible();
  const iframe = page.locator('iframe[title="Spreadsheet cells"]'),
    grid = page
      .frameLocator('iframe[title="Spreadsheet cells"]')
      .locator('canvas[id^="univer-sheet-main-canvas_"]');
  await iframe.evaluate((frame) => {
    (frame as HTMLIFrameElement).contentWindow!.name = "shared-session";
  });
  await grid.click({ position: { x: 90, y: 32 } });
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await page.keyboard.type("8");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("=SUM(A1:A2)");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].cellData?.[0]?.[1]?.v,
    )
    .toBe(20);
  const bounds = (await grid.boundingBox())!;
  await page.mouse.move(bounds.x + 90, bounds.y + 32);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 190, bounds.y + 56, { steps: 6 });
  await page.mouse.up();
  await expect(panel).toContainText("A1:B2");
  await panel.getByRole("button", { name: "Bold cells", exact: true }).click();
  await expect
    .poll(async () => {
      const d = await read(page),
        s = d.workbook.sheets["sheet-1"].cellData?.[1]?.[1]?.s;
      return (typeof s === "string" ? d.workbook.styles[s] : s)?.bl;
    })
    .toBe(1);
  await expect(page.locator("[data-board-element-id]")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Edit spreadsheet", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Spreadsheet editor" });
  await expect(dialog).toBeVisible();
  expect(
    await iframe.evaluate(
      (frame) => (frame as HTMLIFrameElement).contentWindow!.name,
    ),
  ).toBe("shared-session");
  await grid.click({ position: { x: 90, y: 56 } });
  await page.keyboard.press("Delete");
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].cellData[0][1].v,
    )
    .toBe(12);
  await page.keyboard.press("Control+z");
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].cellData[0][1].v,
    )
    .toBe(20);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(inline).toBeVisible();
  expect(
    await iframe.evaluate(
      (frame) => (frame as HTMLIFrameElement).contentWindow!.name,
    ),
  ).toBe("shared-session");
  await expect(panel).toBeVisible();
  await expect(inline.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("cell dimensions belong to the selected spreadsheet and draft input persists when leaving it", async ({
  page,
  request,
}) => {
  await request.post("/api/pages", {
    data: [
      board("sheet-size", [
        sheet("a", 80, 120, 80, 28),
        sheet("b", 800, 120, 120, 32),
      ]),
    ],
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open sheet-size", exact: true })
    .click();
  const a = page.locator('[data-board-element-id="a"]');
  await a.click({ position: { x: 80, y: 15 } });
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByLabel("Cell width", { exact: true })).toHaveValue(
    "80",
  );
  await expect(page.getByLabel("Cell height", { exact: true })).toHaveValue(
    "28",
  );
  await page.getByLabel("Cell width", { exact: true }).fill("90");
  await page.getByLabel("Cell width", { exact: true }).press("Tab");
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].columnData?.[0]?.w,
    )
    .toBe(90);
  const grid = page
    .frameLocator('iframe[title="Spreadsheet cells"]')
    .locator('canvas[id^="univer-sheet-main-canvas_"]');
  await grid.click({ position: { x: 90, y: 32 } });
  await page.keyboard.type("unsaved draft");
  const root = (await page.locator("[data-board-root]").boundingBox())!;
  await page.mouse.click(root.x + 10, root.y + 600);
  await expect(page.locator("[data-spreadsheet-panel]")).toHaveCount(0);
  await a.click({ position: { x: 80, y: 15 } });
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].cellData[0][0].v,
    )
    .toBe("unsaved draft");
  await page.mouse.click(root.x + 10, root.y + 600);
  await page
    .locator('[data-board-element-id="b"]')
    .click({ position: { x: 80, y: 15 } });
  await expect(page.getByLabel("Cell width", { exact: true })).toHaveValue(
    "120",
  );
  await expect(page.getByLabel("Cell height", { exact: true })).toHaveValue(
    "32",
  );
  await page.mouse.click(root.x + 10, root.y + 600);
  await page.keyboard.press("Control+z");
  await a.click({ position: { x: 80, y: 15 } });
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
  await expect
    .poll(
      async () =>
        (await read(page)).workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.v,
    )
    .toBeUndefined();
  await expect(page.getByLabel("Cell width", { exact: true })).toHaveValue(
    "90",
  );
  await page.mouse.click(root.x + 10, root.y + 600);
  await page.keyboard.press("Control+z");
  await a.click({ position: { x: 80, y: 15 } });
  await expect(page.getByLabel("Cell width", { exact: true })).toHaveValue(
    "80",
  );
});

test("new spreadsheet defaults set a whole-cell creation and resize grid without changing the defaults afterwards", async ({
  page,
  request,
}) => {
  await request.post("/api/pages", { data: [board("sheet-create")] });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open sheet-create", exact: true })
    .click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .locator('[data-more-toolbar-item="table"]')
    .getByRole("button", { name: "Spreadsheet", exact: true })
    .click();
  await page.getByLabel("Cell width", { exact: true }).fill("80");
  await page.getByLabel("Cell width", { exact: true }).press("Tab");
  await page.getByLabel("Cell height", { exact: true }).fill("30");
  await page.getByLabel("Cell height", { exact: true }).press("Tab");
  const root = (await page.locator("[data-board-root]").boundingBox())!;
  await page.mouse.move(root.x + 120, root.y + 120);
  await page.mouse.down();
  await page.mouse.move(root.x + 530, root.y + 383, { steps: 8 });
  await page.mouse.up();
  const object = page.locator('[data-board-element-type="table"]');
  await expect(object).toHaveCount(1);
  let bounds = (await object.boundingBox())!;
  expect(bounds.width).toBeCloseTo(400, 0);
  expect(bounds.height).toBeCloseTo(270, 0);
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
  await page.getByRole("button", { name: "Select Tool", exact: true }).click();
  await object.click({ position: { x: 80, y: 15 } });
  const edge = (await object.locator(".cursor-e-resize").boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    edge.x + edge.width / 2 + 19,
    edge.y + edge.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  expect((await object.boundingBox())!.width).toBeCloseTo(400, 0);
  const nextEdge = (await object.locator(".cursor-e-resize").boundingBox())!;
  await page.mouse.move(
    nextEdge.x + nextEdge.width / 2,
    nextEdge.y + nextEdge.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    nextEdge.x + nextEdge.width / 2 + 48,
    nextEdge.y + nextEdge.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  expect((await object.boundingBox())!.width).toBeCloseTo(480, 0);
  await page.getByLabel("Cell width", { exact: true }).fill("90");
  await page.getByLabel("Cell width", { exact: true }).press("Tab");
  await expect(page.getByLabel("Cell width", { exact: true })).toHaveValue(
    "90",
  );
  await page.mouse.click(root.x + 10, root.y + 650);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .locator('[data-more-toolbar-item="table"]')
    .getByRole("button", { name: "Spreadsheet", exact: true })
    .click();
  await expect(page.getByLabel("Cell width", { exact: true })).toHaveValue(
    "80",
  );
  await expect(page.getByLabel("Cell height", { exact: true })).toHaveValue(
    "30",
  );
});
