import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardElement } from '../src/types';
import { mergeSiblingLayers } from '../src/features/board/layer-merge';
import { createElementHierarchy } from '../src/features/board/element-hierarchy';
import { ungroupAreaElements } from '../src/features/board/grouping';

const source = (): BoardElement[] => [
  { id: 'outer', type: 'layer', position: { x: 0, y: 0 }, content: '', zIndex: 0, isLocked: true },
  { id: 'low', type: 'layer', parentId: 'outer', position: { x: 20, y: 30 }, size: { width: 300, height: 200 }, content: '', zIndex: 1, name: 'Lower', isHidden: true, isLinkTarget: true, linkTargetName: 'Lower target', opacity: 0.35 },
  { id: 'low-draw', type: 'draw', parentId: 'low', position: { x: 60, y: 70 }, size: { width: 80, height: 50 }, points: [{ x: 1, y: 2 }, { x: 30, y: 40 }], content: 'draw-data', zIndex: 70, opacity: 0.8 },
  { id: 'low-grandchild', type: 'text', parentId: 'low-draw', position: { x: 65, y: 75 }, size: { width: 40, height: 20 }, content: 'nested', zIndex: 1 },
  { id: 'middle', type: 'layer', parentId: 'outer', position: { x: 25, y: 35 }, content: '', zIndex: 2, name: 'Keep this sibling' },
  { id: 'middle-child', type: 'rectangle', parentId: 'middle', position: { x: 100, y: 100 }, size: { width: 20, height: 20 }, content: '', zIndex: 5 },
  { id: 'high', type: 'layer', parentId: 'outer', position: { x: 40, y: 50 }, size: { width: 500, height: 400 }, content: '', zIndex: 3, name: 'Highest', linkToId: 'external', isLocked: true },
  { id: 'high-rectangle', type: 'rectangle', parentId: 'high', position: { x: 200, y: 210 }, size: { width: 60, height: 40 }, content: '', zIndex: 1 },
  { id: 'incoming', type: 'text', position: { x: 700, y: 80 }, size: { width: 180, height: 40 }, content: '<p><a href="#target-low">named</a> <a href="#target-elsewhere">elsewhere</a></p><p>Example: href="#target-low"</p>', zIndex: 10, linkToId: 'low', groupOriginalParentId: 'low' },
];

test('merge requires sibling layers and keeps only the highest selected container', () => {
  const elements = source();
  const result = mergeSiblingLayers(elements, ['low', 'high']);
  assert.ok(result);
  assert.equal(result.survivorId, 'high');
  assert.deepEqual([...result.removedIds], ['low']);
  assert.equal(result.elements.some(element => element.id === 'low'), false);
  assert.equal(result.elements.some(element => element.id === 'middle'), true);
  assert.deepEqual(result.elements.find(element => element.id === 'high'), elements.find(element => element.id === 'high') && {
    ...elements.find(element => element.id === 'high')!, isHidden: false, isLocked: false,
    isLinkTarget: true, linkTargetName: 'Lower target',
  });
  for (const id of ['low-draw', 'low-grandchild', 'high-rectangle'])
    assert.deepEqual(result.elements.find(element => element.id === id)?.position, elements.find(element => element.id === id)?.position);
  for (const id of ['low-draw', 'low-grandchild', 'high-rectangle'])
    assert.deepEqual(result.elements.find(element => element.id === id)?.size, elements.find(element => element.id === id)?.size);
  assert.deepEqual(result.elements.map(element => element.id).sort(), elements.filter(element => element.id !== 'low').map(element => element.id).sort());
  assert.deepEqual(result.elements.find(element => element.id === 'low-draw')?.points, elements.find(element => element.id === 'low-draw')?.points);
  assert.equal(result.elements.find(element => element.id === 'low-draw')?.content, 'draw-data');
  assert.equal(result.elements.find(element => element.id === 'low-draw')?.opacity, 0.8);
  assert.equal(result.elements.find(element => element.id === 'low-draw')?.parentId, 'high');
  assert.equal(result.elements.find(element => element.id === 'high-rectangle')?.parentId, 'high');
  assert.equal(result.elements.find(element => element.id === 'low-grandchild')?.parentId, 'low-draw');
  assert.equal(result.elements.find(element => element.id === 'outer')?.isLocked, true);

  const hierarchy = createElementHierarchy(result.elements);
  assert.ok(hierarchy.compare(result.elements.find(element => element.id === 'low-draw')!, result.elements.find(element => element.id === 'high-rectangle')!) < 0);
  assert.ok(result.elements.find(element => element.id === 'low-draw')!.zIndex < result.elements.find(element => element.id === 'high-rectangle')!.zIndex);
  assert.equal(result.elements.find(element => element.id === 'low-draw')?.isHidden, true);
  assert.equal(result.elements.find(element => element.id === 'low-draw')?.isLocked, false);
  assert.equal(result.elements.find(element => element.id === 'high-rectangle')?.isHidden, false);
  assert.equal(result.elements.find(element => element.id === 'high-rectangle')?.isLocked, true);

  assert.equal(result.elements.find(element => element.id === 'incoming')?.linkToId, 'high');
  assert.equal(result.elements.find(element => element.id === 'incoming')?.groupOriginalParentId, 'high');
  assert.equal(result.elements.find(element => element.id === 'incoming')?.content, '<p><a href="#target-high">named</a> <a href="#target-elsewhere">elsewhere</a></p><p>Example: href="#target-low"</p>');
  assert.equal(result.elements.find(element => element.id === 'high')?.linkToId, 'external');
});

test('group ungroup restores a member whose old layer parent was removed', () => {
  const elements = source();
  elements.push(
    { id: 'group-in-low', type: 'group', parentId: 'low', position: { x: 300, y: 100 }, size: { width: 80, height: 50 }, content: '', zIndex: 10 },
    { id: 'group-member', type: 'rectangle', parentId: 'group-in-low', groupOriginalParentId: 'low', position: { x: 320, y: 110 }, size: { width: 20, height: 20 }, content: '', zIndex: 1 },
  );
  const merged = mergeSiblingLayers(elements, ['high', 'low'])!;
  assert.equal(merged.elements.find(element => element.id === 'group-in-low')?.parentId, 'high');
  assert.equal(merged.elements.find(element => element.id === 'group-member')?.groupOriginalParentId, 'high');
  const ungrouped = ungroupAreaElements(merged.elements, 'group-in-low');
  assert.equal(ungrouped.elements.find(element => element.id === 'group-member')?.parentId, 'high');
});

test('survivor target metadata wins; invalid and undersized selections are no-ops', () => {
  const elements = source().map(element => element.id === 'high'
    ? { ...element, isLinkTarget: true, linkTargetName: 'Highest target' }
    : element);
  const merged = mergeSiblingLayers(elements, ['low', 'high'])!;
  assert.equal(merged.elements.find(element => element.id === 'high')?.linkTargetName, 'Highest target');
  assert.equal(mergeSiblingLayers(elements, ['low']), null);
  assert.equal(mergeSiblingLayers(elements, ['low', 'outer']), null);
  assert.equal(mergeSiblingLayers(elements, ['low', 'incoming']), null);
});
