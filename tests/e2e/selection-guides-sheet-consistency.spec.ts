import { test, expect, type Page } from './test';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import { createWorkbookDocument } from '../../src/features/spreadsheet/workbook';

const board = (id: string, elements: any[] = [], settings = {}) => ({
  id, title:id, width:1300,height:850,boardX:64,boardY:0,
  workspaceWidth:1800,workspaceHeight:1200,viewportCenterX:704,viewportCenterY:388,
  zoom:1,updatedAt:Date.now(),elements,
  editorSettings:{activeTool:'select',keepToolActive:true,enableObjectSnapping:false,
    isSelectionLockEnabled:true,selectionLockTime:400,...settings},
});
const box = (id:string,x:number,y:number) => ({id,type:'rectangle',position:{x,y},size:{width:80,height:60},content:'',color:'#dbeafe',zIndex:1});
async function open(page:Page,request:any,data:any) {
  const response = await request.post('/api/pages',{data:[data]});
  expect(response.ok(), await response.text()).toBe(true);
  await page.goto('/');await page.getByRole('button',{name:`Open ${data.id}`,exact:true}).click();
}

for (const mode of ['polygon','lasso']) for (const preview of ['translucent','realistic']) {
  test(`${mode} ${preview} respects Lock in time, cancels early releases and rebases the anchor`,async({page,request})=>{
    await open(page,request,board(`lock-${mode}-${preview}`,[box('box',200,220)],{selectMode:mode,previewMode:preview==='translucent'?'box':'realistic'}));
    const root=(await page.locator('[data-board-root]').boundingBox())!;
    const move=async(x:number,y:number)=>page.mouse.move(root.x+x,root.y+y);
    await move(80,120);await page.mouse.down();await move(110,140);await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-selection-outline],[data-selection-region="committed"]')).toHaveCount(0);
    await move(80,120);await page.mouse.down();await move(110,140);
    await expect(page.locator('[data-selection-outline]')).toHaveCount(0);
    await expect(page.locator('[data-selection-outline]')).toBeVisible();
    const path=page.locator('[data-selection-outline] path');
    expect(await path.getAttribute('d')).toMatch(/^M110,140/);
    if(mode==='polygon') {
      await page.mouse.up();
      for(const [x,y] of [[400,140],[400,400],[110,400]])await page.mouse.click(root.x+x,root.y+y);
      await expect(page.locator('[data-selection-region="committed"]')).toHaveCount(0);
      expect(await path.getAttribute('d')).not.toContain('Z');
      await page.mouse.click(root.x+110,root.y+140);
    } else {
      for(const [x,y] of [[400,140],[400,400],[110,400],[110,140]])await page.mouse.move(root.x+x,root.y+y,{steps:6});
      await page.mouse.up();
    }
    await expect(page.locator('[data-selection-region="committed"][data-selection-shape="outline"]')).toBeVisible();
    await expect(page.locator('[data-selection-outline]')).toHaveCount(0);
    // A new waiting gesture is genuinely cancelled by Escape, not a delayed path.
    await move(600,140);await page.mouse.down();await page.keyboard.press('Escape');await page.waitForTimeout(500);await page.mouse.up();
    await expect(page.locator('[data-selection-outline]')).toHaveCount(0);
    await page.getByRole('button',{name:'Select settings',exact:true}).click();
    await page.locator('[data-select-setting-toggle="lock-time"]').click();
    await page.getByRole('button',{name:'Select settings',exact:true}).click();
    await move(100,130);await page.mouse.down();
    if(mode==='polygon') {
      await page.mouse.up();
      await expect(page.locator('[data-selection-outline] circle')).toHaveCount(1);
    } else {
      await move(200,130);await expect(page.locator('[data-selection-outline]')).toBeVisible();await page.mouse.up();
    }
    await page.keyboard.press('Escape');
  });
}

test('alignment distances work diagonally and beyond 320 px, and belong only to General Settings',async({page,request})=>{
  await open(page,request,board('spacing-settings',[box('a',100,160),box('b',600,440)],{isSelectionLockEnabled:false,toolbarLayout:{order:['select','crop','eyedropper','more'],more:['crop','eyedropper']}}));
  await page.getByRole('button',{name:'More',exact:true}).click();
  await expect(page.locator('[data-more-toolbar-item="crop"],[data-more-toolbar-item="eyedropper"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Smart guides',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'More',exact:true}).click();
  const a=page.locator('[data-board-element-id="a"]'),b=page.locator('[data-board-element-id="b"]');
  await a.click();await page.keyboard.down('Control');await b.hover();
  const guides=page.locator('[data-smart-guides]');
  await expect(guides).toContainText('420 px');await expect(guides).toContainText('220 px');
  await page.keyboard.up('Control');await expect(guides).toHaveCount(0);
  const bounds=(await a.boundingBox())!;
  await page.mouse.move(bounds.x+30,bounds.y+30);await page.mouse.down();
  await page.mouse.move(bounds.x+70,bounds.y+70,{steps:5});
  await expect(guides).toContainText('380 px');await expect(guides).toContainText('180 px');
  await page.mouse.up();await expect(guides).toHaveCount(0);
  await page.getByRole('button',{name:'General Settings',exact:true}).click();
  await page.getByRole('button',{name:'Alignment & spacing',exact:true}).click();
  await page.getByRole('button',{name:'Show alignment and spacing',exact:true}).click();
  await page.getByRole('button',{name:'General Settings',exact:true}).click();
  await page.keyboard.down('Control');await b.hover();await expect(guides).toHaveCount(0);await page.keyboard.up('Control');
  await expect.poll(async()=>{const data=await(await request.get('/api/pages')).json();return data.find((item:any)=>item.id==='spacing-settings')?.editorSettings.smartGuidesEnabled;}).toBe(false);
});

