const textTypes = new Set(['text', 'h1', 'h2', 'h3', 'bullet-list', 'numbered-list', 'quote', 'code', 'sticky', 'section']);
const shapeTypes = new Set(['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon']);
const strokeTypes = new Set(['line', 'arrow', 'draw']);

/** Match palettes to the properties actually rendered by each element. */
export function elementColors(type: string) {
  const text = textTypes.has(type);
  const strokeOnly = strokeTypes.has(type);
  return { text, strokeOnly, fill: text || shapeTypes.has(type), stroke: text || shapeTypes.has(type) || strokeOnly };
}

export function defaultFillColor(type: string) {
  if (type === 'sticky') return '#fef3c7';
  return textTypes.has(type) ? 'transparent' : '#ffffff';
}
