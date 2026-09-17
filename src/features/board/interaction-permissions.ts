import type { BoardElement } from '../../types';

const TEXT_TOOLS = new Set(['text', 'h1', 'h2', 'h3', 'bullet-list', 'numbered-list', 'quote', 'code', 'checklist']);

export function matchesElementTool(tool: string, element: Pick<BoardElement, 'type'>): boolean {
  if (TEXT_TOOLS.has(tool)) return TEXT_TOOLS.has(element.type);
  if (tool === 'media') return element.type === 'media' || element.type === 'image';
  return tool === element.type;
}

export function getElementPermissions({ tool, element, locked = false, handEditing = true, handMoving = false, matchingEditing = false, matchingMoving = false }: {
  tool: string;
  element: Pick<BoardElement, 'type'>;
  locked?: boolean;
  handEditing?: boolean;
  handMoving?: boolean;
  matchingEditing?: boolean;
  matchingMoving?: boolean;
}) {
  const matching = matchesElementTool(tool, element);
  const canResize = !locked && element.type !== 'board' && (tool === 'select' || (tool === 'pan' && handEditing) || (matching && matchingEditing));
  const canMove = !locked && element.type !== 'board' && (tool === 'select' || (tool === 'pan' && handMoving) || (matching && matchingMoving));
  const canEditText = !locked && ((matching && (TEXT_TOOLS.has(element.type) || element.type === 'sticky' || element.type === 'section')) || tool === 'link');
  const canEditContent = canEditText || (!locked && matching && ['media', 'image', 'embed'].includes(element.type));
  return { canResize, canMove, canEditText, canEditContent, canSelect: canResize || canMove || canEditContent || (!locked && tool === 'link') };
}
