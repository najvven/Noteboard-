import { deleteFixtureBoard } from './fixture-storage';
import { test, expect, type Page, type APIRequestContext } from './test';
import sharp from 'sharp';

const textElement = { id: 'text', type: 'text', position: { x: 100, y: 90 }, size: { width: 300, height: 110 }, content: 'Alpha <b>bravo</b> Charlie', textColor: '#000000', color: 'transparent', zIndex: 2 };
async function openFixture(page: Page, request: APIRequestContext, elements: unknown[] = [textElement]) {
  const existing = await (await request.get('/api/pages')).json();
  for (const item of existing) await deleteFixtureBoard(request, `/api/pages/${item.id}`);
  const response = await request.post('/api/pages', { data: [{ id: 'interaction-regressions', title: 'Interaction regressions', version: 3, width: 1100, height: 650, workspaceWidth: 1500, workspaceHeight: 1000, boardX: 64, boardY: 0, viewportCenterX: 640, viewportCenterY: 328, updatedAt: Date.now(), isPinned: false, elements, editorSettings: { activeTool: 'text', enableObjectSnapping: false, allowEditing: false, keepToolActive: true, selectionLockTime: 250 } }] });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Interaction regressions' }).click();
  await expect(page.locator('[data-board-root]')).toBeVisible();
}
async function drag(page: Page, from: {x:number;y:number}, to: {x:number;y:number}, hold = 0) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test('colors only the selected text and resizes a text field freely in Select', async ({ page, request }) => {
  await openFixture(page, request);
  const editor = page.locator('[data-board-element-editor-id="text"]');
  await editor.getByText('bravo', { exact: true }).dblclick();
  const node = page.locator('[data-board-element-id="text"]');
  await expect(node.locator('[title="Rotate"]')).toBeVisible();
  const selectedText = await page.evaluate(() => window.getSelection()?.toString());
  await page.locator('[title="Text Color"] input[type="color"]').fill('#ff0000');
  await expect(editor.locator('b span')).toHaveText('bravo');
  await expect(editor.locator('b span')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(editor).toHaveCSS('color', 'rgb(0, 0, 0)');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selectedText);
  await page.getByRole('button', { name: 'Select Tool', exact: true }).click();
  await editor.click();
  const before = (await node.boundingBox())!;
  const font = await editor.evaluate(el => getComputedStyle(el).fontSize);
  const handle = node.locator('[class*="cursor-se-resize"]');
  const corner = (await handle.boundingBox())!;
  await drag(page, { x: corner.x + corner.width/2, y: corner.y + corner.height/2 }, { x: corner.x + corner.width/2 + 90, y: corner.y + corner.height/2 + 25 });
  await expect.poll(async () => (await node.boundingBox())!.width).toBeCloseTo(before.width + 90, 0);
  await expect.poll(async () => (await node.boundingBox())!.height).toBeCloseTo(before.height + 25, 0);
  await expect(editor).toHaveCSS('font-size', font);
});

test('Text transforms default on, respect explicit disable, and do not enable unrelated tools', async ({ page, request }) => {
  await openFixture(page, request);
  const editor = page.locator('[data-board-element-editor-id="text"]');
  const node = page.locator('[data-board-element-id="text"]');
  await editor.click();
  await expect(node.locator('[title="Rotate"]')).toBeVisible();
  await page.getByRole('button', { name: 'Open text settings' }).click();
  const menu = page.locator('[data-toolbar-item="text"] .toolbar-dropdown');
  await menu.getByRole('button', { name: 'Tool settings', exact: true }).click();
  await menu.getByRole('button', { name: 'Allow editing elements', exact: true }).click();
  await expect(node.locator('[title="Rotate"]')).toHaveCount(0);
  await menu.getByRole('button', { name: 'Allow editing elements', exact: true }).click();
  await expect(node.locator('[title="Rotate"]')).toBeVisible();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(node.locator('[title="Rotate"]')).toHaveCount(0);
  await drag(page, { x: 450, y: 200 }, { x: 530, y: 230 });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await expect(page.locator('[data-board-element-type="draw"]')).toHaveCount(1);
  const path = await page.locator('[data-board-element-type="draw"] path').first().getAttribute('d');
  expect(path).not.toMatch(/Q|C/);
});

