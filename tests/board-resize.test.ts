import test from 'node:test';
import assert from 'node:assert/strict';
import { boardMemberIds, resizeMainBoard } from '../src/features/board/board-resize';
import type { BoardElement } from '../src/types';

const elements: BoardElement[]=[
  {id:'note',type:'text',content:'Text',position:{x:30,y:25},size:{width:100,height:30},zIndex:1},
  {id:'other',type:'board',content:'',position:{x:1000,y:100},size:{width:300,height:200},zIndex:0},
  {id:'other-note',type:'text',content:'Other',position:{x:1030,y:125},size:{width:100,height:30},zIndex:2},
];
test('top/left main-board resize holds world positions and the opposite edge at every zoom',()=>{
  const start={size:{width:800,height:600},position:{x:2000,y:2000}};
  for(const zoom of [.5,1,2,8,32]){
    const next=resizeMainBoard({start,elements,members:boardMemberIds(elements,'main-board',start.size),mode:'top-left',dx:-120,dy:-80,zoom,keepContent:true});
    assert.equal(next.geometry.position.x+next.geometry.size.width*zoom,start.position.x+start.size.width*zoom);
    assert.equal(next.geometry.position.y+next.geometry.size.height*zoom,start.position.y+start.size.height*zoom);
    elements.forEach((element,i)=>{assert.equal(next.geometry.position.x+next.elements[i].position.x*zoom,start.position.x+element.position.x*zoom);assert.equal(next.geometry.position.y+next.elements[i].position.y*zoom,start.position.y+element.position.y*zoom);});
  }
});
test('following the main board moves only its own content, leaving other boards stationary',()=>{
  const start={size:{width:800,height:600},position:{x:2000,y:2000}};
  const members=boardMemberIds(elements,'main-board',start.size);assert.deepEqual([...members],['note']);
  const next=resizeMainBoard({start,elements,members,mode:'top-left',dx:-100,dy:-60,zoom:2,keepContent:false});
  assert.deepEqual(next.elements[0].position,elements[0].position);
  assert.equal(next.geometry.position.x+next.elements[1].position.x*2,start.position.x+elements[1].position.x*2);
});
