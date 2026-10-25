import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createSimpleWorkbook } from "../../src/features/spreadsheet/simple-workbook";
import { gridObjectSize } from "../../src/features/spreadsheet/grid-geometry";

const seed = (
  id: string,
  elements: any[] = [],
  editorSettings: Record<string, unknown> = {},
  pageFields: Record<string, unknown> = {},
) => ([{
  id,
  title: id,
  width: 1100,
  height: 700,
  workspaceWidth: 1600,
  workspaceHeight: 1200,
  boardX: 64,
  boardY: 0,
  viewportCenterX: 640,
  viewportCenterY: 328,
  zoom: 1,
  updatedAt: Date.now(),
  isPinned: false,
  ...pageFields,
  elements,
  editorSettings: {
    activeTool: "select",
    keepToolActive: true,
    enableObjectSnapping: false,
    isSelectionLockEnabled: false,
    ...editorSettings,
  },
}]);

async function openBoard(page: Page, id: string) {
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${id}`, exact: true }).click();
}

const readWorkbook = async (page: Page) => {
  const frame = page.locator('iframe[title="Spreadsheet cells"]');
  const snapshot = async () => frame.evaluate((frameElement) => {
    const api = (frameElement as HTMLIFrameElement).contentWindow as any;
    return typeof api?.noteboardSheet?.snapshot === "function"
      ? api.noteboardSheet.snapshot()
      : null;
  });
  await expect.poll(snapshot, { timeout: 30_000 }).toBeTruthy();
  return JSON.parse((await snapshot())!);
};

test("partial eraser persists point, horizontal, and vertical strokes with positive bounds", async ({ page, request }) => {
  const id = "eraser-positive-bounds";
  await request.post("/api/pages", {
    data: seed(id, [], { activeTool: "eraser", eraserMode: "partial" }),
  });
  await openBoard(page, id);
  const board = (await page.locator('[data-board-root="true"]').boundingBox())!;
  await page.mouse.click(board.x + 160, board.y + 160);
  await page.mouse.move(board.x + 220, board.y + 240);
  await page.mouse.down();
  await page.mouse.move(board.x + 270, board.y + 240, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(board.x + 320, board.y + 190);
  await page.mouse.down();
  await page.mouse.move(board.x + 320, board.y + 250, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => {
    const pages = await (await request.get("/api/pages")).json();
    const saved = pages.find((item: any) => item.id === id);
    return saved?.elements.filter((element: any) => element.isEraser).length;
  }).toBe(3);
  const pages = await (await request.get("/api/pages")).json();
  const erasers = pages.find((item: any) => item.id === id).elements.filter((element: any) => element.isEraser);
  expect(erasers.every((element: any) => element.size.width > 0 && element.size.height > 0)).toBe(true);
});

test("dropping a board package onto an additional surface clamps inside that surface", async ({ page, request }) => {
  const id = "package-on-additional-board";
  const surface = {
    id: "secondary",
    type: "board",
    position: { x: 400, y: 160 },
    size: { width: 400, height: 300 },
    color: "#fef3c7",
    content: "Secondary",
    zIndex: -1,
  };
  await request.post("/api/pages", { data: seed(id, [surface]) });
  await openBoard(page, id);
  const zip = new JSZip();
  zip.file("board.json", JSON.stringify({
    id: "package-source",
    title: "Package source",
    width: 300,
    height: 200,
    elements: [
      { id: "package-item", type: "rectangle", position: { x: 20, y: 25 }, size: { width: 80, height: 50 }, content: "", zIndex: 1 },
    ],
  }));
  const archive = Array.from(await zip.generateAsync({ type: "uint8array" }));
  const dataTransfer = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "board_noteboard.zip", { type: "application/zip" }));
    return transfer;
  }, archive);
  const root = (await page.locator('[data-board-root="true"]').boundingBox())!;
  await page.locator('[data-board-root="true"]').dispatchEvent("drop", {
    dataTransfer,
    clientX: root.x + 780,
    clientY: root.y + 420,
  });
  await expect(page.locator('[data-board-element-id][data-board-element-type="rectangle"]')).toHaveCount(1);
  const imported = page.locator('[data-board-element-type="rectangle"]');
  const importedBounds = (await imported.boundingBox())!;
  const surfaceBounds = (await page.locator('[data-board-element-id="secondary"]').boundingBox())!;
  expect(importedBounds.x).toBeGreaterThanOrEqual(surfaceBounds.x - 1);
  expect(importedBounds.y).toBeGreaterThanOrEqual(surfaceBounds.y - 1);
  expect(importedBounds.x + importedBounds.width).toBeLessThanOrEqual(surfaceBounds.x + surfaceBounds.width + 1);
  expect(importedBounds.y + importedBounds.height).toBeLessThanOrEqual(surfaceBounds.y + surfaceBounds.height + 1);
  expect(await imported.getAttribute("data-board-element-id")).not.toBe("package-item");
  await dataTransfer.dispose();
});

test("simple spreadsheet resize captures the live unconfirmed cell draft", async ({ page, request }) => {
  const id = "resize-live-simple-sheet";
  const workbook = createSimpleWorkbook(348, 142, { width: 100, height: 24 });
  await request.post("/api/pages", {
    data: seed(id, [{
      id: "sheet",
      type: "table",
      position: { x: 80, y: 120 },
      size: gridObjectSize(workbook),
      content: JSON.stringify(workbook),
      zIndex: 1,
    }], { allowEditing: true }),
  });
  await openBoard(page, id);
  await page.locator('[data-board-element-id="sheet"]').click({ position: { x: 80, y: 15 } });
  const grid = page.frameLocator('iframe[title="Spreadsheet cells"]')
    .locator('canvas[id^="univer-sheet-main-canvas_"]');
  await expect(page.locator("[data-spreadsheet-inline]").getByRole("status")).toHaveCount(0, { timeout: 30_000 });
  await grid.click({ position: { x: 90, y: 32 } });
  await page.keyboard.type("live draft");
  await expect.poll(async () => (await readWorkbook(page)).workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.v).toBe("live draft");

  const handle = page.locator('[data-board-element-id="sheet"] [data-resize-handle="se"]');
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 120, bounds.y + bounds.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await readWorkbook(page)).workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.v).toBe("live draft");
  await page.locator('[data-board-root="true"]').click({ position: { x: 800, y: 450 } });
  await page.keyboard.press('Control+z');
  await page.locator('[data-board-element-id="sheet"]').click({ position: { x: 80, y: 15 } });
  await expect.poll(async () => (await readWorkbook(page)).workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.v).toBe("live draft");
});

test("duplicating a simple spreadsheet includes the live cell draft", async ({ page, request }) => {
  const id = "duplicate-live-simple-sheet";
  const workbook = createSimpleWorkbook(348, 142, { width: 100, height: 24 });
  await request.post("/api/pages", {
    data: seed(id, [{
      id: "sheet",
      type: "table",
      position: { x: 80, y: 120 },
      size: gridObjectSize(workbook),
      content: JSON.stringify(workbook),
      zIndex: 1,
    }], { allowEditing: true }),
  });
  await openBoard(page, id);
  await page.locator('[data-board-element-id="sheet"]').click({ position: { x: 80, y: 15 } });
  const grid = page.frameLocator('iframe[title="Spreadsheet cells"]')
    .locator('canvas[id^="univer-sheet-main-canvas_"]');
  await expect(page.locator("[data-spreadsheet-inline]").getByRole("status")).toHaveCount(0, { timeout: 30_000 });
  await grid.click({ position: { x: 90, y: 32 } });
  await page.keyboard.type("duplicate draft");
  await expect.poll(async () => (await readWorkbook(page)).workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.v).toBe("duplicate draft");
  await page.locator('[data-bottom-toolbar]').getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator('[data-board-element-type="table"]')).toHaveCount(2);
  await expect.poll(async () => {
    const pages = await (await request.get("/api/pages")).json();
    const saved = pages.find((item: any) => item.id === id);
    return saved?.elements.filter((element: any) => element.type === "table").length;
  }).toBe(2);
  const pages = await (await request.get("/api/pages")).json();
  const sheets = pages.find((item: any) => item.id === id).elements.filter((element: any) => element.type === "table");
  expect(sheets.every((sheet: any) => JSON.parse(sheet.content).workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.v === "duplicate draft")).toBe(true);
  await page.locator('[data-board-root="true"]').click({ position: { x: 800, y: 450 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-board-element-type="table"]')).toHaveCount(1);
  await page.locator('[data-board-element-id="sheet"]').click({ position: { x: 80, y: 15 } });
  await expect.poll(async () => (await readWorkbook(page)).workbook.sheets["sheet-1"].cellData?.[0]?.[0]?.v).toBe("duplicate draft");
});

test("placing a single Web object preset creates an independent session", async ({ page, request }) => {
  const id = "fresh-web-preset-session";
  await request.post("/api/pages", {
    data: seed(id, [], {
      objectPresets: [{
        id: "web-preset",
        name: "Web preset",
        shortcut: "P",
        element: {
          id: "preset-web",
          type: "embed",
          position: { x: 0, y: 0 },
          size: { width: 240, height: 150 },
          content: "https://example.com/",
          webSessionId: "shared-old-session",
          webRememberSession: true,
          zIndex: 1,
        },
      }],
    }),
  });
  await openBoard(page, id);
  await page.locator('[data-board-root="true"]').click({ position: { x: 100, y: 100 } });
  await page.keyboard.press("p");
  await expect(page.locator('[data-board-element-type="embed"]')).toHaveCount(1);
  await expect.poll(async () => {
    const pages = await (await request.get("/api/pages")).json();
    const saved = pages.find((item: any) => item.id === id);
    return saved?.elements.find((element: any) => element.type === "embed")?.webSessionId;
  }).not.toBe("shared-old-session");
});

test("workspace Background Grid changes are captured by Undo", async ({ page, request }) => {
  const id = "workspace-grid-undo";
  await request.post("/api/pages", {
    data: seed(id, [], {}, {
      showWorkspaceGrid: true,
      workspaceGridColor: "#111111",
      workspaceGridThickness: 2,
      workspaceGridSize: 50,
    }),
  });
  await openBoard(page, id);
  await page.getByRole("button", { name: "General Settings", exact: true }).click();
  const settings = page.locator('[data-general-settings-section="grid"]');
  await settings.getByRole("button", { name: "Board Settings settings" }).click();
  await settings.getByRole("button", { name: "Background Grid" }).click();
  const workspaceGridSize = settings.locator("label").filter({ hasText: "Size" }).nth(1).locator('input[type="range"]');
  await expect(workspaceGridSize).toHaveValue("50");
  await workspaceGridSize.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#workspace-bg")).toHaveCSS("background-size", "52px 52px");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "General Settings", exact: true }).click();
  await page.locator('[data-board-root="true"]').click({ position: { x: 500, y: 500 } });
  await page.keyboard.press("Control+z");
  await expect(page.locator("#workspace-bg")).toHaveCSS("background-size", /^50px 50px(?:, 50px 50px)?$/);
});

for (const previewMode of ["box", "realistic"] as const) {
  test(`media edge placement keeps its anchor and preview geometry in ${previewMode} mode`, async ({ page, request }) => {
    const id = `media-edge-${previewMode}`;
    await request.post("/api/pages", {
      data: seed(id, [], { activeTool: "media", previewMode }),
    });
    await openBoard(page, id);
    const root = (await page.locator('[data-board-root="true"]').boundingBox())!;
    const start = { x: root.x + 1088, y: root.y + 200 };
    const end = { x: root.x + 1095, y: root.y + 205 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    const preview = page.locator('[data-board-placement-preview="true"]');
    await expect(preview).toBeVisible();
    const previewBounds = (await preview.boundingBox())!;
    await page.mouse.up();
    const media = page.locator('[data-board-element-type="media"]');
    await expect(media).toHaveCount(1);
    const finalBounds = (await media.boundingBox())!;
    expect(finalBounds.x).toBeCloseTo(previewBounds.x, 0);
    expect(finalBounds.y).toBeCloseTo(previewBounds.y, 0);
    expect(finalBounds.x).toBeGreaterThan(root.x + 1060);
    expect(finalBounds.x).toBeLessThan(root.x + 1090);
    expect(finalBounds.width).toBeCloseTo(previewBounds.width, 0);
    expect(finalBounds.width).toBeGreaterThan(0);
  });
}
