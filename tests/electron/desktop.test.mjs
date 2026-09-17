import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron, expect } from 'playwright/test';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifacts = path.join(os.tmpdir(), 'noteboard-desktop-checks-20260916');
const seed = (activeTool = 'text', url = '') => ({
  id:'native-source', title:'Native source', width:1400, height:900,
  workspaceWidth:4000, workspaceHeight:3000, boardX:1300, boardY:1000,
  viewportCenterX:2000, viewportCenterY:1450, updatedAt:Date.now(), isPinned:false,
  editorSettings:{activeTool,keepToolActive:true,enableObjectSnapping:false,allowEditing:false},
  elements:[
    {id:'note',type:'text',position:{x:100,y:40},size:{width:500,height:80},content:'Native text',zIndex:1},
    {id:'web',type:'embed',position:{x:100,y:150},size:{width:1000,height:500},content:url,zIndex:2},
  ],
});

async function launch(t, board = seed(), { hostRules } = {}) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-desktop-'));
  await fs.mkdir(path.join(profile,'data','boards'),{recursive:true});
  await fs.mkdir(artifacts,{recursive:true});
  await fs.writeFile(path.join(profile,'data','boards','native-source.json'),JSON.stringify(board));
  const bootstrap=path.join(profile,'bootstrap.cjs');
  await fs.writeFile(bootstrap, `const {app}=require('electron');
    app.setPath('userData',process.env.NOTEBOARD_QA_PROFILE);
    app.on('browser-window-created',(_,win)=>{win.hide();win.setSkipTaskbar(true);win.setPosition(-10000,-10000);win.webContents.setBackgroundThrottling(false);win.showInactive();});
    app.on('web-contents-created',(_,contents)=>{if(contents.getType()==='webview'){contents.setAudioMuted(true);contents.setBackgroundThrottling(false);if(process.env.NOTEBOARD_PRIVACY_TRACE)contents.on('console-message',event=>console.error('GUEST',event.level,event.message));}});
    import(${JSON.stringify(pathToFileURL(process.env.NOTEBOARD_TEST_APP_ENTRY || path.join(root,'main.js')).href)});`);
  const env={...process.env,NODE_ENV:'production',NOTEBOARD_QA_PROFILE:profile};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({args:[bootstrap, ...(hostRules ? [`--host-resolver-rules=${hostRules}`] : [])],env,timeout:30000});
  if (process.env.NOTEBOARD_PRIVACY_TRACE) app.process().stderr.on('data', chunk => console.error(chunk.toString()));
  const window=await app.firstWindow();
  const errors=[];
  window.on('pageerror',error=>errors.push(error.message));
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  t.after(async()=>{
    try {
      const screenshot=path.join(artifacts,`${t.name.replace(/[^a-z0-9]+/gi,'-')}.png`);
      await nativeScreenshot(app,path.basename(screenshot)).catch(()=>undefined);
      if(process.env.NOTEBOARD_PRIVACY_TRACE) {
        const state=await app.evaluate(({webContents})=>Promise.all(webContents.getAllWebContents().filter(c=>c.getType()==='webview').map(c=>c.executeJavaScript('({title:document.title,ready:document.readyState,bodyDisplay:document.body&&getComputedStyle(document.body).display,bodyVisibility:document.body&&getComputedStyle(document.body).visibility,textLength:document.body?.innerText.length,htmlLength:document.documentElement.outerHTML.length,scripts:document.scripts.length,video:document.querySelectorAll("video").length})').catch(e=>({error:e.message}))))).catch(()=>[]);
        t.diagnostic(JSON.stringify(state));
      }
      if(errors.length) t.diagnostic(JSON.stringify(errors));
    } finally {
      await app.close();
      const resolved=path.resolve(profile), temp=path.resolve(os.tmpdir())+path.sep;
      assert.ok(resolved.startsWith(temp) && path.basename(resolved).startsWith('noteboard-desktop-'));
      await fs.rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:150});
    }
  });
  await window.getByRole('button',{name:'Open Native source',exact:true}).click();
  await expect(window.locator('[data-board-root]')).toBeVisible();
  return {app,window,profile,errors};
}

