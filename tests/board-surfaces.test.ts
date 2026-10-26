import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardSurface, findBoardSurface, boardSurfaceBounds, boardSurfaceStyle, elementBoardBoundary, resolveElementBoardOwner } from '../src/features/board/board-surfaces.ts';
test('main and additional boards use the same surface geometry and visuals', () => {
  const main = createBoardSurface('main-board', {x:0,y:0}, {width:100,height:100}, '#fff', -9999);
  const second = createBoardSurface('second', {x:150,y:-20}, {width:100,height:100}, '#fff', -1);
  assert.equal(findBoardSurface({x:160,y:0}, [main,second])?.id, 'second');
  assert.equal(findBoardSurface({x:10,y:10}, [main,second])?.id, 'main-board');
  assert.equal(findBoardSurface({x:125,y:10}, [main,second]), undefined);
  assert.deepEqual(boardSurfaceBounds(second), {minX:150,minY:-20,maxX:250,maxY:80});
  assert.deepEqual(boardSurfaceStyle(main,{showGrid:true}), boardSurfaceStyle(second,{showGrid:true}));
});

test('preview and element rendering share the board selected by placement origin',()=>{
  const secondary=createBoardSurface('secondary',{x:200,y:120},{width:180,height:160});
  assert.deepEqual(elementBoardBoundary({position:{x:220,y:140},size:{width:200,height:100}},[secondary],{width:1000,height:700}),[
    {x:200,y:120},{x:380,y:120},{x:380,y:280},{x:200,y:280},
  ]);
  assert.deepEqual(elementBoardBoundary({position:{x:20,y:20},size:{width:40,height:40}},[secondary],{width:1000,height:700}),[
    {x:0,y:0},{x:1000,y:0},{x:1000,y:700},{x:0,y:700},
  ]);
});

test('cropped pixel-fill ownership uses the interior when capture rounding puts its origin outside a board',()=>{
  const secondary=createBoardSurface('secondary',{x:200,y:120},{width:180,height:160});
  const roundedFill={position:{x:199.5,y:120},size:{width:120,height:100},isPixelFill:true};
  const ordinaryElement={position:roundedFill.position,size:roundedFill.size};
  assert.deepEqual(elementBoardBoundary(roundedFill,[secondary],{width:1000,height:700}),[
    {x:200,y:120},{x:380,y:120},{x:380,y:280},{x:200,y:280},
  ]);
  assert.deepEqual(elementBoardBoundary(ordinaryElement,[secondary],{width:1000,height:700}),[
    {x:0,y:0},{x:1000,y:0},{x:1000,y:700},{x:0,y:700},
  ]);
});

test('explicit board ancestry wins, while hidden implicit boards do not claim content',()=>{
  const first=createBoardSurface('first',{x:0,y:0},{width:200,height:200},'#fff',1);
  const overlapping=createBoardSurface('overlap',{x:100,y:0},{width:200,height:200},'#fff',5);
  const parented={id:'parented',type:'text' as const,content:'',position:{x:120,y:30},parentId:'first',zIndex:6};
  assert.deepEqual(elementBoardBoundary(parented,[first,overlapping],{width:500,height:400}),[
    {x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200},
  ]);
  const hidden={...overlapping,isHidden:true};
  assert.deepEqual(elementBoardBoundary({position:{x:120,y:30},size:{width:150,height:40}},[first,hidden],{width:500,height:400}),[
    {x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200},
  ]);
});

test('pixel fills keep the surface selected by the fill gesture when boards overlap',()=>{
  const first=createBoardSurface('first',{x:0,y:0},{width:200,height:200},'#fff',1);
  const overlapping=createBoardSurface('overlap',{x:100,y:0},{width:200,height:200},'#fff',5);
  const fill={
    id:'fill',type:'image' as const,content:'data:image/png;base64,',isPixelFill:true,pixelFillBoardId:'first',
    position:{x:90,y:40},size:{width:60,height:50},zIndex:8,
  };
  assert.equal(resolveElementBoardOwner(fill,[first,overlapping],{width:500,height:400})?.id,'first');
  assert.deepEqual(elementBoardBoundary(fill,[first,overlapping],{width:500,height:400}),[
    {x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200},
  ]);
});
