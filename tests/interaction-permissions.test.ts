import assert from 'node:assert/strict';
import test from 'node:test';
import { getElementPermissions } from '../src/features/board/interaction-permissions.ts';
test('text creation allows typing without granting transforms', () => {
  assert.deepEqual(getElementPermissions({ tool: 'text', element: { type: 'text' } }), { canResize: false, canMove: false, canEditText: true, canEditContent: true, canSelect: true });
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
