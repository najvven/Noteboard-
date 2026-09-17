import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardSurface, findBoardSurface, boardSurfaceBounds, boardSurfaceStyle } from '../src/features/board/board-surfaces.ts';
test('main and additional boards use the same surface geometry and visuals', () => {
  const main = createBoardSurface('main-board', {x:0,y:0}, {width:100,height:100}, '#fff', -9999);
  const second = createBoardSurface('second', {x:150,y:-20}, {width:100,height:100}, '#fff', -1);
  assert.equal(findBoardSurface({x:160,y:0}, [main,second])?.id, 'second');
  assert.equal(findBoardSurface({x:10,y:10}, [main,second])?.id, 'main-board');
  assert.equal(findBoardSurface({x:125,y:10}, [main,second]), undefined);
  assert.deepEqual(boardSurfaceBounds(second), {minX:150,minY:-20,maxX:250,maxY:80});
  assert.deepEqual(boardSurfaceStyle(main,{showGrid:true}), boardSurfaceStyle(second,{showGrid:true}));
});
