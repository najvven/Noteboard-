import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {withBoardStoreLock} from '../shared/store-lock.js';
import {loadStoredBoards, saveStoredBoard} from '../shared/board-store.js';

async function fixture(t) {
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'noteboard-lease-'));
  t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  const directory=path.join(parent,'boards');await fs.mkdir(directory);
  return {parent,directory};
}

test('losing a store lease rejects the operation before its final mutation or acknowledgment', {timeout:10000}, async t=>{
  const {directory}=await fixture(t);
  const started=Promise.withResolvers();let mutated=false;
  const operation=withBoardStoreLock(directory,async assertHeld=>{
    started.resolve();
    const deadline=Date.now()+6500;
    while(Date.now()<deadline){await delay(50);assertHeld();}
    mutated=true;
  });
  // Attach rejection handling before removing this fixture's lease.
  const rejected=assert.rejects(operation,{code:'ECOMPROMISED'});
  await started.promise;await fs.rmdir(`${directory}.lock`);
  await rejected;
  assert.equal(mutated,false);
  await saveStoredBoard(directory,{id:'after-lease-loss',title:'Recovered store',elements:[],updatedAt:1},{baseRevision:null});
  assert.equal((await loadStoredBoards(directory))[0].id,'after-lease-loss');
});

test('read leases and heartbeats do not generate board-directory change notifications', {timeout:7000},async t=>{
  const {directory}=await fixture(t),events=[];
  const watcher=watch(directory,(_event,file)=>events.push(String(file)));
  try {
    await withBoardStoreLock(directory,async assertHeld=>{await delay(2200);assertHeld();});
    await delay(30);
    assert.deepEqual(events,[]);
  }finally{watcher.close();}
});

test('different directory aliases share one physical store lease and preserve both sequential writes',async t=>{
  const {parent,directory}=await fixture(t),alias=path.join(parent,'alias');
  await fs.symlink(directory,alias,process.platform==='win32'?'junction':'dir');
  const held=Promise.withResolvers(),release=Promise.withResolvers();let entered=false;
  const first=withBoardStoreLock(directory,async()=>{held.resolve();await release.promise;});
  await held.promise;
  const second=withBoardStoreLock(alias,async()=>{entered=true;});
  await delay(70);assert.equal(entered,false);
  release.resolve();await Promise.all([first,second]);assert.equal(entered,true);
  await assert.rejects(fs.stat(`${directory}.lock`),{code:'ENOENT'});
});
