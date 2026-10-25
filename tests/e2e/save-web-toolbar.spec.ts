import { deleteFixtureBoard } from './fixture-storage';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';

const fixture = () => ({ id:'save-source', title:'Save source', version:3, width:1000, height:700, workspaceWidth:5000, workspaceHeight:5000, boardX:2000, boardY:2200, viewportCenterX:2500, viewportCenterY:2500, updatedAt:Date.now(), isPinned:false,
  editorSettings:{activeTool:'text',keepToolActive:true,enableObjectSnapping:false},
  elements:[
    {id:'text',type:'text',position:{x:100,y:100},size:{width:250,height:90},content:'Original words',zIndex:1},
    {id:'section',type:'section',position:{x:400,y:50},size:{width:320,height:240},content:'',zIndex:-1},
    {id:'child',type:'text',parentId:'section',linkToId:'text',position:{x:440,y:120},size:{width:160,height:80},content:'<a href="#target-text">Linked text</a>',zIndex:2},
  ],
});
async function open(page: Page, request: APIRequestContext) {
  const pages=await (await request.get('/api/pages')).json();
  for(const item of pages) await deleteFixtureBoard(request, `/api/pages/${item.id}`);
  const presets=await (await request.get('/api/presets')).json();
  for(const preset of presets) await request.patch('/api/presets',{data:{type:'delete',id:preset.id}});
  await request.post('/api/pages',{data:[fixture()]});
  await page.goto('/'); await page.getByRole('button',{name:'Open Save source',exact:true}).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
}