test('spreadsheet preview and selected cells have the same geometry and the expanded editor restores every menu',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const content=JSON.stringify(createWorkbookDocument('Budget',[['Item','Amount'],['Coffee',12],['Tea',8],['Total','=SUM(B2:B3)']]));
  await open(page,request,board('sheet-consistency',[{id:'sheet',type:'table',name:'Budget',position:{x:100,y:100},size:{width:650,height:430},content,zIndex:1}],{isSelectionLockEnabled:false}));
  const object=page.locator('[data-spreadsheet-object]');
  await expect(object.locator('[data-spreadsheet-preview]')).toBeVisible({timeout:30000});
  await expect(page.locator('iframe[title="Spreadsheet cells"]')).toHaveCount(0);
  const before=await object.screenshot(),beforeBounds=(await object.boundingBox())!;
  await object.click({position:{x:80,y:15}});
  const inline=page.locator('[data-spreadsheet-inline]');await expect(inline.getByRole('status')).toHaveCount(0,{timeout:30000});
  const cells=page.frameLocator('iframe[title="Spreadsheet cells"]');
  await expect(cells.locator('canvas[id^="univer-sheet-main-canvas_"]')).toBeVisible();
  const after=await object.screenshot();expect(await object.boundingBox()).toEqual(beforeBounds);
  const crop={left:48,top:80,width:590,height:340};
  const oldPixels=await sharp(before).extract(crop).raw().toBuffer(),newPixels=await sharp(after).extract(crop).raw().toBuffer();
  let changed=0;for(let i=0;i<oldPixels.length;i++)if(Math.abs(oldPixels[i]-newPixels[i])>8)changed++;
  expect(changed/oldPixels.length).toBeLessThan(0.005);
  const iframe=page.locator('iframe[title="Spreadsheet cells"]');
  await iframe.evaluate(frame=>(frame as HTMLIFrameElement).contentWindow!.name='same-session');
  await page.getByRole('button',{name:'Edit spreadsheet',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Spreadsheet editor'});await expect(dialog).toBeVisible();
  for(const name of ['Start','Insert','Formulas','Data','View'])await expect(cells.getByText(name,{exact:true}).first()).toBeVisible();
  await cells.getByText('Data',{exact:true}).first().click();
  for(const name of ['Sort','Data validation','Conditional Formatting'])await expect(cells.getByRole('button',{name,exact:true})).toBeVisible({timeout:15000});
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await expect(inline).toBeVisible();
  expect(await iframe.evaluate(frame=>(frame as HTMLIFrameElement).contentWindow!.name)).toBe('same-session');
  await expect(cells.getByText('Data',{exact:true})).toHaveCount(0);
  const panel=page.getByRole('complementary',{name:'Spreadsheet settings'});
  await panel.getByLabel('Cell value or formula').fill('Changed');await panel.getByRole('button',{name:'Apply to active cell',exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!;await page.mouse.click(root.x+20,root.y+600);
  await expect(object.locator('[data-spreadsheet-preview]')).toBeVisible({timeout:30000});
  await expect(page.locator('iframe[title="Spreadsheet cells"]')).toHaveCount(0);
  await object.click({position:{x:80,y:15}});await expect(page.locator('[data-spreadsheet-inline]').getByRole('status')).toHaveCount(0,{timeout:30000});
  await expect.poll(()=>iframe.evaluate(frame=>JSON.parse(((frame as HTMLIFrameElement).contentWindow as any).noteboardSheet.snapshot()).workbook.sheets['sheet-1'].cellData[0][0].v)).toBe('Changed');
  expect(errors).toEqual([]);
});

test('a scrolled spreadsheet retains the visible rows on selection and never takes canvas Undo focus',async({page,request})=>{
  const content=JSON.stringify(createWorkbookDocument('Scroll',Array.from({length:40},(_,r)=>[`Row ${r+1}`,r])));
  await open(page,request,board('sheet-scroll-consistency',[{id:'sheet',type:'table',position:{x:100,y:100},size:{width:650,height:430},content,zIndex:1}],{isSelectionLockEnabled:false}));
  const object=page.locator('[data-spreadsheet-object]');
  await expect(object.locator('[data-spreadsheet-preview]')).toBeVisible({timeout:30000});
  await object.click({position:{x:80,y:15}});
  await expect(page.locator('[data-spreadsheet-inline]').getByRole('status')).toHaveCount(0,{timeout:30000});
  const iframe=page.locator('iframe[title="Spreadsheet cells"]');
  const view=()=>iframe.evaluate(f=>JSON.parse(((f as HTMLIFrameElement).contentWindow as any).noteboardSheet.snapshot()).views?.['sheet-1']);
  const grid=page.frameLocator('iframe[title="Spreadsheet cells"]').locator('canvas[id^="univer-sheet-main-canvas_"]');
  await grid.click({position:{x:200,y:100}});
  // Keyboard navigation scrolls through Univer's public input path and is
  // deterministic across host wheel routing and iframe device scaling.
  for (let row = 0; row < 40; row++) await page.keyboard.press('ArrowDown');
  await expect.poll(async()=>(await view())?.sheetViewStartRow??0).toBeGreaterThan(0);
  const previous=await view();
  const root=(await page.locator('[data-board-root]').boundingBox())!;
  await page.mouse.click(root.x+10,root.y+600);
  await expect(object.locator('[data-spreadsheet-preview]')).toBeVisible({timeout:30000});
  await expect(page.locator('iframe[data-spreadsheet-element-id]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe('IFRAME');
  await expect(page.getByRole('button',{name:'Undo (Ctrl+Z)',exact:true})).toBeDisabled();
  await object.click({position:{x:80,y:15}});
  await expect(page.locator('[data-spreadsheet-inline]').getByRole('status')).toHaveCount(0,{timeout:30000});
  await expect.poll(view).toEqual(previous);
  await page.mouse.click(root.x+10,root.y+600);
  await page.keyboard.press('Control+z');
  await expect(object).toHaveCount(1);
});

test('switching worksheet in the full editor preserves that worksheet and its dimensions on the board',async({page,request})=>{
  const doc=createWorkbookDocument('Multi',[['First']],{width:80,height:28});
  doc.workbook.sheets!['sheet-2']={...structuredClone(doc.workbook.sheets!['sheet-1']),id:'sheet-2',name:'Second',defaultColumnWidth:120,defaultRowHeight:32,cellData:{0:{0:{v:'Second'}}}};
  doc.workbook.sheetOrder!.push('sheet-2');
  await open(page,request,board('sheet-tabs-consistency',[{id:'sheet',type:'table',position:{x:100,y:100},size:{width:650,height:430},content:JSON.stringify(doc),zIndex:1}],{isSelectionLockEnabled:false}));
  const object=page.locator('[data-spreadsheet-object]');await object.click({position:{x:80,y:15}});
  await expect(page.locator('[data-spreadsheet-inline]').getByRole('status')).toHaveCount(0,{timeout:30000});
  await page.getByRole('button',{name:'Edit spreadsheet',exact:true}).click();
  const cells=page.frameLocator('iframe[title="Spreadsheet cells"]');
  await cells.getByText('Second',{exact:true}).click();
  await page.getByRole('dialog',{name:'Spreadsheet editor'}).getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByLabel('Cell width',{exact:true})).toHaveValue('120');
  await expect(page.getByLabel('Cell height',{exact:true})).toHaveValue('32');
  const root=(await page.locator('[data-board-root]').boundingBox())!;await page.mouse.click(root.x+10,root.y+600);
  await expect(object.locator('[data-spreadsheet-preview]')).toBeVisible({timeout:30000});
  await expect(page.getByRole('button',{name:'Undo (Ctrl+Z)',exact:true})).toBeDisabled();
  await object.click({position:{x:80,y:15}});await expect(page.locator('[data-spreadsheet-inline]').getByRole('status')).toHaveCount(0,{timeout:30000});
  await expect(page.getByLabel('Cell width',{exact:true})).toHaveValue('120');
  await expect.poll(()=>page.locator('iframe[title="Spreadsheet cells"]').evaluate(f=>JSON.parse(((f as HTMLIFrameElement).contentWindow as any).noteboardSheet.snapshot()).activeSheetId)).toBe('sheet-2');
});

test('opening and exporting an unchanged workbook retains calculated results without a phantom canvas Undo',async({page,request})=>{
  const doc=createWorkbookDocument('Calculation',[[12],[8],['=SUM(A1:A2)']]);
  await open(page,request,board('sheet-export-no-edit',[{id:'sheet',type:'table',position:{x:100,y:100},size:{width:650,height:430},content:JSON.stringify(doc),zIndex:1}],{isSelectionLockEnabled:false}));
  await page.locator('[data-spreadsheet-object]').click({position:{x:80,y:15}});
  await expect(page.locator('[data-spreadsheet-inline]').getByRole('status')).toHaveCount(0,{timeout:30000});
  await page.getByRole('button',{name:'Edit spreadsheet',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Spreadsheet editor'});
  const downloadPromise=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Export XLSX',exact:true}).click();
  const download=await downloadPromise, exported=new ExcelJS.Workbook();
  await exported.xlsx.load(await fs.readFile((await download.path())!));
  expect(exported.worksheets[0].getCell('A3').result).toBe(20);
  await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button',{name:'Undo (Ctrl+Z)',exact:true})).toBeDisabled();
});