async function fixtureServer(t) {
  const server=http.createServer((request,response)=>{
    if(request.url==='/fail') {request.socket.destroy();return;}
    const render=()=>{
      response.setHeader('Content-Type','text/html; charset=utf-8');
      response.end(`<title>Native web ready</title><h1>Native web ready</h1><p>${request.url}</p><a id="popup" href="/popup" target="_blank">Open popup</a>`);
    };
    if(request.url==='/slow') setTimeout(render,1200); else render();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const guestState = app => app.evaluate(async ({webContents}) => Promise.all(webContents.getAllWebContents().filter(c=>c.getType()==='webview').map(async c=>({
  id:c.id,url:c.getURL(),title:c.getTitle(),body:await c.executeJavaScript('document.body?.innerText || ""').catch(()=>''),
}))));

test('desktop Web enforces ad, popup and cookie settings from first load and after toggling', {timeout:60000}, async t => {
  const progress = label => { if (process.env.NOTEBOARD_PRIVACY_TRACE) console.log(label); };
  let adRequests = 0, pageLoads = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/pagead/js/adsbygoogle.js') { adRequests++; response.setHeader('Content-Type', 'application/javascript'); response.end('window.adLoaded=true;'); return; }
    if (request.url === '/echo') { response.end(request.headers.cookie || ''); return; }
    if (request.url === '/popup') { response.setHeader('Set-Cookie','popup=1; Path=/; SameSite=Lax'); response.end('<title>Privacy popup</title><h1>Popup</h1>'); return; }
    pageLoads++;
    response.setHeader('Content-Type', 'text/html');
    response.setHeader('Set-Cookie', 'server=1; Path=/; SameSite=Lax');
    response.end(`<title>Privacy fixture</title><h1>Privacy fixture</h1><div id="ad-slot" class="adsbygoogle">Advertisement</div><div id="hero" class="hero-banner">Normal banner</div><script src="http://pagead2.googlesyndication.com:${server.address().port}/pagead/js/adsbygoogle.js"></script><script>document.cookie="script=1; path=/";document.body.dataset.immediate=document.cookie;Promise.all([cookieStore.set('store','1').then(()=>cookieStore.getAll()),fetch('/echo').then(r=>r.text())]).then(([cookies,echo])=>{document.body.dataset.store=JSON.stringify(cookies);document.body.dataset.cookie=echo;document.body.dataset.ready='1'})</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const board = seed('embed', `http://127.0.0.1:${server.address().port}/page`);
  Object.assign(board.elements[1], {webSessionId:'privacy-source',webAdBlock:true,webCookieBlocker:'all',webPopupBlocker:true});
  const {app,window,errors} = await launch(t,board,{hostRules:'MAP pagead2.googlesyndication.com 127.0.0.1'});
  progress('launched');
  const inspect = () => app.evaluate(({webContents}) => webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('({ready:document.body.dataset.ready,echo:document.body.dataset.cookie,immediate:document.body.dataset.immediate,store:document.body.dataset.store,cookies:document.cookie,ad:window.adLoaded===true,hidden:document.getElementById("ad-slot")?.checkVisibility()===false,hero:document.getElementById("hero")?.checkVisibility(),node:typeof require})')).catch(()=>({}));
  await expect.poll(async () => (await inspect()).ready).toBe('1');
  await expect.poll(async () => (await inspect()).cookies).toBe('');
  assert.equal((await inspect()).echo,''); assert.equal((await inspect()).ad,false); assert.equal(adRequests,0);
  assert.equal((await inspect()).immediate,''); assert.equal((await inspect()).store,'[]'); assert.equal((await inspect()).node,'undefined');
  progress('initial blocking verified');
  const openPopup = () => app.evaluate(({webContents}) => webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('window.open("/popup", "_blank"); undefined',true));
  await openPopup();
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);

  await window.getByRole('button',{name:'Select Tool',exact:true}).click();
  await window.locator('[data-board-element-id="web"]').click();
  await window.getByRole('button',{name:'More',exact:true}).click();
  const menu = window.locator('[data-more-toolbar-item="embed"]');
  await menu.getByRole('button',{name:'Web settings',exact:true}).click();
  await menu.getByRole('button',{name:/^Ad blocker/}).click();
  await expect.poll(()=>adRequests).toBeGreaterThan(0);
  await expect.poll(async () => (await inspect()).ad).toBe(true);
  await menu.getByRole('group',{name:'Cookie blocker'}).getByRole('button',{name:'Off',exact:true}).click();
  await expect.poll(async () => (await inspect()).echo || '').toContain('server=1');
  await expect.poll(async () => (await inspect()).cookies).toContain('script=1');
  const beforeThirdParty = pageLoads;
  await menu.getByRole('group',{name:'Cookie blocker'}).getByRole('button',{name:'Third-party',exact:true}).click();
  await expect.poll(()=>pageLoads).toBeGreaterThan(beforeThirdParty);
  await expect.poll(async () => (await inspect()).cookies).toContain('server=1');
  progress('third-party mode verified');

  const loads = pageLoads;
  await menu.getByRole('button',{name:'Block popups',exact:true}).click();
  await expect.poll(()=>pageLoads).toBeGreaterThan(loads);
  await expect.poll(async () => (await inspect()).ready).toBe('1');
  await openPopup();
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(2);
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/popup')))).toBe(true);
  const popupPreferences = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w=>w.webContents.getType()==='window'&&w.webContents.getURL().endsWith('/popup'))?.webContents.getLastWebPreferences());
  assert.equal(popupPreferences.nodeIntegration,false); assert.equal(popupPreferences.contextIsolation,true);
  progress('same-origin popup verified');
  const popupUrl = `http://localhost:${server.address().port}/popup`;
  await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript(`window.open(${JSON.stringify(url)}, "_blank"); undefined`,true),popupUrl);
  progress('different-origin popup opened');
  await expect.poll(()=>app.evaluate(({webContents},url)=>webContents.getAllWebContents().some(c=>c.getURL()===url),popupUrl)).toBe(true);
  await expect.poll(()=>app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(c=>c.getURL()===url).executeJavaScript('document.cookie'),popupUrl)).toContain('popup=1');
  progress('different-origin cookies verified');
  await window.getByRole('button',{name:'More',exact:true}).click();
  await window.getByRole('button',{name:'Duplicate',exact:true}).click();
  await expect(window.locator('webview')).toHaveCount(2);
  const partitions = await window.locator('webview').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('partition')));
  assert.equal(new Set(partitions).size,2);
  assert.deepEqual(errors,[]);
});

