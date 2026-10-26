import {test,expect,type Page} from './test';

const seed=(title:string,tool='select',elements:any[]=[],settings={})=>({id:title.toLowerCase().replace(/[^a-z0-9_-]+/g,'-'),title,width:1100,height:700,boardX:64,boardY:0,workspaceWidth:1500,workspaceHeight:1000,viewportCenterX:640,viewportCenterY:328,zoom:1,updatedAt:Date.now(),elements,editorSettings:{activeTool:tool,keepToolActive:true,enableObjectSnapping:false,smartGuidesEnabled:false,...settings}});
const shape=(id:string,x:number,y:number,more={})=>({id,type:'rectangle',position:{x,y},size:{width:80,height:60},content:'',color:'#dbeafe',zIndex:1,...more});
async function drag(page:Page,from:{x:number;y:number},to:{x:number;y:number},hold=300){
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  if(hold)await page.waitForTimeout(hold);
  await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
}
async function clickAreaAction(page:Page,name:string){
  const button=page.getByRole('button',{name,exact:true});await expect(button).toBeVisible();
  const box=(await button.boundingBox())!;await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
}

test('marquee selection still starts when dragging over a full-board raster fill',async({page,request})=>{
  const content='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff0000"/></svg>').toString('base64');
  const data={...seed('Filled board marquee','select',[
    {id:'background-fill',type:'image',position:{x:0,y:0},size:{width:700,height:500},content,isPixelFill:true,pixelFillBoardId:'main-board',zIndex:1},
    shape('marquee-target',200,170,{zIndex:2}),
  ],{isSelectionLockEnabled:false}),width:700,height:500,boardX:0,boardY:0,workspaceWidth:1400,workspaceHeight:900,viewportCenterX:600,viewportCenterY:350};
  await request.post('/api/pages',{data:[data]});
  await page.goto('/');await page.getByRole('button',{name:'Open Filled board marquee',exact:true}).click();
  const fill=page.locator('[data-board-element-id="background-fill"]');
  const before=(await fill.boundingBox())!;
  const shapeBefore=await page.locator('[data-board-element-id="marquee-target"]').boundingBox();
  await drag(page,{x:before.x+100,y:before.y+100},{x:before.x+300,y:before.y+250},0);
  await expect(page.locator('[data-selection-area-toolbar="true"]')).toBeVisible();
  expect(await fill.boundingBox()).toEqual(before);
  expect(await page.locator('[data-board-element-id="marquee-target"]').boundingBox()).toEqual(shapeBefore);
});

test('moving a pixel fill to another board updates its owner and remains visible',async({page,request})=>{
  const content='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff0000"/></svg>').toString('base64');
  const data={...seed('Pixel fill board move','select',[
    {id:'lower-layer',type:'layer',position:{x:0,y:0},name:'Lower',content:'',zIndex:1},
    {id:'upper-layer',type:'layer',position:{x:0,y:0},name:'Upper',content:'',zIndex:10},
    {id:'raster-under',type:'image',parentId:'lower-layer',position:{x:220,y:180},size:{width:80,height:60},content,isPixelFill:true,pixelFillBoardId:'main-board',zIndex:100},
    {id:'raster-fill',type:'image',parentId:'upper-layer',position:{x:220,y:180},size:{width:80,height:60},content,isPixelFill:true,pixelFillBoardId:'main-board',zIndex:1},
    {id:'destination-board',type:'board',position:{x:900,y:100},size:{width:260,height:240},content:'',zIndex:-2},
  ]),width:700,height:500,boardX:0,boardY:0,workspaceWidth:1800,workspaceHeight:900,viewportCenterX:600,viewportCenterY:350};
  await request.post('/api/pages',{data:[data]});
  await page.goto('/');await page.getByRole('button',{name:'Open Pixel fill board move',exact:true}).click();
  const fill=page.locator('[data-board-element-id="raster-fill"]');
  const destination=page.locator('[data-board-element-id="destination-board"]');
  await expect(fill).toBeVisible();await expect(destination).toBeVisible();
  const source=(await fill.boundingBox())!,target=(await destination.boundingBox())!;
  await page.mouse.click(source.x+source.width/2,source.y+source.height/2);
  await expect(fill.locator('.ring-blue-500')).toBeVisible();
  await drag(page,{x:source.x+source.width/2,y:source.y+source.height/2},{x:target.x+target.width/2,y:target.y+target.height/2},0);
  await expect.poll(async()=>{
    const response=await request.get('/api/pages');
    const pages=await response.json() as Array<{id:string;elements:Array<{id:string;pixelFillBoardId?:string}>}>;
    return pages.find(item=>item.id===data.id)?.elements.find(element=>element.id==='raster-fill')?.pixelFillBoardId;
  }).toBe('destination-board');
  const saved=await request.get('/api/pages');
  const pages=await saved.json() as Array<{id:string;elements:Array<{id:string;pixelFillBoardId?:string}>}>;
  expect(pages.find(item=>item.id===data.id)?.elements.find(element=>element.id==='raster-under')?.pixelFillBoardId).toBe('main-board');
  const moved=(await fill.boundingBox())!;
  expect(moved.x).toBeGreaterThan(target.x);
  expect(moved.x+ moved.width).toBeLessThanOrEqual(target.x+target.width+1);
});

