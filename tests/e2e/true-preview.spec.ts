import { test, expect } from '@playwright/test';
import sharp from 'sharp';

const seed = (id: string, tool: string, extra = {}) => ({
  id, title: id, width: 1100, height: 700, boardX: 64, boardY: 0,
  workspaceWidth: 1500, workspaceHeight: 1000, viewportCenterX: 640, viewportCenterY: 328,
  zoom: 1, gridSize: 40, snapToGrid: false, elements: [], updatedAt: Date.now(),
  editorSettings: {activeTool: tool, keepToolActive: true, autoSelectOnPlace: false,
    previewMode: 'realistic', selectionLockTime: 600, isSelectionLockEnabled: true,
    enableObjectSnapping: false, pendingProps: {borderWidth: 12, borderColor: '#000000'},
  }, ...extra,
});

for (const tool of ['line', 'triangle', 'ellipse']) test(`True ${tool} preview waits for Lock in time and cancels an early release`, async ({page, request}) => {
  const id = `true-lock-${tool}`;
  await request.post('/api/pages', {data: [seed(id, tool)]});
  await page.goto('/'); await page.getByRole('button', {name: `Open ${id}`, exact: true}).click();
  const root = (await page.locator('[data-board-root]').boundingBox())!;
  const preview = page.locator('[data-board-root] .pointer-events-none.z-\\[100\\] > div');
  await page.mouse.move(root.x + 400, root.y + 280); await page.mouse.down();
  await page.mouse.move(root.x + 500, root.y + 340); await expect(preview).toHaveCount(0);
  await page.mouse.up(); await expect(page.locator(`[data-board-element-type="${tool}"]`)).toHaveCount(0);
  await page.mouse.move(root.x + 400, root.y + 280); await page.mouse.down();
  await expect(preview).toHaveCount(0); await expect(preview).toBeVisible();
  await page.mouse.move(root.x + 500, root.y + 340); await page.mouse.up();
  await expect(page.locator(`[data-board-element-type="${tool}"]`)).toHaveCount(1);
});

test('a nearly horizontal grid-snapped line does not jump by a full angle step', async ({page, request}) => {
  const id = 'true-line-angle';
  await request.post('/api/pages', {data: [seed(id, 'line', {snapToGrid: true})]});
  await page.goto('/'); await page.getByRole('button', {name: `Open ${id}`, exact: true}).click();
  const root = (await page.locator('[data-board-root]').boundingBox())!;
  await page.mouse.move(root.x + 400, root.y + 320); await page.mouse.down();
  await expect(page.locator('[data-board-root] .pointer-events-none.z-\\[100\\] > div')).toBeVisible();
  await page.mouse.move(root.x + 480, root.y + 319); await page.mouse.up();
  await expect.poll(async () => {
    const pages = await (await request.get('/api/pages')).json();
    return pages.find((item: any) => item.id === id)?.elements[0]?.rotation;
  }).toBe(0);
});

test('True line preview preserves the same rounded cap pixels as the placed line', async ({page, request}) => {
  const id = 'true-line-cap';
  await request.post('/api/pages', {data: [seed(id, 'line')]});
  await page.goto('/'); await page.getByRole('button', {name: `Open ${id}`, exact: true}).click();
  const root = (await page.locator('[data-board-root]').boundingBox())!;
  const anchor = {x: root.x + 400, y: root.y + 320};
  await page.mouse.move(anchor.x, anchor.y); await page.mouse.down();
  await expect(page.locator('[data-board-root] .pointer-events-none.z-\\[100\\] > div')).toBeVisible();
  await page.mouse.move(anchor.x + 160, anchor.y);
  const clip = {x: anchor.x - 5, y: anchor.y - 2, width: 3, height: 4};
  const preview = await sharp(await page.screenshot({clip})).removeAlpha().raw().toBuffer();
  await page.mouse.up(); await expect(page.locator('[data-board-element-type="line"]')).toBeVisible();
  const placed = await sharp(await page.screenshot({clip})).removeAlpha().raw().toBuffer();
  expect([...preview]).toEqual([...placed]);
  expect([...placed].some(value => value < 20)).toBe(true);
});

