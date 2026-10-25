import assert from 'node:assert/strict';
import test from 'node:test';
import {insideSelection,outlinesIntersect,selectElementsInOutline,combineSelection} from '../src/features/board/selection';
import {getSectionVisiblePolygons,elementPolygon,isPointInVisibleElementArea} from '../src/features/board/section-clipping';
import type {BoardElement} from '../src/types';

test('freehand selection respects concave boundaries and crossed edges',()=>{
  const lasso=[{x:0,y:0},{x:100,y:0},{x:100,y:30},{x:30,y:30},{x:30,y:100},{x:0,y:100}];
  assert.equal(insideSelection({x:10,y:70},lasso),true);assert.equal(insideSelection({x:70,y:70},lasso),false);
  assert.equal(outlinesIntersect(lasso,[{x:20,y:50},{x:50,y:50},{x:50,y:70},{x:20,y:70}]),true);
});

test('hidden and locked filters are independent from clipping geometry',()=>{
  const base:BoardElement={id:'box',type:'rectangle',position:{x:10,y:10},size:{width:80,height:80},content:'',zIndex:1};
  const outline=[{x:20,y:20},{x:30,y:20},{x:30,y:30},{x:20,y:30}];
  const hiddenParent:BoardElement={...base,id:'hidden-parent',type:'section',position:{x:500,y:500},isHidden:true};
  const lockedParent:BoardElement={...base,id:'locked-parent',type:'layer',position:{x:500,y:500},isLocked:true};
  const elements=[
    base,
    {...base,id:'hidden',isHidden:true},
    {...base,id:'locked',isLocked:true},
    hiddenParent,{...base,id:'hidden-child',parentId:'hidden-parent'},
    lockedParent,{...base,id:'locked-child',parentId:'locked-parent'},
  ];
  assert.deepEqual(selectElementsInOutline(elements,outline),['box']);
});

test('selection also respects visible section clipping and combines add/subtract operations',()=>{
  const base:BoardElement={id:'box',type:'rectangle',position:{x:10,y:10},size:{width:80,height:80},content:'',zIndex:1};
  const section:BoardElement={...base,id:'section',type:'section',position:{x:50,y:0},size:{width:100,height:100},zIndex:0};
  const outline=[{x:60,y:20},{x:70,y:20},{x:70,y:30},{x:60,y:30}];
  assert.deepEqual(selectElementsInOutline([{...base,parentId:'section'},section],outline),['box','section']);
  assert.deepEqual(combineSelection(['a','b'],['b','c'],'add'),['a','b','c']);
  assert.deepEqual(combineSelection(['a','b'],['b'],'subtract'),['a']);
});

test('a nested child section does not clip its parent section',()=>{
  const parent:BoardElement={id:'parent',type:'section',position:{x:10,y:20},size:{width:300,height:200},content:'',zIndex:1};
  const child:BoardElement={...parent,id:'child',position:{x:80,y:70},size:{width:50,height:60},zIndex:2,parentId:'parent'};
  assert.deepEqual(getSectionVisiblePolygons(parent,[parent,child]),[elementPolygon(parent)]);
});

test('pointer hit testing follows the visible section-clipped polygons',()=>{
  const front:BoardElement={id:'front',type:'rectangle',position:{x:100,y:100},size:{width:200,height:100},content:'',zIndex:2};
  const section:BoardElement={id:'clip',type:'section',position:{x:150,y:100},size:{width:100,height:100},content:'',zIndex:1};
  assert.equal(isPointInVisibleElementArea(front,[section,front],{x:120,y:150}),true);
  assert.equal(isPointInVisibleElementArea(front,[section,front],{x:200,y:150}),false);
});
