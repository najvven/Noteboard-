import assert from 'node:assert/strict';
import test from 'node:test';
import {insideSelection,outlinesIntersect,selectElementsInOutline,combineSelection} from '../src/features/board/selection';
import type {BoardElement} from '../src/types';

test('freehand selection respects concave boundaries and crossed edges',()=>{
  const lasso=[{x:0,y:0},{x:100,y:0},{x:100,y:30},{x:30,y:30},{x:30,y:100},{x:0,y:100}];
  assert.equal(insideSelection({x:10,y:70},lasso),true);assert.equal(insideSelection({x:70,y:70},lasso),false);
  assert.equal(outlinesIntersect(lasso,[{x:20,y:50},{x:50,y:50},{x:50,y:70},{x:20,y:70}]),true);
});

test('selection ignores hidden/locked objects and uses only visible clipped geometry',()=>{
  const base:BoardElement={id:'box',type:'rectangle',position:{x:10,y:10},size:{width:80,height:80},content:'',zIndex:1};
  const section:BoardElement={...base,id:'section',type:'section',position:{x:50,y:0},size:{width:100,height:100},zIndex:0};
  const outline=[{x:60,y:20},{x:70,y:20},{x:70,y:30},{x:60,y:30}];
  const elements=[section,base,{...base,id:'hidden',isHidden:true},{...base,id:'locked',isLocked:true}];
  assert.deepEqual(selectElementsInOutline(elements,outline),['section']);
  assert.deepEqual(selectElementsInOutline([{...base,parentId:'section'},section],outline),['box','section']);
  assert.deepEqual(combineSelection(['a','b'],['b','c'],'add'),['a','b','c']);
  assert.deepEqual(combineSelection(['a','b'],['b'],'subtract'),['a']);
});