test('True triangle preview uses the final opacity and does not cut off its top stroke', async ({page, request}) => {
  const id = 'true-triangle-fidelity', data = seed(id, 'triangle');
  data.editorSettings.pendingProps = {...data.editorSettings.pendingProps, opacity: 42} as any;
  await request.post('/api/pages', {data: [data]});
  await page.goto('/'); await page.getByRole('button', {name: `Open ${id}`, exact: true}).click();
  const root = (await page.locator('[data-board-root]').boundingBox())!;
  await page.mouse.move(root.x + 400, root.y + 280); await page.mouse.down();
  const preview = page.locator('[data-board-root] .pointer-events-none.z-\\[100\\] > div');
  await expect(preview).toBeVisible(); await page.mouse.move(root.x + 560, root.y + 400);
  const appearance = async (locator: typeof preview) => locator.evaluate(node => ({
    opacity: getComputedStyle(node).opacity,
    stroke: node.querySelector('polygon')?.getAttribute('stroke'),
    width: node.querySelector('polygon')?.getAttribute('stroke-width'),
  }));
  const before = await appearance(preview);
  await page.mouse.up(); const placed = page.locator('[data-board-element-type="triangle"]');
  await expect(placed).toBeVisible(); expect(before).toEqual(await appearance(placed));
});

for (const tool of ['triangle','section']) test(`True ${tool} preview uses the final Section hierarchy and board clipping`, async ({page, request}) => {
  const id=`true-section-clipping-${tool}`,data=seed(id,tool,{elements:[{id:'obstacle',type:'section',position:{x:200,y:120},size:{width:500,height:350},content:'',zIndex:1,sectionCollision:'clip'}]});
  await request.post('/api/pages',{data:[data]}); await page.goto('/'); await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!;
  await page.mouse.move(root.x+100,root.y+280);await page.mouse.down();
  const preview=page.locator('[data-board-root] .z-\\[100\\] > div');await expect(preview).toBeVisible();
  await page.mouse.move(root.x+620,root.y+400);
  const before=await preview.evaluate(node=>(node as HTMLElement).style.clipPath);
  await page.mouse.up();
  const placed=page.locator(`[data-board-element-type="${tool}"]:not([data-board-element-id="obstacle"])`);
  await expect(placed).toBeVisible();
  const after=await placed.locator(':scope > .group > .relative').first().evaluate(node=>(node as HTMLElement).style.clipPath);
  expect(before).toBe(after);
});

test('True New Board preview uses the created surface color, grid and bounds',async({page,request})=>{
  const id='true-new-board-surface',data=seed(id,'board',{showGrid:true});
  data.editorSettings.pendingProps={...data.editorSettings.pendingProps,color:'#fef3c7'} as any;
  await request.post('/api/pages',{data:[data]});await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
  const anchor=await page.evaluate(()=>{
    for(let y=160;y<innerHeight-180;y+=20)for(let x=20;x<innerWidth-220;x+=20)if(document.elementFromPoint(x,y)?.id==='workspace-bg')return{x,y};
    return null;
  });expect(anchor).not.toBeNull();
  await page.mouse.move(anchor!.x,anchor!.y);await page.mouse.down();
  const preview=page.locator('[data-new-board-preview="true"]');await expect(preview).toBeVisible();
  await page.mouse.move(anchor!.x+180,anchor!.y+120);
  const before=await preview.locator('[data-board-surface="true"]').evaluate(node=>({color:getComputedStyle(node).backgroundColor,grid:getComputedStyle(node).backgroundImage}));
  const bounds=(await preview.boundingBox())!;await page.mouse.up();
  const placed=page.locator('[data-board-element-type="board"]');await expect(placed).toHaveCount(1);
  expect(await placed.locator('[data-board-surface="true"]').evaluate(node=>({color:getComputedStyle(node).backgroundColor,grid:getComputedStyle(node).backgroundImage}))).toEqual(before);
  const actual=(await placed.boundingBox())!;for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(bounds[key],0);
});
