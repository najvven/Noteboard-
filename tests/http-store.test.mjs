import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const board=(id,updatedAt=1,title='Board')=>({version:4,id,title,width:800,height:600,elements:[],updatedAt});

test('HTTP preconditions, batch bases and filesystem conflicts share definitive error contracts', {timeout:30000},async t=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'noteboard-http-store-'));
  const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['--import','tsx',path.join(root,'server.ts')],{cwd:root,env:{...process.env,NODE_ENV:'production',PORT:String(port),NOTEBOARD_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',data=>{logs=(logs+data).slice(-4000);});child.stderr.on('data',data=>{logs=(logs+data).slice(-4000);});
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await fs.rm(data,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let attempt=0;attempt<150;attempt++) {try{ready=(await fetch(`${base}/api/health`)).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(ready,logs);
  const request=(method,route,value,headers={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...headers},body:value===undefined?undefined:JSON.stringify(value)});
  let response=await request('PUT','/api/pages/one',board('one'));
  assert.equal(response.status,428);assert.equal((await response.json()).code,'BOARD_PRECONDITION_REQUIRED');
  assert.equal((await request('PUT','/api/pages/one',board('one'),{'If-None-Match':'*'})).status,200);
  assert.equal((await request('DELETE','/api/pages/one')).status,428);
  assert.equal((await request('PUT','/api/pages/one',board('one',2),{'If-Match':'invalid'})).status,400);
  assert.equal((await request('DELETE','/api/pages/bad.id',undefined,{'If-Match':'"1"'})).status,400);
  response=await request('PUT','/api/pages/one',board('one',99),{'If-Match':'"0"'});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'STALE_BOARD_REVISION');
  assert.equal((await request('PUT','/api/pages/one',board('one',2),{'If-Match':'"1"'})).status,200);
  assert.equal((await request('POST','/api/pages',[board('one',99)])).status,409);
  const pages=[board('new'),board('one',3,'Current')];
  assert.equal((await request('POST','/api/pages',{pages,baseRevisions:{new:null,one:1}})).status,409);
  await assert.rejects(fs.stat(path.join(data,'boards','new.json')),{code:'ENOENT'});
  const payload={pages,baseRevisions:{new:null,one:2}};
  assert.equal((await request('POST','/api/pages',payload)).status,200);
  assert.equal((await request('POST','/api/pages',payload)).status,200);
  if(process.platform==='win32') {
    assert.equal((await request('PUT','/api/pages/Abc',board('Abc'),{'If-None-Match':'*'})).status,200);
    response=await request('PUT','/api/pages/abc',board('abc'),{'If-None-Match':'*'});
    assert.equal(response.status,409);assert.equal((await response.json()).code,'BOARD_ID_PATH_COLLISION');
  }
  assert.equal((await request('DELETE','/api/pages/one',undefined,{'If-Match':'"3"'})).status,200);
  const saved=await (await fetch(`${base}/api/pages`)).json();
  assert.ok(!saved.some(page=>page.id==='one'));assert.ok(saved.some(page=>page.id==='new'));
});
