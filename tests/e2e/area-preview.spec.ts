import {test,expect} from './test';

const board=(id:string,tool='select',snapToGrid=false)=>({
  id,title:id,width:1100,height:700,boardX:64,boardY:0,workspaceWidth:1500,workspaceHeight:1000,
  viewportCenterX:640,viewportCenterY:328,zoom:1,gridSize:40,snapToGrid,elements:[],updatedAt:Date.now(),
  editorSettings:{activeTool:tool,keepToolActive:true,selectionLockTime:250,isSelectionLockEnabled:true,previewMode:'box',enableObjectSnapping:false},
});

for(const finish of [[-3,-3],[-8,0],[0,-8],[0,0]])test(`Select keeps one fixed anchor and commits its visible minimum region at ${finish}`,async({page,request})=>{
  const id='anchor-'+finish.join('-').replace(/-/g,'m');
  await request.post('/api/pages',{data:[board(id)]});await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const surface=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:surface.x+400,y:surface.y+320};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);
  const preview=page.locator('[data-selection-region="active"]');await expect(preview).toBeVisible();
  for(const [dx,dy] of [[3,3],[-3,3],[-3,-3],[3,-3],[-80,-60],[0,-8],[-8,0],finish]){
    await page.mouse.move(anchor.x+dx,anchor.y+dy);await expect(preview).toBeVisible();
    const bounds=(await preview.boundingBox())!;
    expect(bounds.width).toBeCloseTo(Math.max(40,Math.abs(dx)),0);expect(bounds.height).toBeCloseTo(Math.max(40,Math.abs(dy)),0);
    expect(dx<0?bounds.x+bounds.width:bounds.x).toBeCloseTo(anchor.x,0);expect(dy<0?bounds.y+bounds.height:bounds.y).toBeCloseTo(anchor.y,0);
  }
  const visible=(await preview.boundingBox())!;await page.mouse.up();
  const committed=page.locator('[data-selection-region="committed"]');await expect(committed).toBeVisible();
  const actual=(await committed.boundingBox())!;for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(visible[key],0);
});

test('a snapped rectangle keeps the anchor when its minimum preview changes quadrant',async({page,request})=>{
  const id='snapped-anchor';await request.post('/api/pages',{data:[board(id,'rectangle',true)]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const surface=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:surface.x+400,y:surface.y+320};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);
  const preview=page.locator('[data-board-root] .bg-blue-500\\/10.pointer-events-none').last();
  await expect(preview).toBeVisible();
  await page.mouse.move(anchor.x-8,anchor.y-8);
  const visible=(await preview.boundingBox())!;expect(visible.x+visible.width).toBeCloseTo(anchor.x,0);expect(visible.y+visible.height).toBeCloseTo(anchor.y,0);
  await page.mouse.up();await expect(page.locator('[data-board-element-type="rectangle"]')).toHaveCount(1);
  const actual=(await page.locator('[data-board-element-type="rectangle"]').boundingBox())!;
  for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(visible[key],0);
});

