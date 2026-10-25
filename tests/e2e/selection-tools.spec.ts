import {test,expect} from './test';

test('polygon and freehand selection work across objects, support group movement, clipboard and undo',async({page,request,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const box=(id:string,x:number,y:number,more={})=>({id,type:'rectangle',position:{x,y},size:{width:80,height:60},color:'#dbeafe',content:'',zIndex:1,...more});
  await request.post('/api/pages',{data:[{id:'selection-check',title:'Selection check',width:1100,height:700,boardX:64,boardY:0,workspaceWidth:1500,workspaceHeight:1000,viewportCenterX:640,viewportCenterY:328,zoom:1,updatedAt:Date.now(),elements:[box('a',100,160),box('b',260,180),box('c',700,120),box('locked',140,270,{isLocked:true}),box('hidden',100,220,{isHidden:true})],editorSettings:{activeTool:'select',keepToolActive:true,enableObjectSnapping:false,isSelectionLockEnabled:false}}]});
  await page.goto('/');await page.getByRole('button',{name:'Open Selection check',exact:true}).click();
  const root=page.locator('[data-board-root]');
  const selectTool=async(id:string,_name:string)=>{await page.getByRole('button',{name:'Select settings',exact:true}).click();await page.getByRole('group',{name:'Selection mode',exact:true}).getByRole('button',{name:id==='lasso'?'Lasso':'Polygon',exact:true}).click();await page.getByRole('button',{name:'Select settings',exact:true}).click();};
  await selectTool('polygon-select','Polygon selection');
  let board=(await root.boundingBox())!;
  for(const [x,y] of [[70,140],[380,140],[380,350],[70,350]])await page.mouse.click(board.x+x,board.y+y);
  await page.keyboard.press('Enter');await expect(page.locator('[data-multi-selection="2"]')).toHaveCount(1);
  await page.mouse.click(board.x+10,board.y+10);await page.keyboard.press('Escape');await expect(page.locator('[data-selection-outline]')).toHaveCount(0);await expect(page.locator('[data-multi-selection="2"]')).toHaveCount(1);
  for(const key of ['Shift','Alt']){
    await page.keyboard.down(key);
    for(const [x,y] of [[680,100],[810,100],[810,220],[680,220]])await page.mouse.click(board.x+x,board.y+y);
    await page.keyboard.press('Enter');await page.keyboard.up(key);
    await expect(page.locator(`[data-multi-selection="${key==='Shift'?3:2}"]`)).toHaveCount(1);
  }
  await page.getByRole('button',{name:'Move selected objects',exact:true}).click();
  const a=page.locator('[data-board-element-id="a"]'),b=page.locator('[data-board-element-id="b"]');
  const beforeA=(await a.boundingBox())!,beforeB=(await b.boundingBox())!;
  await page.mouse.move(beforeA.x+30,beforeA.y+30);await page.mouse.down();await page.mouse.move(beforeA.x+80,beforeA.y+70,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();
  expect((await a.boundingBox())!.x).toBeCloseTo(beforeA.x,0);
  await page.mouse.move(beforeA.x+30,beforeA.y+30);await page.mouse.down();await page.mouse.move(beforeA.x+130,beforeA.y+85,{steps:10});
  expect((await a.boundingBox())!.x).toBeCloseTo(beforeA.x,0); // Translucent preview keeps originals until release.
  await page.mouse.up();
  await expect.poll(async()=>Math.round((await a.boundingBox())!.x-beforeA.x)).toBe(100);
  expect(Math.round((await b.boundingBox())!.y-beforeB.y)).toBe(55);
  await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
  await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(6); // five originals, one hidden, two copies
  await page.keyboard.press('Delete');await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(4);
  await page.keyboard.press('Control+z');await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(6);
  await page.keyboard.press('Control+z');await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(4);
  await page.keyboard.press('Control+z');await expect.poll(async()=>Math.round((await a.boundingBox())!.x-beforeA.x)).toBe(0);
  await selectTool('lasso','Lasso');board=(await root.boundingBox())!;
  await page.mouse.move(board.x+70,board.y+130);await page.mouse.down();
  for(const [x,y] of [[230,120],[380,140],[400,280],[300,320],[70,300],[60,200],[70,130]])await page.mouse.move(board.x+x,board.y+y,{steps:6});
  await page.mouse.up();await expect(page.locator('[data-multi-selection="2"]')).toHaveCount(1);
  await page.keyboard.press('Delete');await expect(a).toHaveCount(0);await expect(b).toHaveCount(0);await expect(page.locator('[data-board-element-id="locked"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Smart guides show distances, align objects, clear after the gesture and can be disabled',async({page,request})=>{
  const elements=['a','b'].map((id,index)=>({id,type:'rectangle',position:{x:100+index*400,y:160},size:{width:80,height:60},content:'',color:'#dbeafe',zIndex:index}));
  await request.post('/api/pages',{data:[{id:'guides-check',title:'Guides check',width:1100,height:700,boardX:64,boardY:0,workspaceWidth:1500,workspaceHeight:1000,viewportCenterX:640,viewportCenterY:328,zoom:1,updatedAt:Date.now(),elements,editorSettings:{activeTool:'select',keepToolActive:true,enableObjectSnapping:true}}]});
  await page.goto('/');await page.getByRole('button',{name:'Open Guides check',exact:true}).click();
  const a=page.locator('[data-board-element-id="a"]'),before=(await a.boundingBox())!;
  await page.mouse.move(before.x+30,before.y+30);await page.mouse.down();await page.mouse.move(before.x+230,before.y+33,{steps:8});
  await expect(page.locator('[data-smart-guides]')).toBeVisible();await expect(page.locator('[data-smart-guides]')).toContainText('120 px');
  await page.mouse.up();await expect(page.locator('[data-smart-guides]')).toHaveCount(0);
  expect((await a.boundingBox())!.y).toBeCloseTo(before.y,0);
  await page.getByRole('button',{name:'General Settings',exact:true}).click();await page.getByRole('button',{name:'Alignment & spacing',exact:true}).click();await page.getByRole('button',{name:'Show alignment and spacing',exact:true}).click();await page.getByRole('button',{name:'General Settings',exact:true}).click();
  const moved=(await a.boundingBox())!;await page.mouse.move(moved.x+30,moved.y+30);await page.mouse.down();await page.mouse.move(moved.x+80,moved.y+33,{steps:8});
  await expect(page.locator('[data-smart-guides]')).toHaveCount(0);await page.mouse.up();expect((await a.boundingBox())!.y).toBeCloseTo(moved.y+3,0);
  await expect.poll(async()=>{const pages=await(await request.get('/api/pages')).json();return pages.find((item:any)=>item.id==='guides-check')?.editorSettings?.smartGuidesEnabled;}).toBe(false);
});

test('Crop trims an image independently of ratio and undo restores the original bounds',async({page,request})=>{
  const content='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="160" height="180" fill="red"/><rect x="160" width="160" height="180" fill="blue"/></svg>').toString('base64');
  await request.post('/api/pages',{data:[{id:'crop-check',title:'Crop check',width:1100,height:700,boardX:64,boardY:0,workspaceWidth:1500,workspaceHeight:1000,viewportCenterX:640,viewportCenterY:328,zoom:1,updatedAt:Date.now(),elements:[{id:'photo',type:'image',position:{x:100,y:160},size:{width:320,height:180},content,zIndex:1,keepRatio:true}],editorSettings:{activeTool:'select',keepToolActive:true,enableObjectSnapping:false,isSelectionLockEnabled:false}}]});
  await page.goto('/');await page.getByRole('button',{name:'Open Crop check',exact:true}).click();
  const image=page.locator('[data-board-element-id="photo"]');await image.click();
  await page.keyboard.down('Alt');
  const edge=(await image.locator('.cursor-e-resize').boundingBox())!,before=(await image.boundingBox())!;
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2-80,edge.y+edge.height/2,{steps:8});await page.mouse.up();
  await page.keyboard.up('Alt');expect((await image.boundingBox())!.width).toBeCloseTo(before.width-80,0);expect((await image.boundingBox())!.height).toBeCloseTo(before.height,0);
  await expect.poll(async()=>{const boards=await(await request.get('/api/pages')).json();return boards.find((item:any)=>item.id==='crop-check')?.elements[0]?.crop?.right;}).toBeCloseTo(25,0);
  await page.keyboard.press('Control+z');expect((await image.boundingBox())!.width).toBeCloseTo(before.width,0);
  await expect(image.locator('img')).toHaveAttribute('src',content);
});