for(const tool of ['ellipse','line','rectangle','section'])test(`${tool} uses Lock in time for both previews and placement`,async({page,request})=>{
  await request.post('/api/pages',{data:[seed(`Lock ${tool}`,tool,[],{isSelectionLockEnabled:true,selectionLockTime:400})]});
  await page.goto('/');await page.getByRole('button',{name:`Open Lock ${tool}`,exact:true}).click();
  const board=(await page.locator('[data-board-root]').boundingBox())!;
  const start={x:board.x+120,y:board.y+140},end={x:board.x+300,y:board.y+260};
  await page.mouse.click(start.x,start.y);await expect(page.locator(`[data-board-element-type="${tool}"]`)).toHaveCount(0);
  await drag(page,start,end,0);await expect(page.locator(`[data-board-element-type="${tool}"]`)).toHaveCount(0);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.waitForTimeout(440);await page.mouse.move(end.x,end.y,{steps:8});
  await page.mouse.up();await expect(page.locator(`[data-board-element-type="${tool}"]`)).toHaveCount(1);
  await page.keyboard.press('Control+z');await expect(page.locator(`[data-board-element-type="${tool}"]`)).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');await expect(page.locator(`[data-board-element-type="${tool}"]`)).toHaveCount(1);
});

for(const previewMode of ['box','realistic'])test(`Alt cropping records one undoable action with ${previewMode} preview`,async({page,request})=>{
  const content='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>').toString('base64');
  await request.post('/api/pages',{data:[seed(`Alt crop ${previewMode}`,'select',[{id:'photo',type:'image',position:{x:100,y:140},size:{width:320,height:180},content,zIndex:1,keepRatio:true}],{previewMode})]});
  await page.goto('/');await page.getByRole('button',{name:`Open Alt crop ${previewMode}`,exact:true}).click();
  const image=page.locator('[data-board-element-id="photo"]');await image.click();const before=(await image.boundingBox())!;
  await page.keyboard.down('Alt');const handle=(await image.locator('[data-resize-handle="e"]').boundingBox())!;
  await drag(page,{x:handle.x+handle.width/2,y:handle.y+handle.height/2},{x:handle.x+handle.width/2-80,y:handle.y+handle.height/2},0);
  await page.keyboard.up('Alt');expect((await image.boundingBox())!.width).toBeCloseTo(before.width-80,0);
  await page.keyboard.press('Control+z');expect((await image.boundingBox())!.width).toBeCloseTo(before.width,0);
  await page.keyboard.press('Control+Shift+z');expect((await image.boundingBox())!.width).toBeCloseTo(before.width-80,0);
});