test('maintained ad filters block real ad URLs and hide ad slots without blocking ordinary banners', {timeout:45000}, async t => {
  let ads = 0, images = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/pagead/js/adsbygoogle.js') { ads++; response.setHeader('Content-Type','application/javascript'); response.end('window.adLoaded=true'); return; }
    if (request.url === '/assets/banner.png') { images++; response.setHeader('Content-Type','image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="green"/></svg>'); return; }
    response.setHeader('Content-Type','text/html');
    response.end(`<h1>Useful content</h1><div id="ad-slot">Advertisement</div><img id="hero" src="/assets/banner.png"><script src="http://pagead2.googlesyndication.com:${server.address().port}/pagead/js/adsbygoogle.js"></script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const {app,window,errors} = await launch(t, seed('embed',`http://publisher.example.org:${server.address().port}/page`), {hostRules:'MAP publisher.example.org 127.0.0.1, MAP pagead2.googlesyndication.com 127.0.0.1'});
  const partition=await window.locator('webview').getAttribute('partition');
  const status=()=>window.evaluate(partition=>window.noteboardAPI.getWebBlockingStatus(partition),partition);
  const inspect = () => app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('({hidden:document.getElementById("ad-slot")?.checkVisibility()===false,hero:document.getElementById("hero")?.naturalWidth,ad:window.adLoaded===true,text:document.body.innerText})')).catch(()=>({}));
  await expect.poll(async()=>(await inspect()).hidden).toBe(true);
  assert.equal(ads,0); assert.equal((await inspect()).ad,false);
  assert.equal((await inspect()).hero,40); assert.ok(images>0); assert.match((await inspect()).text,/Useful content/);
  await window.getByRole('button',{name:'Select Tool',exact:true}).click(); await window.locator('[data-board-element-id="web"]').click();
  await window.getByRole('button',{name:'More',exact:true}).click();
  const menu = window.locator('[data-more-toolbar-item="embed"]');
  await menu.getByRole('button',{name:'Web settings',exact:true}).click();
  await expect(menu.locator('[data-web-blocking-status]')).toContainText('blocked');
  const before=(await status()).ads;
  assert.ok(before>0); assert.ok((await status()).filterRules>100000);
  await window.screenshot({path:path.join(artifacts,'strong-blocker-active.png')});
  await menu.getByRole('button',{name:/^Ad blocker/}).click();
  await expect.poll(()=>ads).toBeGreaterThan(0);
  await expect.poll(async()=>(await inspect()).hidden).toBe(false);
  assert.equal((await inspect()).ad,true); assert.equal((await status()).ads,before);
  await window.getByRole('button',{name:'More',exact:true}).click();
  await window.getByRole('button',{name:'Back',exact:true}).click();
  await window.reload();
  await window.getByRole('button',{name:'Open Native source',exact:true}).click();
  await expect.poll(async()=>(await inspect()).ad).toBe(true);
  await window.getByRole('button',{name:'Select Tool',exact:true}).click(); await window.locator('[data-board-element-id="web"]').click();
  await window.getByRole('button',{name:'More',exact:true}).click();await menu.getByRole('button',{name:'Web settings',exact:true}).click();
  await expect(menu.getByRole('button',{name:/^Ad blocker/})).toHaveAttribute('aria-pressed','false');
  const allowedRequests=ads;
  await menu.getByRole('button',{name:/^Ad blocker/}).click();
  await expect.poll(async()=>(await inspect()).hidden).toBe(true);
  await expect.poll(async()=>(await status()).ads).toBeGreaterThan(before);
  assert.equal((await inspect()).ad,false); assert.equal(ads,allowedRequests);
  assert.deepEqual(errors,[]);
});

