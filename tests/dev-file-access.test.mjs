import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

for(const custom of [false,true])test(`dev static serving denies runtime JSON and symlink targets (${custom?'custom':'default'} data directory)`,{timeout:30000},async t=>{
  const parent=path.join(root,'.tmp/task25');await fs.mkdir(parent,{recursive:true});
  const fixture=await fs.mkdtemp(path.join(parent,'dev-fs-'));
  const data=path.join(fixture,custom?'custom-runtime':'data');
  const secret=`PRIVATE_FIXTURE_${Date.now()}`;
  await fs.mkdir(path.join(data,'boards'),{recursive:true});
  await fs.writeFile(path.join(fixture,'index.html'),'<html><body>Public fixture</body></html>');
  await fs.writeFile(path.join(data,'boards/private.json'),JSON.stringify({version:4,id:'private',title:secret,width:800,height:600,elements:[],updatedAt:1}));
  await fs.writeFile(path.join(data,'presets.json'),JSON.stringify([{name:secret}]));
  await fs.symlink(data,path.join(fixture,'public-link'),process.platform==='win32'?'junction':'dir');
  const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const env={...process.env,PORT:String(port),NODE_ENV:'development',DISABLE_HMR:'true'};
  if(custom)env.NOTEBOARD_DATA_DIR=data;else delete env.NOTEBOARD_DATA_DIR;
  const child=spawn(process.execPath,['--import','tsx',path.join(root,'server.ts')],{cwd:fixture,env,stdio:['ignore','pipe','pipe']});
  let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs=(logs+data).slice(-6000);});
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.ok(fixture.startsWith(parent+path.sep));await fs.rm(fixture,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;for(let index=0;index<150;index++){try{ready=(await fetch(base+'/api/health')).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,logs);
  const folder=custom?'custom-runtime':'data';
  for(const url of [`/${folder}/boards/private.json`,`/${folder}/presets.json`,`/${folder}/boards/private.json?raw`,`/${folder}/boards/private.json?url`,
    `/${folder}/boards/%70rivate.json`,`/${folder}%2fboards%2fprivate.json`,`/public-link/boards/private.json`,
    `/@fs/${path.join(data,'boards/private.json').replaceAll('\\','/')}`]) {
    const response=await fetch(base+url),body=await response.text();
    assert.ok(!body.includes(secret),`${url} exposed a runtime fixture`);
    assert.equal(response.status,403,url);
  }
  const pages=await(await fetch(base+'/api/pages')).json();assert.equal(pages[0].title,secret);
  assert.ok((await(await fetch(base+'/')).text()).includes('Public fixture'));
});