test('small handles scale with visible object size and the board name saves automatically',async({page,request})=>{
  await page.setViewportSize({width:880,height:720});
  await request.post('/api/pages',{data:[seed('Compact handles','select',[shape('small',120,160,{size:{width:24,height:24}}),shape('large',300,180)])]});
  await page.goto('/');await page.getByRole('button',{name:'Open Compact handles',exact:true}).click();
  const small=page.locator('[data-board-element-id="small"]');await small.click();
  const smallHandle=(await small.locator('[data-resize-handle="se"]').boundingBox())!;
  await page.locator('[data-board-element-id="large"]').click();const largeHandle=(await page.locator('[data-board-element-id="large"] [data-resize-handle="se"]').boundingBox())!;
  expect(smallHandle.width).toBeLessThan(largeHandle.width);
  await page.getByRole('textbox',{name:'Board name',exact:true}).fill('Updated board name');
  const row=(await page.getByRole('textbox',{name:'Board name',exact:true}).boundingBox())!;
  expect(row.x).toBeGreaterThanOrEqual(0);expect(row.x+row.width).toBeLessThanOrEqual(880);
  await expect(page.getByRole('button',{name:'Save title',exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Board name',exact:true}).press('Tab');
  await page.keyboard.press('Control+z');await expect(page.getByRole('textbox',{name:'Board name',exact:true})).toHaveValue('Compact handles');
  await page.keyboard.press('Control+Shift+z');await expect(page.getByRole('textbox',{name:'Board name',exact:true})).toHaveValue('Updated board name');
});

test('the selection bar copies editable objects and pastes the current clipboard into an area',async({page,request,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const elements=[shape('a',120,160),shape('b',260,160),shape('outside',750,100),shape('hidden',200,170,{isHidden:true})];
  await request.post('/api/pages',{data:[seed('Area clipboard','select',elements)]});
  await page.goto('/');await page.getByRole('button',{name:'Open Area clipboard',exact:true}).click();
  const board=(await page.locator('[data-board-root]').boundingBox())!;
  const select=async(x:number,y:number,w:number,h:number)=>drag(page,{x:board.x+x,y:board.y+y},{x:board.x+x+w,y:board.y+y+h});
  await select(80,130,310,130);await clickAreaAction(page,'Copy area');
  await expect.poll(()=>page.evaluate(async()=>{const items=await navigator.clipboard.read();return Promise.all(items.map(async item=>item.types.includes('text/html')?(await item.getType('text/html')).text():''));})).toContainEqual(expect.stringContaining('data-noteboard-clipboard'));
  await select(580,320,320,180);await clickAreaAction(page,'Paste into area');
  await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(5); // three visible originals plus two individually editable copies
  const copies=page.locator('[data-board-element-type="rectangle"]');
  for(const node of (await copies.all()).slice(-2)){const bounds=(await node.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(board.x+580-1);expect(bounds.x+bounds.width).toBeLessThanOrEqual(board.x+900+1);}
  await page.keyboard.press('Control+z');await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(3);
  await select(580,320,320,180);
  await page.evaluate(()=>navigator.clipboard.writeText('Latest external area text'));
  await clickAreaAction(page,'Paste into area');
  await expect(page.locator('[data-board-element-type="text"]')).toContainText('Latest external area text');
  await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(3);
});

test('an oversized clipboard paste reports its limit and the next ordinary paste remains usable',async({page,request})=>{
  await request.post('/api/pages',{data:[seed('Clipboard bounds','select',[shape('original',120,160)])]});
  await page.goto('/');await page.getByRole('button',{name:'Open Clipboard bounds',exact:true}).click();
  const board=(await page.locator('[data-board-root]').boundingBox())!;
  await drag(page,{x:board.x+500,y:board.y+320},{x:board.x+800,y:board.y+480});
  await page.evaluate(()=>{
    Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:async()=>[{
      types:['image/png'],getType:async()=>{
        const blob=new Blob(['small fixture'],{type:'image/png'});
        Object.defineProperty(blob,'size',{value:64*1024*1024+1});return blob;
      },
    }]});
  });
  const dialogPromise=page.waitForEvent('dialog');
  const click=clickAreaAction(page,'Paste into area');
  const dialog=await dialogPromise;
  expect(dialog.message()).toContain('Clipboard media file exceeds the size limit');
  await dialog.dismiss();await click;
  await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(1);
  await expect(page.locator('[data-board-element-type="media"]')).toHaveCount(0);
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:async()=>[{
    types:['text/plain'],getType:async()=>new Blob(['Ordinary paste after limit'],{type:'text/plain'}),
  }]}));
  await clickAreaAction(page,'Paste into area');
  await expect(page.locator('[data-board-element-type="text"]')).toContainText('Ordinary paste after limit');
});

