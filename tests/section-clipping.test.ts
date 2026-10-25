import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardElement } from '../src/types.ts';
import { getPlacementSection, getSectionVisiblePolygons, pointInPolygon } from '../src/features/board/section-clipping.ts';
const section: BoardElement = { id: 'section', type: 'section', position: { x: 100, y: 100 }, size: { width: 100, height: 100 }, content: '', zIndex: -1 };
const shape: BoardElement = { id: 'shape', type: 'rectangle', position: { x: 50, y: 150 }, size: { width: 200, height: 100 }, content: '', zIndex: 1 };
const visible = (element: BoardElement, x: number, y: number, sections = [section]) => getSectionVisiblePolygons(element, sections).some(p => pointInPolygon({ x, y }, p));
test('outside creation loses only its overlap with a section', () => {
  assert.equal(visible(shape, 75, 175), true);
  assert.equal(visible(shape, 150, 175), false);
  assert.equal(visible(shape, 225, 175), true);
  assert.equal(visible(shape, 150, 225), true);
});
test('inside creation stays clipped to its section after crossing the edge', () => {
  const inside = { ...shape, parentId: section.id };
  assert.equal(visible(inside, 150, 175), true);
  assert.equal(visible(inside, 75, 175), false);
  assert.equal(visible(inside, 150, 225), false);
  assert.equal(getPlacementSection({ x: 150, y: 150 }, [section])?.id, section.id);
});
test('overlapping exclusions do not reveal their intersection', () => {
  const second = { ...section, id: 'second', position: { x: 150, y: 120 } };
  assert.equal(visible(shape, 175, 175, [section, second]), false);
});
test('rotated section boundaries clip in board coordinates', () => {
  assert.equal(visible(shape, 150, 175, [{ ...section, rotation: 45 }]), false);
  assert.equal(visible(shape, 60, 240, [{ ...section, rotation: 45 }]), true);
});
test('section clipping follows the actual hierarchy stack, including parent layers', () => {
  const layer: BoardElement = {id:'layer',type:'layer',position:{x:0,y:0},content:'',zIndex:10};
  const behind = {...section,zIndex:3};
  const child = {...shape,parentId:'layer',zIndex:1};
  assert.equal(visible(child,150,175,[behind,layer]),false);
});
