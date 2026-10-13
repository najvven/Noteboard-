import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createAdExtensionManager} from '../shared/electron-ad-extension.js';

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'noteboard-ad-runtime-'));
  t.after(async()=>{
    const resolved=path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('noteboard-ad-runtime-'));
    await fs.rm(resolved,{recursive:true,force:true});
  });
  const source=path.join(directory,'source');await fs.mkdir(source);
  for(const name of ['manifest.json','background.js'])await fs.writeFile(path.join(source,name),'fixture');
  const contents=[],requests=[],counts={loads:0,serialization:0,configuration:0,removal:0};
  let decideRequest=()=>({cancel:true});
  const runtime={isPersistent:()=>true,extensions:new EventEmitter()};
  runtime.extensions.loadExtension=async()=>{
    counts.loads++;let initialized=false;const background={session:runtime,dead:false,isDestroyed(){return this.dead;},getType:()=> 'backgroundPage',getURL:()=> 'chrome-extension://real-extension/background.html',
      async executeJavaScript(script){
        if(script.startsWith('Boolean('))return true;
        if(script.includes('.configure(')){counts.configuration++;await new Promise(resolve=>setTimeout(resolve,5));initialized=true;return {ready:true};}
        if(script.includes('.status('))return {ready:true,enabled:true,ads:999};
        assert.ok(initialized,'A request cannot reach the matcher before its verified filters are ready');
        const start=script.indexOf('filterRequest(')+'filterRequest('.length;
        const request=JSON.parse(script.slice(start,-1));
        requests.push(request);return decideRequest(request);
      },
    };contents.push(background);return {id:'real-extension'};
  };
  runtime.extensions.removeExtension=()=>{counts.removal++;for(const item of contents)if(item.session===runtime)item.dead=true;};
  const service={manifest:{sha256:'first'},engine:{serialize(){counts.serialization++;return Buffer.from('verified snapshot');}}};
  const manager=createAdExtensionManager({webContents:{getAllWebContents:()=>contents},sourceDirectory:source,targetDirectory:path.join(directory,'runtime'),getFilterService:async()=>service,getExtensionSession:()=>runtime});
  return {manager,contents,requests,counts,service,setDecision(fn){decideRequest=fn;}};
}

test('blocked request totals describe each originating Web session while sharing one filter engine',async t=>{
  const {manager,counts,requests,service,setDecision}=await fixture(t),blockedSession={},cleanSession={},off={};
  setDecision(request=>({cancel:request.url.includes('blocked.test')}));
  await Promise.all([
    manager.configure(blockedSession,{adBlock:true,topLevelUrl:'https://first.test'}),
    manager.configure(cleanSession,{adBlock:true,topLevelUrl:'https://clean.test'}),
    manager.configure(off,{adBlock:false,topLevelUrl:'https://second.test'}),
  ]);
  assert.equal(counts.loads,1);assert.equal(counts.configuration,1);assert.equal(counts.serialization,1);
  assert.equal((await manager.status(blockedSession)).enabled,true);assert.equal((await manager.status(off)).enabled,false);
  assert.equal((await manager.status(blockedSession)).ads,0);
  assert.deepEqual(await manager.filterRequest(off,{url:'https://ads.test',resourceType:'script'},''),{cancel:false});
  assert.equal(requests.length,0);
  assert.deepEqual(await manager.filterRequest(blockedSession,{url:'https://blocked.test/ad.js',resourceType:'script',id:1,webContentsId:7},'https://first.test'),{cancel:true});
  assert.deepEqual(await manager.filterRequest(cleanSession,{url:'https://publisher.test/app.js',resourceType:'script',id:2,webContentsId:8},'https://clean.test'),{cancel:false});
  assert.match(requests[0].initiator,/first\.test/);
  assert.equal((await manager.status(blockedSession)).ads,1);
  assert.equal((await manager.status(cleanSession)).ads,0);
  assert.equal((await manager.status(off)).ads,0);
  service.manifest={sha256:'second'};await Promise.all([manager.refresh(),manager.configure(blockedSession,{adBlock:true})]);
  assert.equal(counts.configuration,2);assert.equal(counts.serialization,2);
});

test('idle cleanup retains live guests, unloads the unused engine and restores its per-session total on reopening',async t=>{
  const {manager,contents,counts}=await fixture(t),webSession={};
  await manager.configure(webSession,{adBlock:true});
  await manager.filterRequest(webSession,{url:'https://ads.test',resourceType:'script',id:1,webContentsId:1},'https://first.test');
  assert.equal((await manager.status(webSession)).ads,1);
  const guest={session:webSession,dead:false,isDestroyed(){return this.dead;},getType:()=> 'webview'};contents.push(guest);
  await manager.releaseIdleSessions(0);assert.equal(counts.removal,0);
  guest.dead=true;await manager.releaseIdleSessions(0);assert.equal(counts.removal,1);assert.equal(await manager.status(webSession),null);
  await manager.configure(webSession,{adBlock:true});assert.equal(counts.loads,2);assert.equal((await manager.status(webSession)).ready,true);assert.equal((await manager.status(webSession)).ads,1);
});

test('fields with blocking disabled do not allocate a filter engine',async t=>{
  const {manager,counts}=await fixture(t);
  await manager.configure({}, {adBlock:false});assert.equal(counts.loads,0);assert.equal(counts.serialization,0);
});

test('a request arriving during initial configuration waits for the filter engine',async t=>{
  const {manager,requests}=await fixture(t),webSession={};
  const configuring=manager.configure(webSession,{adBlock:true});
  const request=manager.filterRequest(webSession,{url:'https://ads.test',resourceType:'script'},'https://publisher.test');
  const [,result]=await Promise.all([configuring,request]);
  assert.deepEqual(result,{cancel:true});assert.equal(requests.length,1);
});
