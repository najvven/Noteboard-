import {test,expect} from './test';

test('Ctrl+V follows the current clipboard after copying an object and respects text focus',async({page,request,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const original={id:'arrow',type:'arrow',position:{x:100,y:100},size:{width:160,height:70},content:'',zIndex:1};
  await request.post('/api/pages',{data:[{id:'clipboard-check',title:'Clipboard check',width:1100,height:700,boardX:64,boardY:0,workspaceWidth:1500,workspaceHeight:1000,viewportCenterX:640,viewportCenterY:328,zoom:1,updatedAt:Date.now(),elements:[original],editorSettings:{activeTool:'select',allowEditing:false,keepToolActive:true}}]});
  await page.goto('/');await page.getByRole('button',{name:'Open Clipboard check',exact:true}).click();
  await page.locator('[data-board-element-id="arrow"]').click();await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
  await expect(page.locator('[data-board-element-type="arrow"]')).toHaveCount(2);
  await page.evaluate(()=>navigator.clipboard.writeText('External clipboard text'));
  await page.keyboard.press('Control+v');
  await expect(page.locator('[data-board-element-type="arrow"]')).toHaveCount(2);
  const text=page.locator('[data-board-element-type="text"]');await expect(text).toHaveCount(1);await expect(text).toContainText('External clipboard text');
  const editor=text.locator('[contenteditable="true"]');await editor.click();await editor.press('Control+End');
  await page.evaluate(()=>navigator.clipboard.writeText(' plus more'));await editor.press('Control+v');
  await expect(editor).toContainText('External clipboard text plus more');await expect(text).toHaveCount(1);
});

test('Main Board and additional board resizing preserve or move content according to the shared option at non-unit zoom',async({page,request})=>{
  await request.post('/api/pages',{data:[{id:'resize-check',title:'Resize check',width:700,height:420,boardX:128,boardY:80,workspaceWidth:1800,workspaceHeight:1200,viewportCenterX:640,viewportCenterY:328,zoom:1.5,updatedAt:Date.now(),elements:[
    {id:'note',type:'rectangle',position:{x:100,y:50},size:{width:70,height:45},color:'#bae6fd',content:'',zIndex:1},
    {id:'other',type:'board',position:{x:400,y:100},size:{width:200,height:150},color:'#eee',content:'',zIndex:-1},
    {id:'child',type:'rectangle',parentId:'other',position:{x:450,y:140},size:{width:60,height:40},color:'#bbf7d0',content:'',zIndex:2},
  ],editorSettings:{activeTool:'select',keepToolActive:true,enableObjectSnapping:false,smartGuidesEnabled:false,keepBoardContentPosition:true,previewMode:'realistic'}}]});
  await page.goto('/');await page.getByRole('button',{name:'Open Resize check',exact:true}).click();
  const settings=async()=>{await page.getByRole('button',{name:'General Settings',exact:true}).click();const menu=page.locator('[data-toolbar-item="generalSettings"] .toolbar-dropdown');const toggle=menu.getByRole('button',{name:'Keep content in place',exact:true});if(!await toggle.isVisible())await menu.getByRole('button',{name:'Board Settings',exact:true}).click();return menu;};
  let menu=await settings();await menu.getByRole('button',{name:'Resize',exact:true}).click();await page.getByRole('button',{name:'General Settings',exact:true}).click();
  const note=page.locator('[data-board-element-id="note"]'),child=page.locator('[data-board-element-id="child"]'),root=page.locator('[data-board-root]');
  const beforeNote=(await note.boundingBox())!,beforeChild=(await child.boundingBox())!,beforeBoard=(await root.boundingBox())!;
  const drag=async(locator:any,dy:number)=>{const box=(await locator.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+dy,{steps:10});await page.mouse.up();};
  for(const keep of [true,false]){
    if(!keep){menu=await settings();await menu.getByRole('button',{name:'Keep content in place',exact:true}).click();await page.getByRole('button',{name:'General Settings',exact:true}).click();}
    await page.mouse.click(beforeBoard.x+20,beforeBoard.y+20);
    await drag(page.locator('[data-main-board-resize="top"]'),-60);
    expect((await note.boundingBox())!.y).toBeCloseTo(beforeNote.y+(keep?0:-60),0);
    expect((await child.boundingBox())!.y).toBeCloseTo(beforeChild.y,0);
    const resized=(await root.boundingBox())!;expect(resized.y).toBeCloseTo(beforeBoard.y-60,0);expect(resized.height).toBeCloseTo(beforeBoard.height+60,0);
    await page.keyboard.press('Control+z');expect((await note.boundingBox())!.y).toBeCloseTo(beforeNote.y,0);expect((await root.boundingBox())!.y).toBeCloseTo(beforeBoard.y,0);
    await page.locator('[data-board-element-id="other"]').click({position:{x:20,y:20}});
    await drag(page.getByRole('button',{name:'Resize board n',exact:true}),-45);
    expect((await child.boundingBox())!.y).toBeCloseTo(beforeChild.y+(keep?0:-45),0);expect((await note.boundingBox())!.y).toBeCloseTo(beforeNote.y,0);
    await page.keyboard.press('Control+z');expect((await child.boundingBox())!.y).toBeCloseTo(beforeChild.y,0);
  }
});