test('cookie policy applies before scripts in same-origin, cross-origin and srcdoc frames without exposing Node', {timeout:45000}, async t => {
  let revision = 0;
  const probe = kind => `<script>(async()=>{document.cookie='script=1; path=/; SameSite=None; Secure';const immediate=document.cookie;let store;try{await cookieStore.set('store','1');store=(await cookieStore.getAll()).map(c=>c.name)}catch(error){store=error.name+': '+error.message}const proof={kind:${JSON.stringify(kind)},immediate,store,node:typeof require,process:typeof process,api:typeof noteboardAPI};${kind === 'main' ? 'document.body.dataset.proof=JSON.stringify(proof)' : 'parent.postMessage(proof,"*")'}})()</script>`;
  const server=http.createServer((request,response)=>{
    response.setHeader('Content-Type','text/html');
    response.setHeader('Set-Cookie','server=1; Path=/; SameSite=None; Secure');
    if(request.url==='/child') {response.end('<body>'+probe(request.headers.host.startsWith('localhost')?'cross':'same'));return;}
    const srcdoc=('<body>'+probe('srcdoc')).replaceAll('&','&amp;').replaceAll('"','&quot;');
    response.end(`<body data-revision="${++revision}"><script>window.addEventListener('message',e=>{if(['same','cross','srcdoc'].includes(e.data?.kind))document.body.dataset[e.data.kind]=JSON.stringify(e.data)})</script>${probe('main')}<iframe src="/child"></iframe><iframe src="http://localhost:${server.address().port}/child"></iframe><iframe srcdoc="${srcdoc}"></iframe>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const board=seed('embed',`http://127.0.0.1:${server.address().port}/page`);
  Object.assign(board.elements[1],{webAdBlock:false,webCookieBlocker:'all'});
  const {app,window,errors}=await launch(t,board);
  const inspect=()=>app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('({revision:document.body?.dataset.revision,proofs:["proof","same","cross","srcdoc"].map(key=>JSON.parse(document.body?.dataset[key]||"null"))})')).catch(()=>({proofs:[]}));
  await expect.poll(async()=>(await inspect()).proofs.filter(Boolean).length).toBe(4);
  for(const proof of (await inspect()).proofs) {assert.equal(proof.immediate,'');assert.deepEqual(proof.store,[]);assert.equal(proof.node,'undefined');assert.equal(proof.process,'undefined');assert.equal(proof.api,'undefined');}
  const preferences=await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').getLastWebPreferences());
  assert.equal(preferences.sandbox,true);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);
  await window.getByRole('button',{name:'Select Tool',exact:true}).click();await window.locator('[data-board-element-id="web"]').click();
  await window.getByRole('button',{name:'More',exact:true}).click();const menu=window.locator('[data-more-toolbar-item="embed"]');await menu.getByRole('button',{name:'Web settings',exact:true}).click();
  const previous=(await inspect()).revision;
  await menu.getByRole('group',{name:'Cookie blocker'}).getByRole('button',{name:'Third-party',exact:true}).click();
  await expect.poll(async()=>(await inspect()).revision).not.toBe(previous);
  await expect.poll(async()=>(await inspect()).proofs.filter(Boolean).length).toBe(4);
  const thirdParty=(await inspect()).proofs;
  for(const proof of thirdParty.filter(p=>p.kind!=='cross')) {assert.match(proof.immediate,/script=1/);assert.ok(proof.store.includes('store'));}
  assert.equal(thirdParty.find(p=>p.kind==='cross').immediate,'');assert.deepEqual(thirdParty.find(p=>p.kind==='cross').store,[]);
  await menu.getByRole('group',{name:'Cookie blocker'}).getByRole('button',{name:'Off',exact:true}).click();
  await expect.poll(async()=>(await inspect()).proofs.filter(Boolean).length).toBe(4); await expect.poll(async()=>(await inspect()).proofs.find(p=>p?.kind==='cross')?.immediate||'').toContain('script=1');
  const offRevision=(await inspect()).revision;
  await menu.getByRole('group',{name:'Cookie blocker'}).getByRole('button',{name:'All',exact:true}).click();
  await expect.poll(async()=>(await inspect()).revision).not.toBe(offRevision);
  await expect.poll(async()=>(await inspect()).proofs.filter(Boolean).length).toBe(4);
  for(const proof of (await inspect()).proofs) {assert.equal(proof.immediate,'');assert.deepEqual(proof.store,[]);}
  const stored=await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').session.cookies.get({}));
  assert.deepEqual(stored,[]);
  assert.deepEqual(errors,[]);
});

test('sandboxed frames cannot open windows while an allowed top-level popup still works', {timeout:45000}, async t => {
  let popupRequests=0;
  const server=http.createServer((request,response)=>{
    response.setHeader('Content-Type','text/html');
    if(request.url==='/popup'){popupRequests++;response.end('<h1>Allowed popup</h1>');return;}
    if(request.url==='/child'){response.end('<a id="open" href="/popup" target="_blank">Open</a>');return;}
    response.end('<h1>Sandbox fixture</h1><iframe sandbox="allow-scripts" src="/child"></iframe>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const board=seed('embed',`http://127.0.0.1:${server.address().port}/page`);Object.assign(board.elements[1],{webAdBlock:false,webPopupBlocker:false});
  const {app,errors}=await launch(t,board);
  await expect.poll(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview')?.mainFrame.frames.length||0)).toBe(1);
  await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').mainFrame.frames[0].executeJavaScript('document.getElementById("open").click()',true));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  assert.equal(popupRequests,0);
  await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('window.open("/popup", "_blank");undefined',true));
  await expect.poll(()=>popupRequests).toBe(1);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),2);
  assert.deepEqual(errors,[]);
});

test('desktop Web loads, saves before ready, retries and opens isolated popups', {timeout:60000}, async t=>{
  const origin=await fixtureServer(t);
  const {app,window,profile,errors}=await launch(t,seed('embed'));
  const input=window.getByPlaceholder('Paste web link...');
  await expect(input).toBeEnabled();
  await input.fill(`${origin}/slow`); await input.press('Enter');
  await window.getByRole('button',{name:'Save',exact:true}).click();
  const dialog=window.getByRole('dialog',{name:'Save as',exact:true});
  await dialog.getByRole('button',{name:'Save as Template'}).click();
  await expect(dialog.getByRole('status')).toHaveText('Template saved.');
  const templates=JSON.parse(await fs.readFile(path.join(profile,'data','presets.json'),'utf8'));
  assert.equal(templates[0].elements.find(e=>e.id==='web').content,`${origin}/slow`);
  await dialog.getByRole('button',{name:'Close save dialog'}).click();
  await expect.poll(async()=> (await guestState(app))[0]?.title).toBe('Native web ready');
  await expect(window.getByText('Loading page…',{exact:true})).toHaveCount(0);
  await window.getByRole('button',{name:'Select Tool',exact:true}).click();
  const field=window.locator('[data-board-element-id="web"]');
  await field.click({position:{x:5,y:5}});
  for(const suffix of ['/page','/page','/fail','/page']) {
    await field.hover();
    await field.getByRole('button',{name:'Edit web address'}).click();
    await input.fill(origin+suffix); await input.press('Enter');
    if(suffix==='/fail') {
      await expect(field.getByRole('alert')).toBeVisible();
      await app.evaluate(({app,shell})=>{shell.openExternal=async url=>{app.__qaExternalUrl=url;};});
      await field.getByRole('link',{name:'Open in browser'}).click();
      await expect.poll(()=>app.evaluate(({app})=>app.__qaExternalUrl)).toBe(origin+'/fail');
    }
    else {
      await expect.poll(async()=> (await guestState(app))[0]?.title).toBe('Native web ready');
      await expect.poll(async()=> (await guestState(app)).length).toBe(1);
    }
  }
  await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('document.getElementById("popup").click()',true));
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(2);
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/popup')))).toBe(true);
  const popup=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/popup'))?.webContents.getLastWebPreferences());
  assert.equal(popup.nodeIntegration,false); assert.equal(popup.contextIsolation,true); assert.equal(popup.sandbox,true);
  assert.deepEqual(errors,[]);
});

test('desktop Save as writes templates, separate boards and a real ZIP download', {timeout:45000}, async t=>{
  const {app,window,profile,errors}=await launch(t);
  await window.locator('[data-board-element-editor-id="note"]').fill('Newest native words');
  await window.getByRole('button',{name:'Save',exact:true}).click();
  const dialog=window.getByRole('dialog',{name:'Save as'});
  await dialog.getByLabel('Save as name').fill('Desktop copy');
  await dialog.getByRole('button',{name:'Save as Template'}).click();
  await expect(dialog.getByRole('status')).toHaveText('Template saved.');
  await dialog.getByRole('button',{name:'Save as New Board'}).click();
  await expect(dialog.getByRole('status')).toContainText('New board saved');
  const names=(await fs.readdir(path.join(profile,'data','boards'))).filter(name=>name.endsWith('.json'));
  const boards=await Promise.all(names.map(name=>fs.readFile(path.join(profile,'data','boards',name),'utf8').then(JSON.parse)));
  const copy=boards.find(board=>board.title==='Desktop copy');
  assert.ok(copy && copy.id!=='native-source');
  assert.ok(copy.elements.some(element=>element.content==='Newest native words'));
  const destination=path.join(profile,'export.zip');
  await app.evaluate(({app,session},destination)=>{
    app.__qaDownloadState='waiting';
    session.defaultSession.once('will-download',(_event,item)=>{
      item.setSavePath(destination);
      item.once('done',(_done,state)=>{app.__qaDownloadState=state;});
    });
  },destination);
  await dialog.getByRole('button',{name:'Save as File'}).click();
  await expect.poll(()=>app.evaluate(({app})=>app.__qaDownloadState)).toBe('completed');
  const archive=await JSZip.loadAsync(await fs.readFile(destination));
  const manifest=JSON.parse(await archive.file('board.json').async('string'));
  assert.equal(manifest.title,'Desktop copy');
  assert.equal(manifest.elements.find(e=>e.id==='note').content,'Newest native words');
  assert.deepEqual(errors,[]);
});

test('desktop compact menus and scrollbar survive repeated window and zoom changes', {timeout:60000}, async t=>{
  const {app,window,errors}=await launch(t);
  await window.getByRole('button',{name:'Select settings',exact:true}).click();
  const menu=window.locator('[data-toolbar-item="select"] .toolbar-dropdown');
  const spacing=await menu.evaluate(el=>{
    const footer=el.querySelector('.menu-settings-block').getBoundingClientRect();
    const caption=el.querySelector('.menu-settings-caption').getBoundingClientRect();
    const center=caption.y+caption.height/2;
    return {above:center-footer.y-2,below:el.getBoundingClientRect().bottom-3-center};
  });
  assert.ok(Math.abs(spacing.above-spacing.below)<2);
  assert.ok(spacing.above<=21);
  await window.getByRole('button',{name:'Select settings',exact:true}).click();
  await window.getByRole('button',{name:'Text Tool',exact:true}).click();
  for(const width of [1600,1000,800,1280,800,1600]) {
    await app.evaluate(async ({BrowserWindow},width)=>{
      const win=BrowserWindow.getAllWindows()[0];
      await new Promise(resolve=>{
        let timer;
        const settle=()=>{clearTimeout(timer);timer=setTimeout(()=>{win.removeListener('resize',settle);win.webContents.setZoomFactor(1);resolve();},100);};
        win.on('resize',settle);win.setContentSize(width,800);settle();
      });
    },width);
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1);
    assert.ok(Math.abs(await window.evaluate(()=>innerWidth)-width)<=32);
    const bar=window.locator('[data-bottom-toolbar]');
    await expect(bar).toHaveCSS('border-radius','16px');
    await expect.poll(()=>bar.evaluate(el=>el.getBoundingClientRect().right<=innerWidth-7)).toBe(true);
    await expect.poll(()=>bar.evaluate(el=>{
      const viewport=el.querySelector('.bottom-toolbar-scroll');
      return (viewport.scrollWidth>viewport.clientWidth+1)===Boolean(el.querySelector('[data-property-scroll-row]'));
    })).toBe(true);
    const scroll=bar.getByRole('scrollbar');
    if(await scroll.count()) {
      await scroll.focus(); await scroll.press('End');
      await expect.poll(()=>bar.locator('.bottom-toolbar-scroll').evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
      await scroll.press('Home');
      await expect.poll(()=>bar.locator('.bottom-toolbar-scroll').evaluate(el=>el.scrollLeft)).toBe(0);
    }
  }
  assert.deepEqual(errors,[]);
});

test('desktop More keeps a held drag across embedded web content and cancels outside the toolbar', {timeout:45000}, async t=>{
  const origin=await fixtureServer(t);
  const {app,window,errors}=await launch(t,seed('embed',origin+'/page'));
  await expect.poll(async()=> (await guestState(app))[0]?.title).toBe('Native web ready');
  const row=window.locator('[data-more-toolbar-item="embed"]');
  for(const cancel of [true,false]) {
    await window.getByRole('button',{name:'More',exact:true}).click();
    const handle=(await row.getByRole('button',{name:'Move Web to toolbar'}).boundingBox());
    const menu=(await row.boundingBox());
    const toolbar=(await window.locator('[data-toolbar-surface]').boundingBox());
    const web=(await window.locator('[data-board-element-id="web"]').boundingBox());
    await window.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2); await window.mouse.down();
    await window.mouse.move(menu.x-30,menu.y+10,{steps:8});
    await window.mouse.move(cancel?web.x+100:toolbar.x+60,cancel?web.y+100:toolbar.y+toolbar.height/2,{steps:12});
    await window.mouse.up();
    await expect(window.locator('[data-more-drag-ghost]')).toHaveCount(0);
    await expect(window.getByRole('button',{name:'Finish',exact:true})).toHaveCount(0);
    if(cancel) await expect(window.locator('[data-toolbar-item="embed"]')).toBeHidden();
    else await expect(window.locator('[data-toolbar-item="embed"]')).toBeVisible();
  }
  assert.deepEqual(errors,[]);
});