test('Media and Web require an activated area gesture instead of a click', async ({ page, request }) => {
  await openFixture(page, request, []);
  for (const tool of ['media', 'embed']) {
    if (tool === 'media') await page.getByRole('button', { name: 'Media tool', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('button', { name: 'Web', exact: true }).click();
    }
    const nodes = page.locator(`[data-board-element-type="${tool}"]`);
    await page.mouse.click(700, 170);
    await expect(nodes).toHaveCount(0);
    await drag(page, { x: 700, y: 170 }, { x: 800, y: 240 });
    await expect(nodes).toHaveCount(0);
    await drag(page, { x: 700, y: tool === 'media' ? 170 : 340 }, { x: 880, y: tool === 'media' ? 270 : 440 }, 300);
    await expect(nodes).toHaveCount(1);
  }
});

test('a More tool returns only after dropping it on the toolbar', async ({ page, request }) => {
  await openFixture(page, request, []);
  const row = page.locator('[data-more-toolbar-item="embed"]');
  const toolbar = page.locator('[data-toolbar-surface]');
  for (const cancel of [true, false]) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const box = (await row.getByRole('button', { name: 'Move Web to toolbar' }).boundingBox())!;
    const bar = (await toolbar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 32, box.y + 16, { steps: 5 });
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0);
    await page.mouse.move(cancel ? 20 : bar.x + 45, cancel ? 580 : bar.y + bar.height/2, { steps: 10 });
    await page.mouse.up();
    if (cancel) await expect(page.locator('[data-toolbar-item="embed"]')).toBeHidden();
    else await expect(page.locator('[data-toolbar-item="embed"]')).toBeVisible();
  }
  await page.getByRole('button', {name:'Back',exact:true}).click();
  await expect.poll(async () => (await (await request.get('/api/pages')).json())[0]?.editorSettings?.toolbarLayout?.more?.includes('embed')).toBe(false);
});

