import {test, expect} from './test';

test('clipped-away pixels of an element pass hit testing to visible objects underneath', async ({page, request}) => {
  const id = 'section-hit-test';
  const elements = [
    {id:'clip',type:'section',position:{x:150,y:100},size:{width:100,height:100},color:'transparent',content:'',zIndex:0,sectionCollision:'clip'},
    {id:'back',type:'rectangle',parentId:'clip',position:{x:170,y:120},size:{width:60,height:60},color:'#ef4444',content:'',zIndex:1},
    {id:'front',type:'rectangle',position:{x:100,y:100},size:{width:200,height:100},color:'#2563eb',content:'',zIndex:2},
  ];
  await request.post('/api/pages', {data:[{
    id,title:id,width:1100,height:700,boardX:64,boardY:0,workspaceWidth:1500,
    workspaceHeight:1000,viewportCenterX:640,viewportCenterY:328,zoom:1,
    updatedAt:Date.now(),elements,
    editorSettings:{activeTool:'select',keepToolActive:true,enableObjectSnapping:false},
  }]});
  await page.goto('/');
  await page.getByRole('button',{name:'Open '+id,exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!;

  await page.mouse.click(root.x+200,root.y+150);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-board-element-id="back"]')).toHaveCount(0);
  await expect(page.locator('[data-board-element-id="front"]')).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-board-element-id="back"]')).toHaveCount(1);
  await page.mouse.click(root.x+120,root.y+150);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-board-element-id="front"]')).toHaveCount(0);
});

test('small Web fields stay within their saved geometry at a board edge', async ({page, request}) => {
  await page.route('https://web-small.test/**', route => route.fulfill({
    contentType:'text/html',
    body:'<!doctype html><button>Ready</button>',
  }));
  const id='small-web-boundary';
  await request.post('/api/pages', {data:[{
    id,title:id,width:1100,height:700,boardX:64,boardY:0,workspaceWidth:1500,
    workspaceHeight:1000,viewportCenterX:640,viewportCenterY:328,zoom:1,updatedAt:Date.now(),
    elements:[{id:'small',type:'embed',position:{x:1000,y:600},size:{width:100,height:100},content:'https://web-small.test/',zIndex:1}],
    editorSettings:{activeTool:'select',keepToolActive:true,enableObjectSnapping:false},
  }]});
  await page.goto('/');
  await page.getByRole('button',{name:'Open '+id,exact:true}).click();
  const field=page.locator('[data-board-element-id="small"]');
  await expect(field.locator('iframe[title="Web page"]')).toBeVisible();
  const bounds=(await field.boundingBox())!;
  expect(bounds.width).toBeCloseTo(100,0);
  expect(bounds.height).toBeCloseTo(100,0);
  const frameBounds=(await field.locator('iframe[title="Web page"]').boundingBox())!;
  expect(frameBounds.width).toBeCloseTo(100,0);
  expect(frameBounds.height).toBeCloseTo(100,0);
});