test('live YouTube renders and plays inside desktop Web with default settings', {timeout:60000,skip:process.env.NOTEBOARD_LIVE_WEB_TEST!=='1'}, async t=>{
  const url='https://www.youtube.com/watch?v=M7lc1UVf-VE';
  const {app,window,errors}=await launch(t,seed('embed',url));
  await expect.poll(async()=> (await guestState(app))[0]?.title,{timeout:30000}).toContain('YouTube');
  await expect.poll(async()=> (await guestState(app))[0]?.body,{timeout:30000}).toContain('Embedded Web Player Customization');
  await expect.poll(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('Boolean(document.querySelector("video"))')),{timeout:20000}).toBe(true);
  await expect(window.getByText('Loading page…',{exact:true})).toHaveCount(0);
  await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('document.querySelector("video").muted=true; document.querySelector("video").play().catch(()=>{})',true));
  await expect.poll(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('document.querySelector("video")?.currentTime || 0')),{timeout:20000}).toBeGreaterThan(.1);
  await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('document.querySelector("video")?.pause()'));
  assert.deepEqual(errors,[]);
});


// Capture through Electron: Playwright's CDP screenshot temporarily overrides
// device metrics, which changes embedded mobile guests while taking the picture.
async function nativeScreenshot(app, name) {
  const data = await app.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(artifacts,name),Buffer.from(data,'base64'));
}

