import assert from 'node:assert/strict';
import test from 'node:test';
import { getElementPermissions } from '../src/features/board/interaction-permissions.ts';
test('text creation allows typing without granting transforms', () => {
  assert.deepEqual(getElementPermissions({ tool: 'text', element: { type: 'text' } }), { canResize: false, canMove: false, canEditText: true, canEditContent: true, canInteractWeb: false, canSelect: true });
});
test('opt-in transforms apply only to the matching creation tool', () => {
  const options = { tool: 'rectangle', matchingEditing: true, matchingMoving: true };
  assert.equal(getElementPermissions({ ...options, element: { type: 'rectangle' } }).canResize, true);
  assert.equal(getElementPermissions({ ...options, element: { type: 'ellipse' } }).canSelect, false);
  assert.equal(getElementPermissions({ ...options, element: { type: 'rectangle' }, locked: true }).canSelect, false);
});
test('Select permissions are independent from Hand settings', () => {
  assert.equal(getElementPermissions({ tool: 'select', element: { type: 'text' }, handEditing: false }).canMove, true);
  assert.equal(getElementPermissions({ tool: 'pan', element: { type: 'text' }, handEditing: false, handMoving: false }).canSelect, false);
  assert.equal(getElementPermissions({ tool: 'draw', element: { type: 'media' } }).canSelect, false);
});

test('Web page control is configurable for Select and Hand without changing resize permissions', () => {
  const element = {type:'embed'} as const;
  assert.equal(getElementPermissions({tool:'select',element}).canInteractWeb,false);
  const select = getElementPermissions({tool:'select',element,webSelectInteraction:true});
  assert.equal(select.canInteractWeb,true); assert.equal(select.canResize,true);
  assert.equal(getElementPermissions({tool:'pan',element,webHandInteraction:false}).canInteractWeb,false);
  assert.equal(getElementPermissions({tool:'pan',element,handEditing:false}).canInteractWeb,true);
});

test('Web page control never enables a locked field or an unrelated drawing tool', () => {
  const options = {element:{type:'embed'} as const,webSelectInteraction:true,webHandInteraction:true};
  assert.equal(getElementPermissions({...options,tool:'select',locked:true}).canInteractWeb,false);
  assert.equal(getElementPermissions({...options,tool:'draw'}).canInteractWeb,false);
});
