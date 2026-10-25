import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from '../src/types.ts';
import { createSavedBoard, createSavedTemplate } from '../src/features/board/save-as.ts';
import { createBoardArchive, readBoardArchive } from '../src/features/board/board-package.ts';

const page = (): Page => ({
  id: 'original', title: 'Original', width: 1000, height: 800, updatedAt: 1, isPinned: true,
  editorSettings: { toolMenuSettingsOverrides: { text: { allowEditing: true } } },
  elements: [
    { id: 'parent', type: 'section', position: {x:0,y:0}, size:{width:500,height:500}, content:'', zIndex:0 },
    { id: 'text', type: 'text', parentId:'parent', linkToId:'parent', position:{x:20,y:20}, content:'<a href="#target-parent">Link</a>', crop:{left:0,right:0,top:0,bottom:0}, zIndex:1 },
    { id: 'image', type: 'media', position:{x:600,y:20}, content:'data:image/png;base64,AQIDBA==', mediaMime:'image/png', zIndex:2 },
  ],
});

test('Save as New Board remaps references and isolates every nested value', () => {
  const source=page(); let next=0;
  const copy=createSavedBoard(source,'Copy',()=>String(++next));
  assert.notEqual(copy.id,source.id);
  assert.equal(copy.title,'Copy');
  assert.equal(copy.isPinned,false);
  assert.equal(copy.elements[1].parentId,copy.elements[0].id);
  assert.equal(copy.elements[1].linkToId,copy.elements[0].id);
  assert.match(copy.elements[1].content,new RegExp(`#target-${copy.elements[0].id}`));
  copy.elements[1].crop!.left=10;
  copy.editorSettings!.toolMenuSettingsOverrides!.text.allowEditing=false;
  assert.equal(source.elements[1].crop!.left,0);
  assert.equal(source.editorSettings!.toolMenuSettingsOverrides!.text.allowEditing,true);
});

test('Save as Template retains content and settings without mutating the board', () => {
  const source=page(); const template=createSavedTemplate(source,'Template');
  assert.equal(template.name,'Template'); assert.equal(template.width,source.width);
  assert.equal(template.elements.length,3); assert.equal(template.isBuiltIn,false);
  template.elements[0].position.x=90;
  assert.equal(source.elements[0].position.x,0);
});

test('Save as File round trips the complete board and embedded media', async () => {
  const source=page(); const original=structuredClone(source);
  const bytes=await createBoardArchive(source);
  const restored=await readBoardArchive(bytes);
  assert.deepEqual(source,original);
  assert.equal((restored as Page).elements[2].content,source.elements[2].content);
  assert.equal((restored as Page).elements[1].parentId,'parent');
});
