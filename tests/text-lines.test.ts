import assert from 'node:assert/strict';
import test from 'node:test';
import { assertValidBoard } from '../shared/board-data.js';
import {
  freezeTextLineDefaultsOnEdit,
  resolveTextLineSettings,
} from '../src/features/board/text-lines';
import type { BoardElement } from '../src/types';

const textElement = (updates: Partial<BoardElement> = {}): BoardElement => ({
  id: 'text',
  type: 'text',
  position: { x: 0, y: 0 },
  content: 'Text',
  borderColor: '#334455',
  fontSize: 20,
  zIndex: 1,
  ...updates,
});

test('legacy text-line defaults preserve the old color, thickness, and 1.5x pitch', () => {
  assert.deepEqual(resolveTextLineSettings(textElement()), {
    color: '#334455',
    thickness: 1.5,
    spacing: 30,
  });
  assert.equal(resolveTextLineSettings(textElement({ type: 'h1', fontSize: undefined })).spacing, 54);
});

test('font and frame edits freeze legacy rule appearance before applying the edit', () => {
  const legacy = textElement();
  assert.deepEqual(freezeTextLineDefaultsOnEdit(legacy, { fontSize: 32 }), {
    textLineColor: '#334455',
    textLineThickness: 1.5,
    textLineSpacing: 30,
    fontSize: 32,
  });
  assert.deepEqual(freezeTextLineDefaultsOnEdit(legacy, { borderColor: '#ff0000' }), {
    textLineColor: '#334455',
    textLineThickness: 1.5,
    textLineSpacing: 30,
    borderColor: '#ff0000',
  });
  assert.deepEqual(
    freezeTextLineDefaultsOnEdit({ ...legacy, textLineColor: '#abcdef', textLineSpacing: 17 }, { borderWidth: 3 }),
    { textLineThickness: 1.5, borderWidth: 3 },
  );
  assert.deepEqual(freezeTextLineDefaultsOnEdit({ ...legacy, type: 'rectangle' }, { borderColor: '#fff' }), {
    borderColor: '#fff',
  });
});

test('shared board validation accepts bounded text-line settings and rejects malformed ones', () => {
  const page = { id: 'board', title: 'Board', elements: [textElement()] };
  for (const updates of [
    { textLineColor: '#abcdef', textLineThickness: 0.5, textLineSpacing: 10 },
    { textLineThickness: 100, textLineSpacing: 1 },
  ]) {
    assert.doesNotThrow(() => assertValidBoard({ ...page, elements: [{ ...textElement(), ...updates }] }));
  }
  for (const updates of [
    { textLineColor: 42 },
    { textLineThickness: 0 },
    { textLineThickness: 100.1 },
    { textLineSpacing: 0 },
    { textLineSpacing: Infinity },
  ]) {
    assert.throws(() => assertValidBoard({ ...page, elements: [{ ...textElement(), ...updates }] }));
  }
});
