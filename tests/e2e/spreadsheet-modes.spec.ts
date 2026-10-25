import { test, expect, type Page } from "./test";
import { createSimpleWorkbook } from "../../src/features/spreadsheet/simple-workbook";
import { createWorkbookDocument } from "../../src/features/spreadsheet/workbook";
import { gridObjectSize } from "../../src/features/spreadsheet/grid-geometry";

const snapshot = (page: Page) =>
  page
    .locator('iframe[title="Spreadsheet cells"]')
    .evaluate((frame) =>
      JSON.parse(
        (
          (frame as HTMLIFrameElement).contentWindow as any
        ).noteboardSheet.snapshot(),
      ),
    );
const seed = (id: string, doc: any) => ({
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
  elements: [
    {
      id: "sheet",
      type: "table",
      position: { x: 80, y: 120 },
      size:
        doc.mode === "simple"
          ? gridObjectSize(doc)
          : { width: 650, height: 430 },
      content: JSON.stringify(doc),
      zIndex: 1,
    },
  ],
  editorSettings: {
    activeTool: "select",
    keepToolActive: true,
    enableObjectSnapping: false,
    isSelectionLockEnabled: false,
  },
});
async function open(page: Page, id: string) {
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${id}`, exact: true }).click();
  await page
    .locator('[data-board-element-id="sheet"]')
    .click({ position: { x: 80, y: 15 } });
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
}

test("simple mode shows its entire finite sheet including headers, edits and resizes cells without a title or full editor", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const doc = createSimpleWorkbook(348, 142, { width: 100, height: 24 });
  doc.workbook.sheets!['sheet-1'].cellData={0:{0:{v:12,t:2},1:{f:'=SUM(A1:A2)'}},1:{0:{v:8,t:2}}};
  await request.post("/api/pages", { data: [seed("simple-grid", doc)] });
  await open(page, "simple-grid");
  const frame = page.frameLocator('iframe[title="Spreadsheet cells"]'),
    grid = frame.locator('canvas[id^="univer-sheet-main-canvas_"]');
  await expect(
    page.getByRole("button", { name: "Edit spreadsheet", exact: true }),
  ).toHaveCount(0);
  const bounds = (await grid.boundingBox())!;
  expect(bounds.width).toBe(346);
  expect(bounds.height).toBe(140);
  const live = await snapshot(page);
  await expect.poll(async()=>(await snapshot(page)).workbook.sheets['sheet-1'].cellData?.[0]?.[1]?.v).toBe(20);
  expect(live.mode).toBe("simple");
  expect(live.workbook.sheets["sheet-1"].rowCount).toBe(5);
  expect(live.workbook.sheets["sheet-1"].columnCount).toBe(3);
  await grid.click({ position: { x: 290, y: 128 } });
  await page.keyboard.type("last cell");
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await snapshot(page)).workbook.sheets["sheet-1"].cellData?.[4]?.[2]?.v,
    )
    .toBe("last cell");
  await grid.click({position:{x:90,y:32}});await page.keyboard.type('12');await page.keyboard.press('Enter');await page.keyboard.type('8');await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowRight');await page.keyboard.type('=SUM(A1:A2)');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await snapshot(page)).workbook.sheets['sheet-1'].cellData?.[0]?.[1]?.v).toBe(20);
  await page.getByLabel("Cell width", { exact: true }).fill("80");
  await page.getByLabel("Cell width", { exact: true }).press("Tab");
  await expect
    .poll(async () => Math.round((await grid.boundingBox())!.width))
    .toBe(286);
  expect((await snapshot(page)).workbook.sheets["sheet-1"].columnCount).toBe(3);
  await grid.hover();
  await page.mouse.wheel(400, 600);
  expect((await snapshot(page)).views["sheet-1"]).toMatchObject({
    sheetViewStartRow: 0,
    sheetViewStartColumn: 0,
    offsetX: 0,
    offsetY: 0,
  });
  expect(errors).toEqual([]);
});

test("right panel uses the full live ribbon and formatting survives switching to the advanced editor", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await request.post("/api/pages", {
    data: [seed("live-ribbon", createWorkbookDocument("Budget", [[12], [8]]))],
  });
  await open(page, "live-ribbon");
  const panel = page.getByRole("complementary", {
      name: "Spreadsheet settings",
    }),
    ribbon = panel.locator("[data-spreadsheet-ribbon]");
  for (const name of ["Start", "Insert", "Formulas", "Data", "View"])
    await expect(ribbon.getByText(name, { exact: true })).toBeVisible();
  const grid = page
    .frameLocator('iframe[title="Spreadsheet cells"]')
    .locator('canvas[id^="univer-sheet-main-canvas_"]');
  await grid.click({ position: { x: 90, y: 32 } });
  await ribbon.getByRole("button", { name: "Bold", exact: true }).click();
  await expect
    .poll(async () => {
      const d = await snapshot(page),
        s = d.workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.s;
      return (typeof s === "string" ? d.workbook.styles[s] : s)?.bl;
    })
    .toBe(1);
  await ribbon.getByText("Data", { exact: true }).click();
  await expect(
    ribbon.getByRole("button", { name: "Sort", exact: true }),
  ).toBeVisible();
  await ribbon
    .getByRole("button", { name: "Data validation", exact: true })
    .click();
  await ribbon.getByText("Data validation management", { exact: true }).click();
  await expect(
    panel.getByRole("complementary", { name: "Spreadsheet details" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Add Rule", exact: true }).click();
  const number = panel.getByRole("textbox", {
    name: "Please input value or formula",
    exact: true,
  });
  await number.click();
  await number.press("Control+a");
  await number.pressSequentially("10");
  await number.press("Tab");
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await snapshot(page)).workbook.resources.find(
            (resource: any) => resource.name === "SHEET_DATA_VALIDATION_PLUGIN",
          ).data,
        )["sheet-1"][0].formula1,
    )
    .toBe("10");
  await expect(page.locator("[data-board-element-id]")).toHaveCount(1);
  await panel
    .getByRole("button", { name: "Close spreadsheet details" })
    .click();
  await expect(
    panel.getByRole("complementary", { name: "Spreadsheet details" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit spreadsheet", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Spreadsheet editor" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(ribbon.getByText("Data", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("simple creation and resizing snap with headers and canvas Undo restores the complete finite sheet", async ({
  page,
  request,
}) => {
  const data = seed("simple-create", createWorkbookDocument());
  data.elements = [];
  await request.post("/api/pages", { data: [data] });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open simple-create", exact: true })
    .click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .locator('[data-more-toolbar-item="table"]')
    .getByRole("button", { name: "Spreadsheet", exact: true })
    .click();
  await page.getByRole("button", { name: "Simple", exact: true }).click();
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
  expect((await object.boundingBox())!.width).toBe(448);
  expect((await object.boundingBox())!.height).toBe(262);
  await expect(
    page.locator("[data-spreadsheet-inline]").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
  await page.getByRole("button", { name: "Select Tool", exact: true }).click();
  await object.click({ position: { x: 80, y: 15 } });
  const edge = (await object.locator(".cursor-e-resize").boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    edge.x + edge.width / 2 + 85,
    edge.y + edge.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await object.boundingBox())!.width))
    .toBe(528);
  await expect
    .poll(
      async () => (await snapshot(page)).workbook.sheets["sheet-1"].columnCount,
    )
    .toBe(6);
  await page.mouse.click(root.x + 10, root.y + 600);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => Math.round((await object.boundingBox())!.width))
    .toBe(448);
  await object.click({ position: { x: 80, y: 15 } });
  await page
    .frameLocator('iframe[title="Spreadsheet cells"]')
    .locator('canvas[id^="univer-sheet-main-canvas_"]')
    .waitFor();
  await expect
    .poll(
      async () => (await snapshot(page)).workbook.sheets["sheet-1"].columnCount,
    )
    .toBe(5);
});
