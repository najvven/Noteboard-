import type { BoardElement } from '../../types';

const TEXT_TOOLS = new Set(['text', 'h1', 'h2', 'h3', 'bullet-list', 'numbered-list', 'quote', 'code', 'checklist']);

export function matchesElementTool(tool: string, element: Pick<BoardElement, 'type'>): boolean {
  if (TEXT_TOOLS.has(tool)) return TEXT_TOOLS.has(element.type);
  if (tool === 'media') return element.type === 'media' || element.type === 'image';
  return tool === element.type;
}

export function getElementPermissions({ tool, element, locked = false, handEditing = true, handMoving = false, matchingEditing = false, matchingMoving = false, webSelectInteraction = false, webHandInteraction = true }: {
  tool: string;
  element: Pick<BoardElement, 'type' | 'mediaMime'>;
  locked?: boolean;
  handEditing?: boolean;
  handMoving?: boolean;
  matchingEditing?: boolean;
  matchingMoving?: boolean;
  webSelectInteraction?: boolean;
  webHandInteraction?: boolean;
}) {
  const matching = matchesElementTool(tool, element);
  const cropTarget=tool==='crop'&&(element.type==='image'||(element.type==='media'&&/^(image|video)\//.test(element.mediaMime??'')));
  const canResize = !locked && element.type !== 'board' && (cropTarget || tool === 'select' || (tool === 'pan' && handEditing) || (matching && matchingEditing));
  const canMove = !locked && element.type !== 'board' && (tool === 'select' || (tool === 'pan' && handMoving) || (matching && matchingMoving));
  const canEditText = !locked && ((matching && (TEXT_TOOLS.has(element.type) || element.type === 'sticky' || element.type === 'section')) || tool === 'link');
  const canEditContent = canEditText || (!locked && matching && ['media', 'image', 'embed', 'table'].includes(element.type));
  const canInteractWeb = !locked && element.type === 'embed' &&
    (tool === 'embed' || (tool === 'select' && webSelectInteraction) || (tool === 'pan' && webHandInteraction));
  return { canResize, canMove, canEditText, canEditContent, canInteractWeb, canSelect: canResize || canMove || canEditContent || canInteractWeb || (!locked && tool === 'link') };
}
