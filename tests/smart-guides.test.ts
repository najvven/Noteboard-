import assert from 'node:assert/strict';
import test from 'node:test';
import type {BoardElement} from '../src/types';
import {smartGuides} from '../src/features/board/smart-guides';
const box=(id:string,x:number,y:number):BoardElement=>({id,type:'rectangle',position:{x,y},size:{width:100,height:50},content:'',zIndex:1});
test('Smart Guides show exact gaps and only snap when requested',()=>{
  const moving=box('move',0,0),other=box('other',250,100);
  const result=smartGuides(moving,{x:5,y:98},[other],1,false);
  assert.deepEqual(result.position,{x:5,y:98});assert.ok(result.guides.some(guide=>guide.label==='145 px'));
  assert.ok(result.guides.some(guide=>guide.kind==='alignment'&&guide.y1===100));
  assert.deepEqual(smartGuides(moving,{x:5,y:98},[other],1,true).position,{x:5,y:100});
  assert.equal(smartGuides(moving,{x:5,y:98},[other],4,true).position.y,98);
});
