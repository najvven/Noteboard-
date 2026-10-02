import assert from 'node:assert/strict';
import test from 'node:test';
import type {BoardElement} from '../src/types';
import {mergeAreaElements,updateMergedGroup,ungroupAreaElements,isMergedGroupMember,localGroupElement} from '../src/features/board/grouping';
import {createElementHierarchy} from '../src/features/board/element-hierarchy';
import {cloneBoardDocument} from '../src/features/board/clone-board-document';
import {assertValidBoard} from '../shared/board-data.js';

const source=():BoardElement[]=>[
  {id:'layer-a',type:'layer',position:{x:0,y:0},content:'',zIndex:1},
  {id:'a',type:'rectangle',parentId:'layer-a',position:{x:100,y:160},size:{width:80,height:60},content:'',color:'#dbeafe',zIndex:1},
  {id:'layer-b',type:'layer',position:{x:0,y:0},content:'',zIndex:2},
  {id:'b',type:'text',parentId:'layer-b',position:{x:260,y:160},size:{width:100,height:60},content:'<b>Text</b>',zIndex:1},
  {id:'outside',type:'rectangle',position:{x:750,y:100},size:{width:70,height:40},content:'',linkToId:'b',zIndex:4},
];
const validate=(elements:BoardElement[])=>assertValidBoard({id:'test',title:'Test',elements});

test('merge creates one visible selectable group, absorbs its source layers and restores their hierarchy',()=>{
  const original=source(),merged=mergeAreaElements(original,['a','b'],'merged')!;
  validate(merged.elements);
  const hierarchy=createElementHierarchy(merged.elements);
  assert.equal(merged.elements.filter(element=>!element.parentId).length,2);
  assert.equal(isMergedGroupMember(merged.elements.find(element=>element.id==='a')!,hierarchy),true);
  assert.equal(merged.elements.find(element=>element.id==='outside')?.linkToId,'b');
  const undone=ungroupAreaElements(merged.elements,'merged');
  validate(undone.elements);
  for(const originalElement of original)assert.equal(undone.elements.find(element=>element.id===originalElement.id)?.parentId,originalElement.parentId);
  assert.deepEqual(undone.selectedIds,['a','b']);
  assert.equal(original[1].parentId,'layer-a');
});

test('merged objects move, scale and rotate together and ungroup at the transformed positions',()=>{
  const merged=mergeAreaElements(source(),['a','b'],'merged')!;
  const moved=updateMergedGroup(merged.elements,'merged',{position:{x:300,y:260}});
  assert.equal(moved.find(element=>element.id==='a')?.position.x,300);
  const scaled=updateMergedGroup(moved,'merged',{size:{width:520,height:120}});
  assert.equal(scaled.find(element=>element.id==='a')?.size?.width,160);
  assert.equal(scaled.find(element=>element.id==='b')?.textScale,2);
  const rotated=updateMergedGroup(scaled,'merged',{rotation:90});
  const group=rotated.find(element=>element.id==='merged')!;
  const local=localGroupElement(rotated.find(element=>element.id==='a')!,group);
  assert.ok(Math.abs(local.position.x)<.000001);assert.ok(Math.abs(local.position.y)<.000001);assert.equal(local.rotation,0);
  const ungrouped=ungroupAreaElements(rotated,'merged');
  validate(ungrouped.elements);assert.equal(ungrouped.elements.find(element=>element.id==='a')?.rotation,90);
  assert.equal(ungrouped.elements.find(element=>element.id==='outside')?.position.x,750);
});

test('copying a merged group remaps member IDs and restores only its own copied layers',()=>{
  const merged=mergeAreaElements(source(),['a','b'],'merged')!;
  const hierarchy=createElementHierarchy(merged.elements);
  const subtree=merged.elements.filter(element=>element.id==='merged'||hierarchy.isDescendantOf(element.id,'merged'));
  let sequence=0;const cloned=cloneBoardDocument(subtree,[],()=>`copy-${++sequence}`).elements;
  validate(cloned);
  const copyGroup=cloned.find(element=>element.type==='group')!;
  const ungrouped=ungroupAreaElements(cloned,copyGroup.id);
  validate(ungrouped.elements);
  assert.equal(ungrouped.elements.filter(element=>element.type==='layer').length,2);
  assert.ok(ungrouped.elements.filter(element=>element.type!=='layer').every(element=>element.parentId?.startsWith('element-copy-')));
});

test('merging only part of a layer keeps its unrelated content and restores the original parent',()=>{
  const original=source();original.push({...original[1],id:'outside-layer',position:{x:800,y:300}});
  const merged=mergeAreaElements(original,['a','b'],'merged')!;
  validate(merged.elements);
  assert.equal(merged.elements.find(element=>element.id==='layer-a')?.parentId,undefined);
  assert.equal(merged.elements.find(element=>element.id==='outside-layer')?.parentId,'layer-a');
  assert.equal(ungroupAreaElements(merged.elements,'merged').elements.find(element=>element.id==='a')?.parentId,'layer-a');
});
