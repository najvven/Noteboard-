import { test, expect, type Page } from '@playwright/test';
import { readBoardClipboard } from '../../src/features/board/clipboard';

const board = (id: string, tool = 'select', elements: any[] = []) => ({
  id, title: id, width: 1100, height: 700, boardX: 64, boardY: 0,
  workspaceWidth: 1500, workspaceHeight: 1000, viewportCenterX: 640, viewportCenterY: 328,
  zoom: 1, elements, updatedAt: Date.now(), editorSettings: {
    activeTool: tool, keepToolActive: true, enableObjectSnapping: false, autoToolOnSelect: false,
    isSelectionLockEnabled: true, selectionLockTime: 250, previewMode: 'realistic',
  },
});
async function drawArea(page: Page, tool: string, points: number[][]) {
  const root = (await page.locator('[data-board-root]').boundingBox())!;
  if (tool === 'lasso') {
    await page.mouse.move(root.x + points[0][0], root.y + points[0][1]); await page.mouse.down();
    for (const [x,y] of points.slice(1)) await page.mouse.move(root.x+x, root.y+y, {steps:5});
    await page.mouse.up();
  } else {
    for (const [x,y] of points) await page.mouse.click(root.x+x, root.y+y);
    await page.keyboard.press('Enter');
  }
}

for (const tool of ['polygon-select','lasso']) test(`${tool} keeps its shaped area and offers editable Copy, Paste and Merge`, async ({page, request, context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const id = `shaped-area-${tool}`;
  const box = (name: string, x: number, y: number) => ({id:name,type:'rectangle',position:{x,y},size:{width:40,height:40},content:'',zIndex:1});
  await request.post('/api/pages', {data: [board(id, tool, [box('a',100,180),box('b',120,300),box('notch',300,300)])]});
  await page.goto('/'); await page.getByRole('button', {name:`Open ${id}`,exact:true}).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
  await drawArea(page,tool,[[80,140],[380,140],[380,240],[240,240],[240,380],[80,380],[80,140]]);
  const region = page.locator('[data-selection-region="committed"][data-selection-shape="outline"]');
  await expect(region).toBeVisible(); await expect(region.locator('path')).toHaveAttribute('fill-rule','evenodd');
  await page.screenshot({path:`.tmp/task14-area-${tool}.png`});
  const actions = page.locator('[data-selection-area-toolbar]'); await expect(actions).toBeVisible();
  for (const label of ['Copy area','Paste into area','Merge area']) await expect(actions.getByRole('button',{name:label,exact:true})).toBeVisible();
  await page.evaluate(()=>navigator.clipboard.writeText('before-area-copy'));
  await actions.getByRole('button',{name:'Copy area',exact:true}).click();
  await expect.poll(async()=>page.evaluate(async()=> (await navigator.clipboard.read()).some(item=>item.types.includes('text/html')))).toBe(true);
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await items.find(item=>item.types.includes('text/html'))!.getType('text/html')).text();
  });
  const copied = readBoardClipboard({getData:type=>type==='text/html'?html:''})!;
  expect(copied.elements).toHaveLength(2); // The object in the concave notch stays outside the copied area.
  await drawArea(page,tool,[[600,140],[860,140],[860,380],[600,380],[600,140]]);
  await actions.getByRole('button',{name:'Paste into area',exact:true}).click();
  await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(5);
  await actions.getByRole('button',{name:'Merge area',exact:true}).click();
  await expect(page.locator('[data-board-element-type="group"]')).toHaveCount(1);
  await expect(page.locator('[data-board-element-id="notch"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Ungroup',exact:true}).click();
  await expect(page.locator('[data-board-element-type="group"]')).toHaveCount(0);
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-board-element-type="group"]')).toHaveCount(1);
});

test('triangle corner choices affect True preview, placed objects and saved defaults', async ({page, request}) => {
  const id = 'triangle-corners'; await request.post('/api/pages', {data:[board(id,'triangle')]});
  await page.goto('/'); await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const corners = page.locator('[data-bottom-toolbar]').getByRole('group',{name:'Triangle corners',exact:true});
  await corners.getByRole('button',{name:'Rounded',exact:true}).click();
  const root = (await page.locator('[data-board-root]').boundingBox())!;
  await page.mouse.move(root.x+400,root.y+280); await page.mouse.down(); await page.waitForTimeout(300);
  await page.mouse.move(root.x+560,root.y+400);
  await expect(page.locator('[data-board-root] .z-\\[100\\] polygon')).toHaveAttribute('stroke-linejoin','round');
  await page.mouse.up(); const placed=page.locator('[data-board-element-type="triangle"]');
  await expect(placed.locator('polygon')).toHaveAttribute('stroke-linejoin','round');
  await page.getByRole('button',{name:'Select Tool',exact:true}).click(); await placed.click();
  await corners.getByRole('button',{name:'Sharp',exact:true}).click();
  await expect(placed.locator('polygon')).toHaveAttribute('stroke-linejoin','miter');
  await page.getByRole('button',{name:'Save settings for this object type',exact:true}).click();
  await page.getByRole('button',{name:'Choose shape',exact:true}).click();
  await page.getByRole('banner').getByRole('button',{name:'Triangle',exact:true}).click();
  await page.getByRole('button',{name:'Choose shape',exact:true}).click();
  await expect(page.getByRole('banner').getByRole('group',{name:'Triangle corners',exact:true}).getByRole('button',{name:'Sharp',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('Web Tool settings let Select and Hand operate the page without moving or recreating the field', async ({page, request}) => {
  await page.route('https://web-controls.test/**', route=>route.fulfill({contentType:'text/html',body:'<button id="count" onclick="this.textContent=++window.count">0</button><script>window.count=0;window.marker=crypto.randomUUID();</script>'}));
  const id='web-tool-controls',data=board(id,'select',[{id:'web',type:'embed',position:{x:100,y:140},size:{width:600,height:320},content:'https://web-controls.test/',zIndex:1}]);
  await request.post('/api/pages',{data:[data]}); await page.goto('/'); await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const frame=page.frameLocator('iframe[title="Web page"]'),counter=frame.getByRole('button',{name:'0',exact:true});
  await expect(counter).toBeVisible(); const original=(await page.locator('[data-board-element-id="web"]').boundingBox())!;
  const clickPage=async()=>{const target=(await frame.locator('#count').boundingBox())!;await page.mouse.click(target.x+target.width/2,target.y+target.height/2);};
  await clickPage(); await expect(frame.locator('#count')).toHaveText('0');
  await page.getByRole('button',{name:'More',exact:true}).click();
  const row=page.locator('[data-more-toolbar-item="embed"]'); await row.getByRole('button',{name:'Web settings',exact:true}).click();
  await row.getByRole('button',{name:'Tool settings',exact:true}).click();
  await row.getByRole('button',{name:'Use page with Select',exact:true}).click();
  await page.getByRole('button',{name:'More',exact:true}).click(); await frame.locator('#count').click(); await expect(frame.locator('#count')).toHaveText('1');
  await page.getByRole('button',{name:'Pan Tool (Hand)',exact:true}).click(); await frame.locator('#count').click(); await expect(frame.locator('#count')).toHaveText('2');
  const actual=(await page.locator('[data-board-element-id="web"]').boundingBox())!;
  expect(actual.x).toBeCloseTo(original.x,0); expect(actual.y).toBeCloseTo(original.y,0);
});
