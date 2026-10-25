import type { BoardElement, ElementType } from '../../types';

export const SCALABLE_TEXT_TYPES: readonly ElementType[] = ['text', 'h1', 'h2', 'h3', 'bullet-list', 'numbered-list'];
export const isScalableText = (type?: string) => SCALABLE_TEXT_TYPES.includes(type as ElementType);
export const getTextScale = (element: Partial<BoardElement>) =>
  Number.isFinite(element.textScale) && element.textScale! > 0 ? element.textScale! : 1;
export const isTextScaling = (element: Partial<BoardElement>) => isScalableText(element.type) && element.textScaling === true;
export const defaultTextFontSize = (type?: string) => type === 'h1' ? 36 : type === 'h2' ? 24 : type === 'h3' ? 18 : 16;
export const displayedTextFontSize = (element: Partial<BoardElement>, type = element.type) =>
  Math.round((element.fontSize || defaultTextFontSize(type)) * (isScalableText(type) ? getTextScale(element) : 1) * 100) / 100;

/** Keep the layout's coordinate system fixed; CSS scales all rich-text descendants together. */
export const resizedTextScale = (element: Partial<BoardElement>, initialWidth: number, width: number) =>
  getTextScale(element) * width / initialWidth;
