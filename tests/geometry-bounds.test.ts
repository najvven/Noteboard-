import assert from 'node:assert/strict';
import test from 'node:test';
import { pointExtrema, maximumBy, minimumBy } from '../src/features/board/geometry-bounds';
test('geometry supports validator-sized point sets without argument spreading',()=>{
  const points=Array.from({length:1_000_000},(_,index)=>({x:index-4,y:7-index}));
  assert.deepEqual(pointExtrema(points),{minX:-4,minY:-999_992,maxX:999_995,maxY:7});
  assert.equal(maximumBy(points,point=>point.x),999_995);
  assert.equal(minimumBy(points,point=>point.y),-999_992);
  assert.deepEqual(pointExtrema([{x:2,y:3}]),{minX:2,minY:3,maxX:2,maxY:3});
  assert.equal(maximumBy([],()=>0),-Infinity);
  assert.equal(minimumBy([],()=>0),Infinity);
});
