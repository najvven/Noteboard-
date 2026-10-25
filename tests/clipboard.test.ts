import assert from 'node:assert/strict';
import test from 'node:test';
import { boardClipboardFormats, readBoardClipboard, placeClipboardElements } from '../src/features/board/clipboard';
import { usesAreaPlacement } from '../src/features/board/placement-interaction';
import { resizeHandleSize } from '../src/features/board/resize-geometry';
import type { BoardElement } from '../src/types';

const objects:BoardElement[]=[
  {id:'shape',type:'rectangle',position:{x:100,y:200},size:{width:80,height:60},content:'',color:'#000',zIndex:1},
  {id:'note',type:'text',position:{x:200,y:200},size:{width:100,height:60},content:'<b>Editable</b>',zIndex:2},
];

test('clipboard HTML survives system MIME normalization and does not recognize ordinary external text',()=>{
  const formats=boardClipboardFormats(objects,[]);
  const parsed=readBoardClipboard({getData:type=>type==='text/html'?`<html><body>${formats.html}</body></html>`:''});
  assert.deepEqual(parsed?.elements,objects);
  assert.equal(readBoardClipboard({getData:type=>type==='text/plain'?'A new external copy':''}),null);
  assert.equal(readBoardClipboard({getData:()=>'<span data-noteboard-clipboard="%broken">Bad</span>'}),null);
});

test('paste into a region fits one editable group and preserves text layout proportions',()=>{
  const pasted=placeClipboardElements(objects,{x:400,y:300,w:100,h:60});
  assert.equal(pasted.length,2);assert.equal(pasted[0].position.x,400);assert.equal(pasted[0].size?.width,40);
  assert.equal(pasted[1].position.x,450);assert.equal(pasted[1].textScale,.5);
  assert.equal(pasted[1].content,'<b>Editable</b>');assert.equal(pasted[1].size!.width/pasted[1].textScale!,100);
  assert.equal(objects[0].position.x,100);
});

test('all area tools honor the shared delay while freehand and direct tools retain their gestures',()=>{
  for(const tool of ['ellipse','line','arrow','rectangle','section','text','table','media','embed','board','select'])assert.equal(usesAreaPlacement(tool),true,tool);
  for(const tool of ['draw','pan','fill','eraser','crop','lasso','eyedropper'])assert.equal(usesAreaPlacement(tool),false,tool);
  assert.equal(resizeHandleSize(400,200,1),10);
  assert.equal(resizeHandleSize(24,24,1),6);
  assert.equal(resizeHandleSize(400,200,2)*2,10);
  assert.ok(resizeHandleSize(24,24,.5)*.5<6);
});