test('repeated external file drops work over text, empty Web fields and multiple-file targets',async({page,request})=>{
  await request.post('/api/pages',{data:[seed('Repeated drops','select',[
    {id:'text',type:'text',position:{x:100,y:120},size:{width:350,height:100},content:'Text target',zIndex:1},
    {id:'web',type:'embed',position:{x:550,y:120},size:{width:320,height:210},content:'',zIndex:2},
  ])]});
  await page.goto('/');await page.getByRole('button',{name:'Open Repeated drops',exact:true}).click();
  const drop=async(selector:string,count:number)=>{
    const data=await page.evaluateHandle(count=>{const transfer=new DataTransfer();for(let i=0;i<count;i++)transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>'],`image${i}.svg`,{type:'image/svg+xml'}));return transfer;},count);
    const target=page.locator(selector),bounds=(await target.boundingBox())!;
    await target.dispatchEvent('drop',{dataTransfer:data,clientX:bounds.x+20,clientY:bounds.y+20});await data.dispose();
  };
  await drop('[data-board-element-id="text"]',1);await expect(page.locator('[data-board-element-type="media"]')).toHaveCount(1);
  await drop('[data-board-element-id="web"]',1);await expect(page.locator('[data-board-element-type="media"]')).toHaveCount(2);
  await drop('[data-board-element-type="media"] >> nth=0',2);await expect(page.locator('[data-board-element-type="media"]')).toHaveCount(4);
  await page.keyboard.press('Control+z');await expect(page.locator('[data-board-element-type="media"]')).toHaveCount(2);
  await expect(page.locator('html')).not.toHaveAttribute('data-noteboard-file-drag','true');
});

test('Merge area creates one object and layer entry; move, copy, undo, reopen and ungroup preserve its members',async({page,request,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const elements=[
    {id:'layer-a',type:'layer',position:{x:0,y:0},content:'',zIndex:1},shape('a',120,160,{parentId:'layer-a'}),
    {id:'layer-b',type:'layer',position:{x:0,y:0},content:'',zIndex:2},shape('b',260,160,{parentId:'layer-b'}),
    shape('outside',750,100),
  ];
  await request.post('/api/pages',{data:[seed('Merge area','select',elements)]});
  await page.goto('/');await page.getByRole('button',{name:'Open Merge area',exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!;
  const a=page.locator('[data-board-element-id="a"]');
  const boardPosition=async(node:typeof a)=>node.evaluate(element=>{
    const surface=document.querySelector<HTMLElement>('[data-board-root="true"]');
    if(!surface)throw new Error('Board surface is unavailable.');
    const zoom=new DOMMatrixReadOnly(getComputedStyle(surface).transform).a;
    return {x:(element.getBoundingClientRect().x-surface.getBoundingClientRect().x)/zoom,zoom};
  });
  const before=await boardPosition(a);expect(before.zoom).toBeGreaterThan(0);
  await drag(page,{x:root.x+80,y:root.y+130},{x:root.x+390,y:root.y+260});
  await clickAreaAction(page,'Merge area');
  const group=page.locator('[data-board-element-type="group"]');await expect(group).toHaveCount(1);
  await expect(a).toHaveAttribute('data-board-element','false');expect((await boardPosition(a)).x).toBeCloseTo(before.x,0);
  await page.getByRole('button',{name:'Open Layers Panel',exact:true}).click();
  await expect(page.locator('[data-layer-tile-id="layer-a"]')).toHaveCount(0);await expect(page.locator('[data-layer-tile-id="layer-b"]')).toHaveCount(0);
  await expect(page.locator('[data-layer-tile-id]')).toHaveCount(2);
  await page.getByRole('button',{name:'Open Layers Panel',exact:true}).click();
  const box=(await group.boundingBox())!,zoom=(await boardPosition(a)).zoom;
  await drag(page,{x:box.x+20,y:box.y+20},{x:box.x+20+100*zoom,y:box.y+20+50*zoom},0);
  expect((await boardPosition(a)).x).toBeCloseTo(before.x+100,0);
  await page.keyboard.press('Control+z');expect((await boardPosition(a)).x).toBeCloseTo(before.x,0);
  await page.keyboard.press('Control+Shift+z');expect((await boardPosition(a)).x).toBeCloseTo(before.x+100,0);
  await group.click();await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');await expect(group).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Ungroup',exact:true})).toBeVisible();
  await page.keyboard.press('Delete');await expect(group).toHaveCount(1);
  await page.keyboard.press('Control+z');await expect(group).toHaveCount(2);
  await page.keyboard.press('Control+z');await expect(group).toHaveCount(1);
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Open Merge area',exact:true}).click();
  await expect(group).toHaveCount(1);await group.click();await page.getByRole('button',{name:'Ungroup',exact:true}).click();await expect(group).toHaveCount(0);
  await expect(a).toHaveAttribute('data-board-element','true');expect((await boardPosition(a)).x).toBeCloseTo(before.x+100,0);
  await page.getByRole('button',{name:'Open Layers Panel',exact:true}).click();await expect(page.locator('[data-layer-tile-id="layer-a"]')).toBeVisible();await expect(page.locator('[data-layer-tile-id="layer-b"]')).toBeVisible();
});