test('a held minimum Select region stays an area when the pointer crosses a nearby object',async({page,request})=>{
  const id='nearby-anchor',data=board(id);
  await request.post('/api/pages',{data:[{...data,elements:[{id:'nearby',type:'rectangle',position:{x:390,y:310},size:{width:8,height:8},content:'',zIndex:1}]}]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const surface=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:surface.x+400,y:surface.y+320};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.move(anchor.x-8,anchor.y-8);
  const visible=(await page.locator('[data-selection-region="active"]').boundingBox())!;await page.mouse.up();
  const committed=page.locator('[data-selection-region="committed"]');await expect(committed).toBeVisible();
  expect((await committed.boundingBox())!.x).toBeCloseTo(visible.x,0);expect((await committed.boundingBox())!.width).toBeCloseTo(visible.width,0);
});

test('proportional rectangle stays square when one pointer axis is exactly on the anchor',async({page,request})=>{
  const id='ratio-anchor',data=board(id,'rectangle');
  await request.post('/api/pages',{data:[{...data,editorSettings:{...data.editorSettings,proportionalScale:true}}]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const surface=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:surface.x+400,y:surface.y+320};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.move(anchor.x-80,anchor.y);
  const preview=page.locator('[data-board-root] .bg-blue-500\\/10.pointer-events-none').last(),visible=(await preview.boundingBox())!;
  expect(visible.width).toBeCloseTo(visible.height,0);await page.mouse.up();
  const actual=(await page.locator('[data-board-element-type="rectangle"]').boundingBox())!;expect(actual.width).toBeCloseTo(actual.height,0);
});

test('proportional shape handling preserves a horizontal line through its anchor',async({page,request})=>{
  const id='line-anchor',data=board(id,'line');
  await request.post('/api/pages',{data:[{...data,editorSettings:{...data.editorSettings,proportionalScale:true}}]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const surface=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:surface.x+400,y:surface.y+320};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.move(anchor.x-80,anchor.y);await page.mouse.up();
  await expect(page.locator('[data-board-element-type="line"]')).toHaveCount(1);
  await expect.poll(async()=>{const pages=await(await request.get('/api/pages')).json();return pages.find((page:any)=>page.id===id)?.elements[0]?.rotation;}).toBe(180);
});

for(const zoom of [.5,1.5])for(const tool of ['rectangle','ellipse'])for(const mode of ['box','realistic'])test(`${tool} ${mode} preview and placed bounds agree across quadrants at ${zoom} zoom`,async({page,request})=>{
  const id=`matrix-${tool}-${mode}-${zoom}`.replace('.','-'),data=board(id,tool,true);
  await request.post('/api/pages',{data:[{...data,zoom,editorSettings:{...data.editorSettings,previewMode:mode}}]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:root.x+400*zoom,y:root.y+320*zoom};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);
  const preview=page.locator('[data-board-root] .pointer-events-none.z-\\[100\\]');
  // Active region has one rendered child: either the translucent rectangle or True visual.
  const visible=preview.locator(':scope > div').first();
  for(const [dx,dy] of [[8,8],[-8,8],[-8,-8],[8,-8]]){
    await page.mouse.move(anchor.x+dx*zoom,anchor.y+dy*zoom);
    const bounds=(await visible.boundingBox())!;expect(dx<0?bounds.x+bounds.width:bounds.x).toBeCloseTo(anchor.x,0);expect(dy<0?bounds.y+bounds.height:bounds.y).toBeCloseTo(anchor.y,0);
  }
  const last=(await visible.boundingBox())!;await page.mouse.up();
  const actual=(await page.locator(`[data-board-element-type="${tool}"]`).boundingBox())!;
  for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(last[key],0);
});

test('object snapping changes the preview endpoint and never moves the held anchor on release',async({page,request})=>{
  const id='object-snap-anchor',data=board(id,'rectangle');
  await request.post('/api/pages',{data:[{...data,elements:[
    {id:'start-neighbor',type:'rectangle',position:{x:410,y:330},size:{width:80,height:60},content:'',zIndex:1},
    {id:'endpoint-neighbor',type:'rectangle',position:{x:620,y:440},size:{width:100,height:60},content:'',zIndex:2},
  ],editorSettings:{...data.editorSettings,enableObjectSnapping:true}}]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:root.x+400,y:root.y+320};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);
  await page.mouse.move(root.x+618,root.y+435);
  const preview=page.locator('[data-board-root] .bg-blue-500\\/10.pointer-events-none').last(),visible=(await preview.boundingBox())!;
  expect(visible.x).toBeCloseTo(anchor.x,0);expect(visible.y).toBeCloseTo(anchor.y,0);
  expect(visible.x+visible.width).toBeCloseTo(root.x+620,0);expect(visible.y+visible.height).toBeCloseTo(root.y+440,0);
  await page.mouse.up();const actual=(await page.locator('[data-board-element-type="rectangle"]').last().boundingBox())!;
  for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(visible[key],0);
});

test('a Select minimum region clips at a board edge without translating its anchor',async({page,request})=>{
  const id='edge-anchor',data=board(id);
  await request.post('/api/pages',{data:[{...data,width:600,height:420}]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:root.x+598,y:root.y+418};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);
  const preview=page.locator('[data-selection-region="active"]');
  const initial=(await preview.boundingBox())!;expect(initial.x).toBeCloseTo(anchor.x,0);expect(initial.y).toBeCloseTo(anchor.y,0);
  expect(initial.width).toBeCloseTo(2,0);expect(initial.height).toBeCloseTo(2,0);
  await page.mouse.move(anchor.x-8,anchor.y-8);const visible=(await preview.boundingBox())!;
  expect(visible.x+visible.width).toBeCloseTo(anchor.x,0);expect(visible.y+visible.height).toBeCloseTo(anchor.y,0);
  await page.mouse.up();const actual=(await page.locator('[data-selection-region="committed"]').boundingBox())!;
  for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(visible[key],0);
});

test('a grid-snapped gesture rebases once at unlock and preserves small reverse movement from an unsnapped cursor',async({page,request})=>{
  const id='unlock-anchor',data=board(id,'rectangle',true);
  await request.post('/api/pages',{data:[{...data,editorSettings:{...data.editorSettings,selectionLockTime:600}}]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!,preview=page.locator('[data-board-root] .bg-blue-500\\/10.pointer-events-none').last();
  await page.mouse.move(root.x+325,root.y+245);await page.mouse.down();
  await page.mouse.move(root.x+411,root.y+331);await expect(preview).toHaveCount(0);
  await expect(preview).toBeVisible();const anchor={x:root.x+400,y:root.y+320};
  const initial=(await preview.boundingBox())!;expect(initial.x).toBeCloseTo(anchor.x,0);expect(initial.y).toBeCloseTo(anchor.y,0);
  await page.mouse.move(root.x+403,root.y+323);const visible=(await preview.boundingBox())!;
  expect(visible.x+visible.width).toBeCloseTo(anchor.x,0);expect(visible.y+visible.height).toBeCloseTo(anchor.y,0);
  await page.mouse.up();const actual=(await page.locator('[data-board-element-type="rectangle"]').boundingBox())!;
  for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(visible[key],0);
});

for(const snapped of [false,true])test(`New Board preview and placement agree for a small reverse drag with snapping ${snapped}`,async({page,request})=>{
  const id='new-board-anchor-'+snapped;await request.post('/api/pages',{data:[board(id,'board',snapped)]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
  const anchor=await page.evaluate(()=>{
    for(let y=160;y<innerHeight-180;y+=20)for(let x=20;x<innerWidth-220;x+=20){
      if(document.elementFromPoint(x,y)?.id==='workspace-bg')return{x,y};
    }
    return null;
  });expect(anchor).not.toBeNull();
  await page.mouse.move(anchor!.x,anchor!.y);await page.mouse.down();await page.waitForTimeout(300);
  await page.mouse.move(anchor!.x-8,anchor!.y-8);
  const preview=page.locator('[data-new-board-preview="true"]'),visible=(await preview.boundingBox())!;
  await page.mouse.up();const actual=(await page.locator('[data-board-element-type="board"]').boundingBox())!;
  for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(visible[key],0);
});

test('a minimum rectangle clips at the upper-left edge without shifting its anchored corner',async({page,request})=>{
  const id='shape-edge-anchor',data=board(id,'rectangle');
  await request.post('/api/pages',{data:[{...data,width:600,height:420}]});
  await page.goto('/');await page.getByRole('button',{name:`Open ${id}`,exact:true}).click();
  const root=(await page.locator('[data-board-root]').boundingBox())!,anchor={x:root.x+10,y:root.y+10};
  await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.waitForTimeout(300);
  await page.mouse.move(anchor.x-8,anchor.y-8);
  const visible=(await page.locator('[data-board-root] .bg-blue-500\\/10.pointer-events-none').last().boundingBox())!;
  expect(visible.x+visible.width).toBeCloseTo(anchor.x,0);expect(visible.y+visible.height).toBeCloseTo(anchor.y,0);
  await page.mouse.up();const actual=(await page.locator('[data-board-element-type="rectangle"]').boundingBox())!;
  for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(visible[key],0);
});
