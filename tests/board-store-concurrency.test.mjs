import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { loadStoredBoards, saveStoredBoard, saveStoredBoards } from '../shared/board-store.js';

const board = (id, updatedAt = 1, title = 'Initial') => ({version:4,id,title,width:800,height:600,elements:[],updatedAt});
async function directory(t) {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-process-store-'));
  t.after(() => fs.rm(value, {recursive:true,force:true}));
  return value;
}
async function worker(t, dir) {
  const child = fork(fileURLToPath(new URL('./fixtures/board-store-worker.mjs',import.meta.url)),[dir],{execArgv:[],stdio:['ignore','ignore','inherit','ipc']});
  t.after(async () => { if(child.exitCode === null && child.signalCode === null) {const exited=once(child,'exit');child.kill('SIGKILL');await exited;} });
  const [ready] = await once(child,'message');
  assert.equal(ready.ready,true);
  return child;
}
function write(child, value, baseRevision) {
  const response=once(child,'message'); child.send({board:value,baseRevision});
  return response.then(([result])=>result);
}

test('twenty synchronized cross-process races acknowledge exactly one conflicting edit', {timeout:30000}, async t => {
  const dir=await directory(t), a=await worker(t,dir), b=await worker(t,dir);
  for(let attempt=0;attempt<20;attempt++) {
    const id=`race-${attempt}`;
    await saveStoredBoard(dir,board(id),{baseRevision:null});
    const results=await Promise.all([write(a,board(id,2,'A'),1),write(b,board(id,3,'B'),1)]);
    assert.equal(results.filter(result=>result.ok).length,1,JSON.stringify(results));
    assert.equal(results.find(result=>!result.ok).code,'STALE_BOARD_REVISION');
    const saved=JSON.parse(await fs.readFile(path.join(dir,`${id}.json`),'utf8'));
    assert.equal(saved.title,results.find(result=>result.ok).title);
  }
});

test('a killed owner can be recovered after its lease expires, and identical ACK retries remain safe', {timeout:15000}, async t => {
  const dir=await directory(t), child=await worker(t,dir);
  await saveStoredBoard(dir,board('crash'),{baseRevision:null});
  const held=once(child,'message');child.send({type:'hold'});assert.equal((await held)[0].locked,true);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const old=new Date(Date.now()-31_000);
  await fs.utimes(`${dir}.lock`,old,old);
  const next=board('crash',2,'Recovered');
  await saveStoredBoard(dir,next,{baseRevision:1});
  await saveStoredBoard(dir,next,{baseRevision:1});
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'crash.json'),'utf8')).title,'Recovered');
  await assert.rejects(fs.stat(`${dir}.lock`),{code:'ENOENT'});
});

test('batch bases reject stale higher timestamps before any member is written', async t => {
  const dir=await directory(t);
  await saveStoredBoard(dir,board('existing'),{baseRevision:null});
  await saveStoredBoard(dir,board('existing',2,'Other editor'),{baseRevision:1});
  await assert.rejects(saveStoredBoards(dir,[board('new'),board('existing',99,'Stale')],
    {baseRevisions:{new:null,existing:1}}),{code:'STALE_BOARD_REVISION'});
  await assert.rejects(fs.stat(path.join(dir,'new.json')),{code:'ENOENT'});
  await assert.rejects(saveStoredBoards(dir,[board('existing',100)]),{code:'STALE_BOARD_REVISION'});
  const pages=[board('new'),board('existing',3,'Current')], options={baseRevisions:{new:null,existing:2}};
  await saveStoredBoards(dir,pages,options);
  await saveStoredBoards(dir,pages,options);
  assert.equal((await loadStoredBoards(dir)).find(page=>page.id==='existing').title,'Current');
});

test('canonical loads read each JSON once and a save scans the directory only once', async t => {
  const parent=await directory(t), originalOpen=fs.open;
  for(const count of [10,20,40]) {
    const dir=path.join(parent,String(count));await fs.mkdir(dir);
    for(let index=0;index<count;index++)await fs.writeFile(path.join(dir,`page-${index}.json`),JSON.stringify(board(`page-${index}`)));
    let reads=0;
    fs.open=async function(file,...args) {if(String(file).endsWith('.json')&&args[0]==='r')reads++;return originalOpen.call(this,file,...args);};
    try {
      assert.equal((await loadStoredBoards(dir)).length,count);
      assert.equal(reads,count);
      reads=0;await saveStoredBoard(dir,board('page-0',2),{baseRevision:1});
      assert.ok(reads<=count+4,`${count} boards required ${reads} JSON reads`);
    } finally {fs.open=originalOpen;}
  }
});

test('incremental migration never retires a canonical file newly assigned to another embedded id', async t => {
  const dir=await directory(t);
  await fs.writeFile(path.join(dir,'a.json'),JSON.stringify(board('b',2,'B')));
  await fs.writeFile(path.join(dir,'legacy.json'),JSON.stringify(board('a',1,'A')));
  const loaded=await loadStoredBoards(dir);
  assert.deepEqual(new Map(loaded.map(page=>[page.id,page.title])),new Map([['a','A'],['b','B']]));
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'a.json'),'utf8')).id,'a');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'b.json'),'utf8')).id,'b');
});