test('responsive property bars add scrollbar space without squeezing their controls', async ({ page, request }) => {
  await page.setViewportSize({ width: 1900, height: 900 });
  await openFixture(page, request);
  const toolbar = page.locator('[data-bottom-toolbar]');
  const control = toolbar.getByRole('button', { name: 'Bold', exact: true });
  await expect(toolbar).toBeVisible();
  await page.waitForTimeout(300);
  const before = (await control.boundingBox())!;
  const radius = await toolbar.evaluate(el => getComputedStyle(el).borderRadius);
  await page.setViewportSize({ width: 650, height: 900 });
  await expect.poll(() => toolbar.locator('.bottom-toolbar-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const after = (await control.boundingBox())!;
  expect(after.height).toBeCloseTo(before.height, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  await expect(toolbar).toHaveCSS('border-radius', radius);
  const bar = (await toolbar.boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(8);
  expect(bar.x + bar.width).toBeLessThanOrEqual(650 - 8);
});

test('a local video remains loaded after Select movement, drawing and panning', async ({ page, request }) => {
  await page.goto('/');
  const video = await page.evaluate(() => new Promise<string>(resolve => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(10);
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    recorder.ondataavailable = event => chunks.push(event.data);
    recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' })); };
    document.body.append(canvas);
    let frame = 0;
    recorder.start();
    {
      const timer = setInterval(() => {
        context.fillStyle = frame++ % 2 ? '#eab308' : '#facc15'; context.fillRect(0, 0, 160, 90);
        (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame();
        if (frame === 10) { clearInterval(timer); recorder.stop(); canvas.remove(); }
      }, 50);
    }
  }));
  expect(video.length).toBeGreaterThan(500);
  await openFixture(page, request, [textElement, { id: 'video', type: 'media', content: video, mediaMime: 'video/webm', position: { x: 500, y: 250 }, size: { width: 240, height: 135 }, zIndex: 3 }]);
  const node = page.locator('[data-board-element-id="video"]');
  const player = node.locator('video');
  await expect.poll(() => player.evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Select Tool', exact: true }).click();
  const box = (await node.boundingBox())!;
  await drag(page, { x: box.x + 15, y: box.y + 15 }, { x: box.x + 65, y: box.y + 40 });
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await drag(page, { x: 400, y: 180 }, { x: 470, y: 205 });
  await page.getByRole('button', { name: 'Pan Tool (Hand)', exact: true }).click();
  await drag(page, { x: 900, y: 400 }, { x: 910, y: 410 });
  await expect(player).toHaveAttribute('src', video);
  await expect.poll(() => player.evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  expect(await player.evaluate(el => (el as HTMLVideoElement).videoWidth)).toBe(160);
  const visibleBox = (await node.boundingBox())!;
  const {data, info} = await sharp(await page.screenshot()).raw().toBuffer({resolveWithObject:true});
  const offset = (Math.round(visibleBox.y+20)*info.width+Math.round(visibleBox.x+20))*info.channels;
  expect(data[offset]).toBeGreaterThan(220);
  expect(data[offset+1]).toBeGreaterThan(160);
  expect(data[offset+2]).toBeLessThan(80);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});

test('eraser masks cover additional boards and never erase the board surface', async ({ page, request }) => {
  await openFixture(page, request, [
    { id: 'secondary', type: 'board', position: {x:-50,y:250}, size: {width:200,height:140}, color:'#ffffff', content:'', zIndex:-1 },
    { id: 'red', type: 'rectangle', position: {x:-30,y:270}, size: {width:60,height:60}, color:'#ef4444', content:'', zIndex:2 },
    { id: 'erased', type: 'draw', position: {x:400,y:400}, size: {width:80,height:10}, points:[{x:0,y:0},{x:80,y:10}], isEraser:true, borderWidth:20, content:'', zIndex:3 },
  ]);
  const shape = page.locator('[data-board-element-id="red"]');
  const box = (await shape.boundingBox())!;
  const {data, info} = await sharp(await page.screenshot()).raw().toBuffer({resolveWithObject:true});
  const offset = (Math.round(box.y+30)*info.width+Math.round(box.x+10))*info.channels;
  expect([...data.subarray(offset,offset+3)]).toEqual([239,68,68]);
  await page.getByRole('button', {name:'Eraser tool',exact:true}).click();
  const board = page.locator('[data-board-element-id="secondary"]');
  const boardBox = (await board.boundingBox())!;
  await page.mouse.click(boardBox.x+20,boardBox.y+120);
  await expect(board).toHaveCount(1);
});

test('General Settings scrolls inside its border without changing width', async ({ page, request }) => {
  await openFixture(page, request, []);
  await page.getByRole('button', {name:'General Settings',exact:true}).click();
  const menu = page.locator('[data-toolbar-item="generalSettings"] > .toolbar-dropdown');
  const before = (await menu.boundingBox())!;
  for (const name of ['Board Settings', 'Global Tool Settings', 'Physics & Behavior', 'Shortcuts & Zoom']) {
    await menu.getByRole('button', {name,exact:true}).click();
  }
  const scroll = menu.locator('.menu-scroll-viewport');
  await expect.poll(() => scroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const after = (await menu.boundingBox())!;
  const inner = (await scroll.boundingBox())!;
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(inner.x+inner.width).toBeLessThan(after.x+after.width-8);
  await expect(menu.getByText('Selection lock', {exact:true})).toHaveCount(0);
  await expect(menu.getByText('Ratio scaling', {exact:true})).toHaveCount(0);
});

test('deleting inside Layers keeps the current container view', async ({ page, request }) => {
  await openFixture(page, request, [
    {id:'container',type:'section',name:'Container',position:{x:60,y:60},size:{width:500,height:300},content:'',zIndex:-1},
    {...textElement,parentId:'container'},
  ]);
  await page.getByRole('button', {name:'Open Layers Panel'}).click();
  const menu = page.locator('[data-toolbar-item="layers"] > .toolbar-dropdown');
  await menu.locator('[data-layer-tile-id="container"]').dblclick({position:{x:30,y:70}});
  await expect(menu.getByText('Container', {exact:true})).toBeVisible();
  await menu.locator('[data-layer-tile-id="text"]').getByTitle('Delete layer', {exact:true}).dblclick();
  await expect(menu.locator('[data-layer-tile-id="text"]')).toHaveCount(0);
  await expect(menu.getByText('Container', {exact:true})).toBeVisible();
  await expect(menu.getByText('Main Board', {exact:true})).toHaveCount(0);
  await expect(menu.getByTitle('Move element', {exact:true})).toHaveCount(0);
});

test('flipping an element does not reverse the section clipping boundary', async ({ page, request }) => {
  await openFixture(page, request, [
    {id:'section',type:'section',position:{x:500,y:100},size:{width:240,height:220},content:'',color:'#f1f5f9',zIndex:-1},
    {id:'flipped',type:'rectangle',position:{x:450,y:150},size:{width:150,height:100},content:'',color:'#60a5fa',flipX:true,zIndex:2},
  ]);
  const box = (await page.locator('[data-board-element-id="flipped"]').boundingBox())!;
  const {data, info} = await sharp(await page.screenshot()).raw().toBuffer({resolveWithObject:true});
  const offset = (Math.round(box.y+20)*info.width+Math.round(box.x+15))*info.channels;
  expect([...data.subarray(offset,offset+3)]).toEqual([96,165,250]);
});


test('moving a section immediately updates the clipping of unchanged neighbouring elements', async ({page,request}) => {
  await openFixture(page,request,[
    {id:'section',type:'section',position:{x:500,y:100},size:{width:240,height:220},content:'',color:'#f1f5f9',zIndex:-1},
    {id:'neighbour',type:'rectangle',position:{x:450,y:150},size:{width:200,height:100},content:'',color:'#2563eb',zIndex:2},
  ]);
  await page.getByRole('button',{name:'Select Tool',exact:true}).click();
  const neighbour=page.locator('[data-board-element-id="neighbour"]');
  const clip=()=>neighbour.locator('[style*="clip-path"]').first().evaluate(el=>getComputedStyle(el).clipPath);
  const before=await clip();
  const section=page.locator('[data-board-element-id="section"]');const box=(await section.boundingBox())!;
  await drag(page,{x:box.x+200,y:box.y+190},{x:box.x+350,y:box.y+190});
  await expect.poll(clip).not.toBe(before);
  const result=(await neighbour.boundingBox())!;
  const {data,info}=await sharp(await page.screenshot()).raw().toBuffer({resolveWithObject:true});
  const offset=(Math.round(result.y+50)*info.width+Math.round(result.x+100))*info.channels;
  expect([...data.subarray(offset,offset+3)]).toEqual([37,99,235]);
});