test('Save as persists a template, an independent board and a portable file from live content', async ({page,request}) => {
  await open(page,request);
  await page.locator('[data-board-element-editor-id="text"]').fill('Fresh unsaved words');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Save as',exact:true});
  await dialog.getByLabel('Save as name').fill('Saved specimen');
  await dialog.getByRole('button',{name:'Save as Template',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText('Template saved.');
  const presets=await (await request.get('/api/presets')).json();
  expect(presets).toHaveLength(1); expect(presets[0].name).toBe('Saved specimen');
  expect(presets[0].elements.find((e:any)=>e.id==='text').content).toContain('Fresh unsaved words');
  await dialog.getByRole('button',{name:'Save as New Board',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText('New board saved in My Noteboards.');
  const boards=await (await request.get('/api/pages')).json();
  const copy=boards.find((p:any)=>p.title==='Saved specimen');
  expect(copy.id).not.toBe('save-source'); expect(copy.elements).toHaveLength(3);
  const child=copy.elements.find((e:any)=>e.parentId);
  expect(copy.elements.some((e:any)=>e.id===child.parentId)).toBe(true);
  expect(copy.elements.some((e:any)=>e.id===child.linkToId)).toBe(true);
  expect(copy.elements.every((e:any)=>!['text','section','child'].includes(e.id))).toBe(true);
  const downloadPromise=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Save as File',exact:true}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('Saved_specimen_noteboard.zip');
  const zip=await JSZip.loadAsync(await fs.readFile((await download.path())!));
  const manifest=JSON.parse(await zip.file('board.json')!.async('string'));
  expect(manifest.title).toBe('Saved specimen');
  expect(manifest.elements.find((e:any)=>e.id==='text').content).toContain('Fresh unsaved words');
  await dialog.getByRole('button',{name:'Close save dialog'}).click();
  await expect(page.locator('header input').first()).toHaveValue('Save source');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open Saved specimen'})).toBeVisible();
});

test('failed Save as actions report failure and allow retry without duplicate copies', async ({page,request}) => {
  await open(page,request);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Save as',exact:true});
  await dialog.getByLabel('Save as name').fill('Retry specimen');
  await page.route('**/api/pages/*', async route => {
    if(route.request().method()==='PUT' && route.request().postDataJSON()?.title==='Retry specimen') await route.fulfill({status:500,body:'Test write failure'});
    else await route.continue();
  });
  await dialog.getByRole('button',{name:'Save as New Board'}).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await page.unroute('**/api/pages/*');
  await dialog.getByRole('button',{name:'Save as New Board'}).click();
  await expect(dialog.getByRole('status')).toContainText('New board saved');
  await dialog.getByRole('button',{name:'Close save dialog'}).click();
  await page.reload();
  await expect(page.getByRole('button',{name:'Open Retry specimen',exact:true})).toHaveCount(1);
});

test('Save as New Board reuses the same board after the disk write loses its response', async ({page,request}) => {
  await open(page,request);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Save as',exact:true});
  await dialog.getByLabel('Save as name').fill('Uncertain board copy');
  let loseAcknowledgment=true;
  await page.route('**/api/pages/*',async route=>{
    if(loseAcknowledgment&&route.request().method()==='PUT'&&route.request().postDataJSON()?.title==='Uncertain board copy'){
      loseAcknowledgment=false;
      await route.fetch();
      await route.abort();
      return;
    }
    await route.continue();
  });
  await dialog.getByRole('button',{name:'Save as New Board'}).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save');
  const afterLostAck=(await(await request.get('/api/pages')).json()).filter((item:any)=>item.title==='Uncertain board copy');
  expect(afterLostAck).toHaveLength(1);
  const originalId=afterLostAck[0].id;
  await page.unroute('**/api/pages/*');
  await dialog.getByRole('button',{name:'Save as New Board'}).click();
  await expect(dialog.getByRole('status')).toContainText('New board saved');
  const afterRetry=(await(await request.get('/api/pages')).json()).filter((item:any)=>item.title==='Uncertain board copy');
  expect(afterRetry.map((item:any)=>item.id)).toEqual([originalId]);
});

test('Save board preset stays open and retries the same template after a lost response', async ({page,request}) => {
  await open(page,request);
  await page.locator('[data-toolbar-item="more"] > button').click();
  const more=page.locator('[data-toolbar-item="more"] > .toolbar-dropdown');
  const presets=more.locator('[data-more-tool="object-presets"]');
  await presets.getByRole('button',{name:'Object Presets',exact:true}).click();
  await page.getByRole('button',{name:'Save board preset',exact:true}).click();
  await page.getByPlaceholder('My Custom Preset').fill('Uncertain preset');
  let loseAcknowledgment=true;
  await page.route('**/api/presets',async route=>{
    if(loseAcknowledgment&&route.request().method()==='PATCH'&&route.request().postDataJSON()?.type==='add'){
      loseAcknowledgment=false;
      await route.fetch();
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.getByRole('button',{name:'Save Preset',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Could not save templates.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry Save Preset',exact:true})).toBeVisible();
  const afterLostAck=(await(await request.get('/api/presets')).json()).filter((item:any)=>item.name==='Uncertain preset');
  expect(afterLostAck).toHaveLength(1);
  const originalId=afterLostAck[0].id;
  await page.unroute('**/api/presets');
  await page.getByRole('button',{name:'Retry Save Preset',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry Save Preset',exact:true})).toHaveCount(0);
  const afterRetry=(await(await request.get('/api/presets')).json()).filter((item:any)=>item.name==='Uncertain preset');
  expect(afterRetry.map((item:any)=>item.id)).toEqual([originalId]);
});

test('a template removed in another process does not block later template changes', async ({page,request}) => {
  const pages=await(await request.get('/api/pages')).json();
  for(const item of pages)await deleteFixtureBoard(request,`/api/pages/${item.id}`);
  const existing=(await(await request.get('/api/presets')).json()) as any[];
  for(const preset of existing)await request.patch('/api/presets',{data:{type:'delete',id:preset.id}});
  await request.patch('/api/presets',{data:{type:'add',preset:{id:'deleted-in-other-window',name:'First template',elements:[],isBuiltIn:false}}});
  await request.patch('/api/presets',{data:{type:'add',preset:{id:'surviving-template',name:'Second template',elements:[],isBuiltIn:false}}});
  await request.post('/api/pages',{data:[fixture()]});
  await page.goto('/');await page.getByRole('button',{name:'Open Save source',exact:true}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'New Noteboard',exact:true}).click();
  const names=page.locator('input[title="Edit name"]');await expect(names).toHaveCount(2);
  await request.patch('/api/presets',{data:{type:'delete',id:'deleted-in-other-window'}});
  await names.nth(0).fill('Stale rename');
  await expect(names).toHaveCount(1);
  await names.first().fill('Second template renamed');
  await expect.poll(async()=>(await(await request.get('/api/presets')).json()).find((item:any)=>item.id==='surviving-template')?.name).toBe('Second template renamed');
  expect((await(await request.get('/api/presets')).json()).map((item:any)=>item.id)).toEqual(['surviving-template']);
});

test('template names remain responsive and persist every character during slow writes', async ({page,request}) => {
  await open(page,request);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Save as'});
  await dialog.getByRole('button',{name:'Save as Template'}).click();
  await expect(dialog.getByRole('status')).toHaveText('Template saved.');
  await dialog.getByRole('button',{name:'Close save dialog'}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'New Noteboard',exact:true}).click();
  await page.route('**/api/presets',async route=>{
    if(route.request().method()==='PATCH') await new Promise(resolve=>setTimeout(resolve,40));
    await route.continue();
  });
  const name=page.locator('input[title="Edit name"]');
  await name.fill(''); await name.pressSequentially('Rapid template rename',{delay:2});
  await expect(name).toHaveValue('Rapid template rename');
  await expect.poll(async()=> (await (await request.get('/api/presets')).json())[0]?.name).toBe('Rapid template rename');
});

test('the separate scrollbar moves controls and preserves the shell through repeated resizing', async ({page,request}) => {
  await open(page,request);
  const bar=page.locator('[data-bottom-toolbar]');
  for(const width of [1900,800,650,1000,1900,650]) {
    await page.setViewportSize({width,height:850});
    await expect(bar).toHaveCSS('border-radius','16px');
    const scroller=bar.locator('.bottom-toolbar-scroll');
    const overflow=await scroller.evaluate(el=>el.scrollWidth>el.clientWidth+1);
    await expect(bar.locator('[data-property-scroll-row]')).toHaveCount(overflow?1:0);
    if(!overflow) continue;
    const control=bar.getByRole('scrollbar',{name:'Scroll element properties'});
    await control.focus(); await control.press('End');
    await expect.poll(()=>scroller.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    await control.press('Home');
    await expect.poll(()=>scroller.evaluate(el=>el.scrollLeft)).toBe(0);
    const box=(await control.boundingBox())!;
    await page.mouse.move(box.x+3,box.y+box.height/2); await page.mouse.down();
    await page.mouse.move(box.x+box.width-3,box.y+box.height/2,{steps:12}); await page.mouse.up();
    await expect.poll(()=>scroller.evaluate(el=>el.scrollLeft/(el.scrollWidth-el.clientWidth))).toBeGreaterThan(.9);
    const inner=(await control.boundingBox())!, outer=(await bar.boundingBox())!;
    expect(inner.x).toBeGreaterThan(outer.x+10); expect(inner.x+inner.width).toBeLessThan(outer.x+outer.width-10);
    const controls = (await scroller.boundingBox())!;
    const gapAbove = inner.y - (controls.y + controls.height);
    const gapBelow = outer.y + outer.height - 3 - (inner.y + inner.height);
    expect(Math.abs(gapAbove - gapBelow)).toBeLessThanOrEqual(1);
  }
});

test('More uses a small held handle and hides the native drag source over the green target', async ({page,request}) => {
  await open(page,request);
  await page.getByRole('button',{name:'More',exact:true}).click();
  const row=page.locator('[data-more-toolbar-item="embed"]');
  const handle=row.getByRole('button',{name:'Move Web to toolbar'});
  const handleBox=(await handle.boundingBox())!, rowBox=(await row.boundingBox())!;
  expect(handleBox.height/rowBox.height).toBeLessThanOrEqual(.8);
  await expect(handle).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await handle.click();
  await expect(row).not.toHaveAttribute('data-more-dragging','true');
  await expect(page.locator('[data-toolbar-item="embed"]')).toBeHidden();
  const target=(await page.locator('[data-toolbar-surface]').boundingBox())!;
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2); await page.mouse.down();
  await page.mouse.move(rowBox.x-25,rowBox.y+10,{steps:8});
  await expect(page.locator('[data-more-drag-ghost]')).toBeVisible();
  const ghost = page.locator('[data-more-drag-ghost]');
  const actualTool = page.locator('[data-toolbar-item="embed"]');
  await expect(ghost).toHaveText('');
  expect(await ghost.locator('svg').count()).toBe(await actualTool.locator('svg').count());
  expect((await ghost.boundingBox())!.width).toBeCloseTo((await actualTool.boundingBox())!.width * 1.03, 0);
  const ghostBox = (await ghost.boundingBox())!;
  expect(ghostBox.x + ghostBox.width / 2).toBeCloseTo(rowBox.x - 25, 0);
  expect(ghostBox.y + ghostBox.height / 2).toBeCloseTo(rowBox.y + 10, 0);
  await page.mouse.move(target.x+60,target.y+target.height/2,{steps:10}); await page.mouse.up();
  await expect(page.locator('[data-toolbar-item="embed"]')).toBeVisible();
  await expect(page.locator('[data-more-drag-ghost]')).toHaveCount(0);
  await page.getByRole('button',{name:'General Settings',exact:true}).click();
  await page.locator('[data-toolbar-editor-toggle]').click();
  const item=page.locator('[data-toolbar-item="embed"]'), more=page.locator('[data-toolbar-item="more"]');
  const itemBox=(await item.boundingBox())!, moreBox=(await more.boundingBox())!;
  await page.mouse.move(itemBox.x+itemBox.width/2,itemBox.y+itemBox.height/2); await page.mouse.down();
  await page.mouse.move(moreBox.x+moreBox.width/2,moreBox.y+moreBox.height/2,{steps:15});
  await page.mouse.move(moreBox.x+moreBox.width/2+1,moreBox.y+moreBox.height/2);
  await expect(more).toHaveAttribute('data-more-drop-active','true');
  await expect(item).toHaveCSS('opacity','0');
  expect((await more.boundingBox())!.x).toBeCloseTo(moreBox.x,0);
  await page.mouse.up(); await expect(item).toBeHidden();
});

test('the Web tool accepts a URL without enabling transforms and resolves YouTube embeds', async ({page,request}) => {
  await open(page,request);
  await page.route('https://www.youtube-nocookie.com/embed/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Embedded player fixture</h1>'}));
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('button',{name:'Web',exact:true}).click();
  const board=(await page.locator('[data-board-root]').boundingBox())!;
  await page.mouse.move(board.x+50,board.y+390); await page.mouse.down(); await page.waitForTimeout(300);
  await page.mouse.move(board.x+400,board.y+570,{steps:12}); await page.mouse.up();
  const field=page.locator('[data-board-element-type="embed"]');
  await expect(field.getByPlaceholder('Paste web link...')).toBeEnabled();
  await field.getByPlaceholder('Paste web link...').fill('https://youtu.be/M7lc1UVf-VE?t=90');
  await field.getByPlaceholder('Paste web link...').press('Enter');
  await expect(field.locator('iframe')).toHaveAttribute('src','https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=90');
  await expect(field.frameLocator('iframe').getByRole('heading')).toHaveText('Embedded player fixture');
  await expect(field.locator('[title="Rotate"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Select Tool',exact:true}).click();
  await field.click();
  const popupBlocker=page.locator('[data-bottom-toolbar]').getByRole('button',{name:'Block popups',exact:true});
  await popupBlocker.click();
  await expect(field.locator('iframe')).not.toHaveAttribute('sandbox',/allow-popups/);
  await popupBlocker.click();
  await expect(field.locator('iframe')).toHaveAttribute('sandbox',/allow-popups/);
});
