import { deleteFixtureBoard } from './fixture-storage';
import { test, expect, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const markup='<h1>Heading</h1><p>Alpha <b>bravo</b> and <span style="font-size:26px;color:#e11d48">large</span> words keep their exact layout while scaling.</p><ul><li>A list item with enough words to wrap onto another line.</li><li>Second item</li></ul>';
async function geometry(page: Page) {
  return page.locator('[data-board-element-editor-id="scaled"]').evaluate(editor=>{
    const origin=editor.getBoundingClientRect(),ranges:number[][]=[];
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const range=document.createRange();range.selectNodeContents(walker.currentNode);
      for(const r of range.getClientRects()) ranges.push([r.x-origin.x,r.y-origin.y,r.width,r.height]);
    }
    return {html:editor.innerHTML,ranges,width:origin.width,height:origin.height};
  });
}
async function scale(page:Page,factor:number) {
  const node=page.locator('[data-board-element-id="scaled"]');
  const b=(await node.boundingBox())!, handle=(await node.locator('.cursor-se-resize').boundingBox())!;
  const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+b.width*(factor-1),y+b.height*(factor-1),{steps:8});
  await page.mouse.up();
}

test('Text scaling keeps rich layout intact, persists and returns to normal reflow when disabled',async({page,request})=>{
  for(const board of await(await request.get('/api/pages')).json())await deleteFixtureBoard(request, `/api/pages/${board.id}`);
  await request.post('/api/pages',{data:[{id:'text-scale',title:'Text scale',width:1100,height:750,workspaceWidth:1500,workspaceHeight:1100,boardX:64,boardY:0,viewportCenterX:640,viewportCenterY:328,zoom:1,updatedAt:Date.now(),elements:[{id:'scaled',type:'text',position:{x:100,y:80},size:{width:350,height:260},content:markup,fontSize:18,borderWidth:2,borderRadius:6,zIndex:1}],editorSettings:{activeTool:'select',allowEditing:false,keepToolActive:true,enableObjectSnapping:false,previewMode:'realistic'}}]});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.getByRole('button',{name:'Open Text scale',exact:true}).click();
  const node=page.locator('[data-board-element-id="scaled"]'),bar=page.locator('[data-bottom-toolbar]');
  await node.click();const before=await geometry(page);
  await bar.getByRole('button',{name:'Text scaling',exact:true}).click();
  await expect(bar.getByRole('button',{name:'Text scaling',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(node.locator('.cursor-e-resize')).toHaveCount(0);
  let factor=1;
  for(const step of [1.5,0.5,2]) {
    await scale(page,step);factor*=step;
    await expect.poll(async()=>Number(await node.locator('[data-text-scale-shell]').getAttribute('data-text-scale-shell'))).toBeCloseTo(factor,10);
    const after=await geometry(page);expect(after.html).toBe(before.html);expect(after.ranges.length).toBe(before.ranges.length);
    for(let i=0;i<before.ranges.length;i++)for(let j=0;j<4;j++)expect(Math.abs(after.ranges[i][j]/factor-before.ranges[i][j])).toBeLessThan(0.15);
  }
  await expect(bar.locator('[title="Font Size (px)"] input')).toHaveValue('27');
  await page.screenshot({path:path.join(os.tmpdir(),'noteboard-text-scaling.png')});
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Open Text scale',exact:true}).click();
  await node.click();await expect(bar.getByRole('button',{name:'Text scaling',exact:true})).toHaveAttribute('aria-pressed','true');
  expect((await geometry(page)).ranges.length).toBe(before.ranges.length);
  const scaled=await geometry(page);
  await page.getByRole('button',{name:'Open text settings',exact:true}).click();
  const top=page.locator('[data-toolbar-item="text"] .toolbar-dropdown');
  await expect(top.getByRole('button',{name:'Text scaling',exact:true})).toHaveAttribute('aria-pressed','true');
  await top.getByRole('button',{name:'Text scaling',exact:true}).click();
  await page.getByRole('button',{name:'Open text settings',exact:true}).click();
  expect(await geometry(page)).toEqual(scaled);
  const edge=(await node.locator('.cursor-e-resize').boundingBox())!;
  const bounds=(await node.boundingBox())!;
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2-150,edge.y+edge.height/2,{steps:8});await page.mouse.up();
  expect((await node.boundingBox())!.height).toBeCloseTo(bounds.height,0);
  expect((await geometry(page)).ranges.length).toBeGreaterThan(scaled.ranges.length);
  await page.getByRole('button',{name:'Text Tool',exact:true}).click();
  const editor=page.locator('[data-board-element-editor-id="scaled"]');
  await editor.getByText('bravo',{exact:true}).dblclick();
  await bar.locator('[title="Text Color"] input[type="color"]').fill('#22c55e');
  await expect(editor.locator('b span')).toHaveCSS('color','rgb(34, 197, 94)');
  await page.getByRole('button',{name:'Select Tool',exact:true}).click();await node.click();
  await bar.getByRole('button',{name:'Duplicate',exact:true}).click();
  const fields=page.locator('[data-board-element-type="text"]');await expect(fields).toHaveCount(2);
  for(const value of await fields.locator('[data-text-scale-shell]').evaluateAll(items=>items.map(item=>Number(item.getAttribute('data-text-scale-shell'))))) expect(value).toBeCloseTo(1.5,10);
  expect(errors).toEqual([]);
});
