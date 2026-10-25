import { test,expect } from '@playwright/test';
import {createSimpleWorkbook} from '../../src/features/spreadsheet/simple-workbook';
import {deleteFixtureBoard} from './fixture-storage';
import ExcelJS from 'exceljs';

for(const input of [{name:'text',value:'Pending draft before reload',append:'!'},{name:'formula',value:'=1+2',append:'+3'}])
test(`an uncommitted spreadsheet ${input.name} survives a browsing-context reload before changed debounce`,async({page,request})=>{
 await page.addInitScript(() => {window.addEventListener('message',event=>{
  if(event.data?.source==='noteboard-sheet'&&event.data.type==='loaded')(window as any).__lastSheetLoaded=event.data;
 });});
 const id=`report-sheet-draft-${input.name}`;await deleteFixtureBoard(request,`/api/pages/${id}`);
 const workbook=createSimpleWorkbook(348,142,{width:100,height:24});
 workbook.workbook.sheets['sheet-1'].cellData={0:{0:{v:'',s:{bl:1,cl:{rgb:'#2255aa'}}}}};
 const board={id,title:id,version:4,width:1100,height:700,workspaceWidth:1500,workspaceHeight:1000,boardX:64,boardY:0,viewportCenterX:640,viewportCenterY:328,updatedAt:Date.now(),editorSettings:{activeTool:'select',keepToolActive:true},
 elements:[{id:'draft-sheet',type:'table',position:{x:160,y:200},size:{width:348,height:142},content:JSON.stringify(workbook),zIndex:1}]};
 expect((await request.post('/api/pages',{data:[board]})).ok()).toBeTruthy();
 try {
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  await page.locator('[data-board-element-id="draft-sheet"]').click();
  const iframe=page.locator('iframe[title="Spreadsheet cells"]');
  const grid=page.frameLocator('iframe[title="Spreadsheet cells"]').locator('canvas[id^="univer-sheet-main-canvas_"]');
  await expect(grid).toBeVisible();await grid.click({position:{x:90,y:32}});await page.keyboard.type(input.value);
  const value=async()=>{try{return await iframe.evaluate(frame=>{
   const api=(frame as HTMLIFrameElement).contentWindow as any;
   const snapshot=JSON.parse(api?.noteboardSheet?.snapshot?.()||'null');
   const cell=snapshot?.workbook?.sheets?.['sheet-1']?.cellData?.[0]?.[0];return cell?.f??cell?.v;
  });}catch{return undefined;}};
  await expect.poll(value).toBe(input.value);
  const oldGeneration=await page.evaluate(()=>(window as any).__lastSheetLoaded);
  await iframe.evaluate(frame=>(frame as HTMLIFrameElement).contentWindow!.location.reload());
  await expect.poll(value,{timeout:15000}).toBe(input.value);
  await expect.poll(()=>page.evaluate(()=>(window as any).__lastSheetLoaded?.documentId)).not.toBe(oldGeneration.documentId);
  await expect(page.getByText('Opening spreadsheet…',{exact:true})).toHaveCount(0);
  await page.keyboard.type(input.append);
  await expect.poll(value).toBe(input.value+input.append);
  await page.evaluate(({old,content})=>{
   const frame=document.querySelector('iframe[title="Spreadsheet cells"]') as HTMLIFrameElement;
   window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{...old,type:'changed',content}}));
  },{old:oldGeneration,content:board.elements[0].content});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(null)))));
  await expect.poll(value).toBe(input.value+input.append);
  expect(await iframe.evaluate(frame=>{
    const snapshot=JSON.parse(((frame as HTMLIFrameElement).contentWindow as any).noteboardSheet.snapshot());
    const style=snapshot.workbook.sheets['sheet-1'].cellData[0][0].s;
    return (typeof style==='string'?snapshot.workbook.styles[style]:style)?.bl;
  })).toBe(1);
 }finally{await deleteFixtureBoard(request,`/api/pages/${id}`);}
});

test('Main Board movement uses screen pixels at 50, 100 and 200 percent with one Undo step',async({page,request})=>{
 for(const zoom of [0.5,1,2]) {
  const id=`report-move-${zoom*100}`;await deleteFixtureBoard(request,`/api/pages/${id}`);
  expect((await request.post('/api/pages',{data:[{id,title:id,version:4,width:800,height:500,workspaceWidth:3000,workspaceHeight:2000,boardX:100,boardY:70,viewportCenterX:640,viewportCenterY:328,zoom,updatedAt:Date.now(),elements:[],editorSettings:{activeTool:'board',toolMenuSettingsOverrides:{grid:{allowMoving:true}}}}]})).ok()).toBeTruthy();
  try {
   await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
   await page.getByRole('button',{name:'Open Layers Panel',exact:true}).click();
   await page.getByText('Main Board',{exact:true}).click();
   await page.getByRole('button',{name:'Open Layers Panel',exact:true}).click();
   const handle=page.getByText('Drag to Move Board',{exact:true});await expect(handle).toBeVisible();
   const target=page.locator('#main-board'),before=(await target.boundingBox())!,box=(await handle.boundingBox())!;
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   await page.mouse.move(box.x+box.width/2+100,box.y+box.height/2+60,{steps:8});await page.mouse.up();
   await expect.poll(async()=>Math.round((await target.boundingBox())!.x-before.x)).toBe(100);
   await expect.poll(async()=>Math.round((await target.boundingBox())!.y-before.y)).toBe(60);
   await page.getByRole('button',{name:'Undo (Ctrl+Z)',exact:true}).click();
   await expect.poll(async()=>Math.round((await target.boundingBox())!.x-before.x)).toBe(0);
   await page.getByRole('button',{name:'Redo (Ctrl+Y)',exact:true}).click();
   await expect.poll(async()=>Math.round((await target.boundingBox())!.x-before.x)).toBe(100);
  }finally{await deleteFixtureBoard(request,`/api/pages/${id}`);}
 }
});

