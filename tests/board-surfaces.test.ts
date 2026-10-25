import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardSurface, findBoardSurface, boardSurfaceBounds, boardSurfaceStyle, elementBoardBoundary } from '../src/features/board/board-surfaces.ts';
test('main and additional boards use the same surface geometry and visuals', () => {
  const main = createBoardSurface('main-board', {x:0,y:0}, {width:100,height:100}, '#fff', -9999);
  const second = createBoardSurface('second', {x:150,y:-20}, {width:100,height:100}, '#fff', -1);
  assert.equal(findBoardSurface({x:160,y:0}, [main,second])?.id, 'second');
  assert.equal(findBoardSurface({x:10,y:10}, [main,second])?.id, 'main-board');
  assert.equal(findBoardSurface({x:125,y:10}, [main,second]), undefined);
  assert.deepEqual(boardSurfaceBounds(second), {minX:150,minY:-20,maxX:250,maxY:80});
  assert.deepEqual(boardSurfaceStyle(main,{showGrid:true}), boardSurfaceStyle(second,{showGrid:true}));
});

test('preview and element rendering share the Main or additional board boundary under their center',()=>{
  const secondary=createBoardSurface('secondary',{x:200,y:120},{width:180,height:160});
  assert.deepEqual(elementBoardBoundary({position:{x:150,y:140},size:{width:200,height:100}},[secondary],{width:1000,height:700}),[
    {x:200,y:120},{x:380,y:120},{x:380,y:280},{x:200,y:280},
  ]);
  assert.deepEqual(elementBoardBoundary({position:{x:20,y:20},size:{width:40,height:40}},[secondary],{width:1000,height:700}),[
    {x:0,y:0},{x:1000,y:0},{x:1000,y:700},{x:0,y:700},
  ]);
});
