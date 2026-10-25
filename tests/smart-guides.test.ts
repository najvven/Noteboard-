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
test('distance guides include diagonal neighbors, real board pixels at any zoom and equal spacing',()=>{
  const moving=box('move',100,100),other=box('other',800,400);
  for(const zoom of [0.25,1,4]) {
    const result=smartGuides(moving,moving.position,[other],zoom,false);
    assert.ok(result.guides.some(guide=>guide.label==='600 px'));
    assert.ok(result.guides.some(guide=>guide.label==='250 px'&&guide.extensions?.length));
    assert.deepEqual(result.position,moving.position);
  }
  const result=smartGuides(moving,{x:200,y:100},[box('left',0,100),box('right',400,100)],1,false);
  assert.equal(result.guides.filter(guide=>guide.label==='100 px'&&guide.equalSpacing).length,2);
  assert.equal(smartGuides(moving,moving.position,[{...other,type:'board'}],1,false).guides.filter(guide=>guide.label).length,0);
});

test('sub-tenth-pixel gaps never produce a misleading zero-pixel distance label',()=>{
  const result=smartGuides(box('move',0,0),{x:0,y:0},[box('other',100.01,0)],1,false);
  assert.ok(result.guides.every(guide=>guide.label!=='0 px'));
});