test('editable Simple spreadsheets import XLSX sheets without replacing existing cells',async({page,request})=>{
 const id='report-simple-import';await deleteFixtureBoard(request,`/api/pages/${id}`);
 const document=createSimpleWorkbook(348,142,{width:100,height:24});document.workbook.sheets['sheet-1'].cellData={0:{0:{v:'Keep original'}}};
 expect((await request.post('/api/pages',{data:[{id,title:id,version:4,width:1100,height:700,updatedAt:Date.now(),elements:[{id:'simple-import',type:'table',position:{x:160,y:200},size:{width:348,height:142},content:JSON.stringify(document),zIndex:1}]}]})).ok()).toBeTruthy();
 try {
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();await page.locator('[data-board-element-id="simple-import"]').click();
  await expect(page.getByRole('button',{name:'Import sheets',exact:true})).toBeVisible();
  const imported=new ExcelJS.Workbook();imported.addWorksheet('Imported').getCell('A1').value='Imported value';
  const bytes=Buffer.from(await imported.xlsx.writeBuffer());
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Import sheets',exact:true}).click();
  await(await chooser).setFiles({name:'import.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
  const snapshot=()=>page.locator('iframe[title="Spreadsheet cells"]').evaluate(frame=>JSON.parse(((frame as HTMLIFrameElement).contentWindow as any).noteboardSheet.snapshot()));
  await expect.poll(async()=>(await snapshot()).workbook.sheetOrder.length).toBe(2);
  const result=await snapshot();expect(result.mode).toBe('simple');expect(result.workbook.sheets['sheet-1'].cellData[0][0].v).toBe('Keep original');
  expect(Object.values(result.workbook.sheets).some((sheet:any)=>sheet.cellData?.[0]?.[0]?.v==='Imported value')).toBeTruthy();
  const tsvChooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Import sheets',exact:true}).click();
  await(await tsvChooser).setFiles({name:'single-heading.tsv',mimeType:'text/tab-separated-values',buffer:Buffer.from('Heading, with punctuation\n1\t2\n')});
  await expect.poll(async()=>(await snapshot()).workbook.sheetOrder.length).toBe(3);
  const withTsv=await snapshot();
  expect(withTsv.workbook.sheets['sheet-1'].cellData[0][0].v).toBe('Keep original');
  expect(Object.values(withTsv.workbook.sheets).some((sheet:any)=>sheet.cellData?.[0]?.[0]?.v==='Heading, with punctuation'&&sheet.cellData?.[1]?.[0]?.v===1&&sheet.cellData?.[1]?.[1]?.v===2)).toBeTruthy();
  await page.getByRole('button',{name:'Draw',exact:true}).click();
  await expect(page.getByRole('button',{name:'Import sheets',exact:true})).toHaveCount(0);
 }finally{await deleteFixtureBoard(request,`/api/pages/${id}`);}
});

test('a valid 200000-point drawing renders alongside unrelated elements',async({page,request})=>{
 const id='report-large-drawing';await deleteFixtureBoard(request,`/api/pages/${id}`);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const points=Array.from({length:200_000},(_,index)=>({x:index%200,y:Math.floor(index/200)%200}));
 expect((await request.post('/api/pages',{data:[{id,title:id,version:4,width:1100,height:700,updatedAt:Date.now(),elements:[
  {id:'huge',type:'draw',position:{x:50,y:50},size:{width:250,height:250},points,content:'',color:'#000000',borderWidth:2,zIndex:1},
  {id:'companion',type:'text',position:{x:400,y:100},size:{width:220,height:60},content:'Stable companion',zIndex:2}
 ]}]})).ok()).toBeTruthy();
 try{await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
  await expect(page.locator('[data-board-element-id="huge"] svg').first()).toHaveAttribute('viewBox','0 0 199 199');
  await expect(page.locator('[data-board-element-editor-id="companion"]')).toContainText('Stable companion');expect(errors).toEqual([]);
 }finally{await deleteFixtureBoard(request,`/api/pages/${id}`);}
});