async function responsiveServer(t) {
  const requests=[];
  const server=http.createServer((request,response)=>{
    if(request.url==='/favicon.ico'){response.writeHead(204);response.end();return;}
    requests.push({ua:request.headers['user-agent'],mobile:request.headers['sec-ch-ua-mobile'],platform:request.headers['sec-ch-ua-platform']});
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Responsive Web</title><style>*{box-sizing:border-box}body{margin:0;background:white;font:16px sans-serif}header{padding:16px;background:#334155;color:white}input{width:50%;height:30px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}article{padding:20px;background:#dbeafe}@media(max-width:600px){.grid{grid-template-columns:1fr}}@media(min-width:601px) and (max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}button{position:fixed;right:12px;bottom:12px;width:100px;height:40px;background:#2563eb;color:white;border:0}</style><header>Responsive Web</header><input id="state" aria-label="Page note"><div class="grid"><article>First card</article><article>Second card</article><article>Third card</article></div><button id="target" onclick="window.clicks++">Click me</button><script>window.marker=Math.random();window.clicks=0;document.addEventListener("pointerdown",e=>window.lastClick={x:e.clientX,y:e.clientY,target:e.target.id,pointer:e.pointerType});window.first={width:innerWidth,height:innerHeight,screen:[screen.width,screen.height],touch:navigator.maxTouchPoints,ua:navigator.userAgent};</script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
  return {url:'http://127.0.0.1:'+server.address().port+'/page',requests};
}
const responsiveState = app => app.evaluate(({webContents})=>{
  const guest=webContents.getAllWebContents().find(c=>c.getType()==='webview');
  if(!guest)return {};
  return guest.executeJavaScript('({width:innerWidth,height:innerHeight,orientation:screen.orientation.type,screen:[screen.width,screen.height],dpr:devicePixelRatio,ua:navigator.userAgent,hints:navigator.userAgentData?.toJSON(),touch:navigator.maxTouchPoints,coarse:matchMedia("(pointer: coarse)").matches,hover:matchMedia("(hover: hover)").matches,columns:document.querySelector(".grid")&&getComputedStyle(document.querySelector(".grid")).gridTemplateColumns.split(" ").length,cookie:document.cookie,lastClick:window.lastClick,note:document.querySelector("#state")?.value,clicks:window.clicks,marker:window.marker,first:window.first})').then(data=>({id:guest.id,...data}));
}).catch(()=>({}));

async function clickWebControl(app,window,selector) {
  await window.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const target=await app.evaluate(({webContents},selector)=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight}})()'),selector);
  const box=await window.locator('[data-web-viewport]').boundingBox();
  const point={x:box.x+target.x*box.width/target.width,y:box.y+target.y*box.height/target.height};
  if(process.env.NOTEBOARD_PRIVACY_TRACE) console.log('CLICK',JSON.stringify({point,box,target,hit:await window.evaluate(p=>document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,200),point)}));
  await window.mouse.move(point.x,point.y);
  await window.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await window.mouse.click(point.x,point.y);
  if(process.env.NOTEBOARD_PRIVACY_TRACE) console.log('CLICKRESULT',JSON.stringify(await responsiveState(app)));
}

