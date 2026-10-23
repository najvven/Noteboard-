import type { BoardElement } from '../../types';
import { defaultTextFontSize, isScalableText } from './text-scaling';

export const DEFAULT_TEXT_LINE_COLOR = '#9ca3af';
export const DEFAULT_TEXT_LINE_THICKNESS = 1.5;
export const MIN_TEXT_LINE_THICKNESS = 0.25;
export const MAX_TEXT_LINE_THICKNESS = 100;
export const MIN_TEXT_LINE_SPACING = 1;

export interface ResolvedTextLineSettings {
  color: string;
  thickness: number;
  spacing: number;
}

const positiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Resolve old boards through their original frame-color and 1.5×font defaults. */
export function resolveTextLineSettings(
  element: Partial<BoardElement>,
): ResolvedTextLineSettings {
  const fontSize = positiveFinite(element.fontSize)
    ? element.fontSize
    : defaultTextFontSize(element.type);

  return {
    color: element.textLineColor || element.borderColor || DEFAULT_TEXT_LINE_COLOR,
    thickness: positiveFinite(element.textLineThickness)
      ? element.textLineThickness
      : DEFAULT_TEXT_LINE_THICKNESS,
    spacing: positiveFinite(element.textLineSpacing)
      ? element.textLineSpacing
      : Math.max(MIN_TEXT_LINE_SPACING, Math.round(fontSize * 1.5)),
  };
}

/** Persist resolved legacy rule styles before edits that used to change them implicitly. */
export function freezeTextLineDefaultsOnEdit(
  element: Partial<BoardElement>,
  updates: Partial<BoardElement>,
): Partial<BoardElement> {
  if (!isScalableText(element.type)) return updates;

  const fields = [
    'fontSize',
    'borderColor',
    'borderWidth',
    'textLineColor',
    'textLineThickness',
    'textLineSpacing',
  ] as const;
  if (!fields.some((field) => Object.prototype.hasOwnProperty.call(updates, field))) {
    return updates;
  }

  const resolved = resolveTextLineSettings(element);
  return {
    ...(element.textLineColor === undefined
      ? { textLineColor: resolved.color }
      : {}),
    ...(element.textLineThickness === undefined
      ? { textLineThickness: resolved.thickness }
      : {}),
    ...(element.textLineSpacing === undefined
      ? { textLineSpacing: resolved.spacing }
      : {}),
    ...updates,
  };
}
