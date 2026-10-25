const normalize = key => ({ control: 'ctrl', command: 'meta', cmd: 'meta', ' ': 'space' }[String(key).toLowerCase()] || String(key).toLowerCase());

export function matchesWebZoomShortcut(shortcut = 'Ctrl', event = {}, pressed = []) {
  const required = shortcut.split('+').map(part => normalize(part.trim())).filter(Boolean);
  if (!required.length) return true;
  const down = new Set(pressed.map(normalize).filter(key=>!['ctrl','meta','alt','shift'].includes(key)));
  if (event.ctrlKey) down.add('ctrl');
  if (event.metaKey) down.add('meta');
  if (event.altKey) down.add('alt');
  if (event.shiftKey) down.add('shift');
  return required.every(key => down.has(key));
}
