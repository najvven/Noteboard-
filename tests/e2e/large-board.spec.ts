import { test, expect } from '@playwright/test';

test('a board with 1000 objects and a Section stays editable through resize, undo and save', async ({page,request}) => {
  const objects = Array.from({length:1000},(_,i)=>({
    id:`object-${i}`,type:'rectangle',position:{x:30+i%40*25,y:30+Math.floor(i/40)*16},
    size:{width:18,height:10},content:'',color:'#60a5fa',zIndex:i+1,
  }));
  const elements=[...objects,
    {id:'section',type:'section',position:{x:600,y:300},size:{width:300,height:220},content:'',color:'#f1f5f9',zIndex:-1},
    {id:'target',type:'rectangle',position:{x:60,y:500},size:{width:150,height:70},content:'',color:'#2563eb',zIndex:1001},
  ];
  const board={id:'large-audit',title:'Large audit',version:3,width:1100,height:650,workspaceWidth:1500,workspaceHeight:1000,boardX:64,boardY:0,viewportCenterX:640,viewportCenterY:328,zoom:1,updatedAt:Date.now(),elements,editorSettings:{activeTool:'select',keepToolActive:true,enableObjectSnapping:false,previewMode:'realistic'}};
  expect((await request.post('/api/pages',{data:[board]})).ok()).toBe(true);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'Open Large audit',exact:true}).click();
  await expect(page.locator('[data-board-element-id]')).toHaveCount(1002);
  const node=page.locator('[data-board-element-id="target"]');await node.click();
  const before=(await node.boundingBox())!;const edge=(await node.locator('.cursor-e-resize').boundingBox())!;
  const started=Date.now();
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();
  await page.mouse.move(edge.x+edge.width/2+80,edge.y+edge.height/2,{steps:8});await page.mouse.up();
  await expect.poll(async()=>(await node.boundingBox())!.width).toBeCloseTo(before.width+80,0);
  console.log(`1000-object resize including 8 pointer moves: ${Date.now()-started} ms`);
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await node.boundingBox())!.width).toBeCloseTo(before.width,0);
  await page.keyboard.press('Control+Shift+z');await expect.poll(async()=>(await node.boundingBox())!.width).toBeCloseTo(before.width+80,0);
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Open Large audit',exact:true}).click();
  await expect.poll(async()=>(await node.boundingBox())!.width).toBeCloseTo(before.width+80,0);
  expect(errors).toEqual([]);
  await request.delete('/api/pages/large-audit');
});
