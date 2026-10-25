import assert from 'node:assert/strict';
import test from 'node:test';
import { isFlippableElementType } from '../src/features/board/flip';

test('every rendered visual element can be flipped and structural tools cannot', () => {
  for (const type of [
    'text', 'h1', 'h2', 'h3', 'bullet-list', 'numbered-list', 'quote', 'code',
    'checklist', 'section', 'rectangle', 'ellipse', 'triangle', 'diamond',
    'hexagon', 'board', 'sticky', 'image', 'media', 'embed', 'table', 'draw',
    'line', 'blank', 'group', 'arrow',
  ]) assert.equal(isFlippableElementType(type), true, type);
  for (const type of ['layer', 'fill', 'unknown'])
    assert.equal(isFlippableElementType(type), false, type);
});