async function resizeWeb(window, axis, amount) {
  const node=window.locator('[data-board-element-id="web"]');
  const handle=node.locator('.cursor-'+axis+'-resize');
  await handle.scrollIntoViewIfNeeded();
  const scale=await node.evaluate(node=>node.getBoundingClientRect().width/node.offsetWidth);
  const b=await handle.boundingBox();
  await window.mouse.move(b.x+b.width/2,b.y+b.height/2);await window.mouse.down();
  await window.mouse.move(b.x+b.width/2+(axis==='e'?amount*scale:0),b.y+b.height/2+(axis==='s'?amount*scale:0),{steps:8});
  await window.mouse.up();
}

test('Web reflows without reload, keeps page input and matches clicks through host and board zoom', {timeout:60000}, async t => {
  const {url,requests}=await responsiveServer(t);
  const board=seed('pan',url);board.zoom=1;
  Object.assign(board.editorSettings,{previewMode:'realistic'});
  Object.assign(board.elements[1],{size:{width:1000,height:450},webAdBlock:false});
  const {app,window,errors}=await launch(t,board);
  await expect.poll(async()=>(await responsiveState(app)).width).toBe(1000);
  const initial=await responsiveState(app);
  assert.equal(initial.first.width,1000);assert.equal(initial.columns,3);
  await clickWebControl(app,window,'#state');await window.keyboard.type('Keep this page input');
  await expect.poll(async()=>(await responsiveState(app)).note).toBe('Keep this page input');
  await clickWebControl(app,window,'#target');await expect.poll(async()=>(await responsiveState(app)).clicks).toBe(1);
  await window.getByRole('button',{name:'Select Tool',exact:true}).click();await window.locator('[data-board-element-id="web"]').click();
  for(const [width,columns] of [[560,1],[820,2],[1100,3]]) {
    const current=await responsiveState(app);await resizeWeb(window,'e',width-current.width);
    await expect.poll(async()=>(await responsiveState(app)).width).toBe(width);
    const state=await responsiveState(app);assert.equal(state.columns,columns);assert.equal(state.marker,initial.marker);assert.equal(state.note,'Keep this page input');assert.equal(state.height,450);
  }
  await resizeWeb(window,'s',-150);await expect.poll(async()=>(await responsiveState(app)).height).toBe(300);
  for(const dimensions of [[1000,740],[1560,900],[1280,800]]) {
    await app.evaluate(({BrowserWindow},[width,height])=>BrowserWindow.getAllWindows()[0].setSize(width,height),dimensions);
    await expect.poll(()=>window.locator('[data-web-viewport]').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(1100);
    await expect.poll(async()=>(await responsiveState(app)).width).toBe(1100);
  }
  const visualBefore=await window.locator('[data-web-viewport]').boundingBox();
  await window.mouse.move(20,180);await window.keyboard.down('Control');await window.mouse.wheel(0,-100);await window.keyboard.up('Control');
  await expect.poll(async()=>(await window.locator('[data-web-viewport]').boundingBox()).width).toBeGreaterThan(visualBefore.width);
  assert.equal((await responsiveState(app)).width,1100);assert.equal((await responsiveState(app)).marker,initial.marker);
  await window.getByRole('button',{name:'Pan Tool (Hand)',exact:true}).click();
  await clickWebControl(app,window,'#target');await expect.poll(async()=>(await responsiveState(app)).clicks).toBe(2);
  assert.equal(requests.length,1);
  await nativeScreenshot(app,'web-responsive-desktop.png');
  assert.deepEqual(errors,[]);
});

test('Web device modes apply before load, agree in both menus and survive save/reopen', {timeout:60000}, async t => {
  const {url,requests}=await responsiveServer(t);
  const board=seed('select',url);board.zoom=1;board.height=1800;
  Object.assign(board.elements[1],{size:{width:1000,height:450},webAdBlock:false});
  const {app,window,errors}=await launch(t,board);
  await expect.poll(async()=>(await responsiveState(app)).width).toBe(1000);
  const partition=await window.locator('webview').getAttribute('partition');
  await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>c.getType()==='webview').executeJavaScript('document.cookie="remember=1; path=/"'));
  await window.locator('[data-board-element-id="web"]').click();
  await window.getByRole('button',{name:'Phone',exact:true}).click();
  await expect.poll(async()=>(await responsiveState(app)).first?.width).toBe(390);
  let state=await responsiveState(app);assert.match(state.cookie,/remember=1/);assert.equal(await window.locator('webview').getAttribute('partition'),partition);assert.deepEqual(state.screen,[390,700]);assert.equal(state.orientation,'portrait-primary');assert.equal(state.touch,5);assert.equal(state.coarse,true);assert.equal(state.hover,false);assert.equal(state.hints.mobile,true);assert.equal(state.hints.platform,'Android');assert.equal(state.first.touch,5);assert.match(requests.at(-1).ua,/Chrome.*Mobile/);if(requests.at(-1).mobile) assert.equal(requests.at(-1).mobile,'?1');
  await window.getByRole('button',{name:'Pan Tool (Hand)',exact:true}).click();
  await clickWebControl(app,window,'#state');await window.keyboard.type('Phone input');
  await expect.poll(async()=>(await responsiveState(app)).note).toBe('Phone input');assert.equal((await responsiveState(app)).lastClick.target,'state');
  await nativeScreenshot(app,'web-responsive-phone.png');
  assert.deepEqual((await responsiveState(app)).screen,[390,700]);
  await window.getByRole('button',{name:'Select Tool',exact:true}).click();
  await window.locator('[data-board-element-id="web"]').click();
  const phoneMarker=(await responsiveState(app)).marker;
  await resizeWeb(window,'s',-400);await resizeWeb(window,'e',300);
  await expect.poll(async()=>(await responsiveState(app)).screen).toEqual([690,300]);
  state=await responsiveState(app);assert.equal(state.orientation,'landscape-primary');assert.equal(state.marker,phoneMarker);assert.equal(state.note,'Phone input');assert.equal(state.columns,2);
  await window.getByRole('button',{name:'More',exact:true}).click();
  const menu=window.locator('[data-more-toolbar-item="embed"]');await menu.getByRole('button',{name:'Web settings',exact:true}).click();
  await menu.getByRole('button',{name:'Tablet',exact:true}).click();
  await expect.poll(async()=>(await responsiveState(app)).first?.width).toBe(768);
  state=await responsiveState(app);assert.deepEqual(state.screen,[768,1024]);assert.equal(state.height,1024);assert.equal(state.touch,5);assert.equal(state.hints.mobile,false);assert.equal(state.hints.platform,'Android');assert.equal(state.columns,2);
  await menu.getByRole('button',{name:'Desktop',exact:true}).click();
  await expect.poll(async()=>(await responsiveState(app)).first?.width).toBe(560);
  state=await responsiveState(app);assert.equal(state.touch,0);assert.equal(state.coarse,false);assert.equal(state.hover,true);assert.equal(state.hints.platform,'Windows');assert.equal(state.height,360);
  await menu.getByRole('button',{name:'Tablet',exact:true}).click();
  await expect.poll(async()=>(await responsiveState(app)).first?.width).toBe(768);
  await window.getByRole('button',{name:'More',exact:true}).click();
  await nativeScreenshot(app,'web-responsive-tablet.png');
  const rootId=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.id);
  await assert.rejects(window.evaluate(id=>window.noteboardAPI.configureWebViewport({guestId:id,deviceMode:'phone',width:390,height:700}),rootId),/does not belong/);
  await window.getByRole('button',{name:'Back',exact:true}).click();await window.reload();await window.getByRole('button',{name:'Open Native source',exact:true}).click();
  await expect.poll(async()=>(await responsiveState(app)).first?.width).toBe(768);
  assert.equal((await responsiveState(app)).touch,5);assert.match((await responsiveState(app)).cookie,/remember=1/);assert.deepEqual(errors,[]);
});
