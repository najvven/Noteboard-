import assert from 'node:assert/strict';
import test from 'node:test';
import { getTextScale, isTextScaling, displayedTextFontSize, resizedTextScale } from '../src/features/board/text-scaling';
import { assertValidBoard } from '../shared/board-data.js';
import type { BoardElement } from '../src/types';

test('text scaling preserves layout coordinates over repeated proportional resizes', () => {
  let element: BoardElement = {id:'text',type:'text',position:{x:0,y:0},size:{width:350,height:200},content:'<h1>Title</h1><p>Mixed <b>formatting</b></p>',fontSize:18,textScaling:true,zIndex:1};
  for (const ratio of [1.5,0.5,2,1.25,0.8]) {
    const before=element.size!;
    element={...element,textScale:resizedTextScale(element,before.width,before.width*ratio),size:{width:before.width*ratio,height:before.height*ratio}};
    assert.equal(element.size!.width/getTextScale(element),350);
    assert.equal(element.size!.height/getTextScale(element),200);
    assert.equal(element.fontSize,18);
  }
  assert.equal(isTextScaling(element),true);
  assert.equal(isTextScaling({...element,textScaling:false}),false);
  assert.equal(displayedTextFontSize({...element,textScale:2}),36);
});

test('saved text scaling accepts valid factors and rejects malformed state', () => {
  const element: BoardElement={id:'text',type:'text',position:{x:0,y:0},size:{width:350,height:200},content:'Text',textScaling:true,textScale:1.5,zIndex:1};
  const page={id:'page',title:'Text',elements:[element]};
  assert.doesNotThrow(()=>assertValidBoard(JSON.parse(JSON.stringify(page))));
  for (const value of [0,-1,Infinity,NaN,'2']) assert.throws(()=>assertValidBoard({...page,elements:[{...element,textScale:value}]}),/text scale/);
  assert.throws(()=>assertValidBoard({...page,elements:[{...element,textScaling:'yes'}]}),/text scaling/);
});
