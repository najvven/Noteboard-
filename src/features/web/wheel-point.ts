/** Map a guest viewport point through board scale, rotation and flips into host CSS coordinates. */
export function webWheelClientPoint(event: {
  guestId: number;
  guestX: number;
  guestY: number;
}) {
  const guest = [...document.querySelectorAll("webview")].find((node) => {
    try {
      return (node as any).getWebContentsId() === event.guestId;
    } catch {
      return false;
    }
  });
  const viewport = guest?.parentElement;
  if (!viewport) return null;
  let matrix = new DOMMatrix();
  for (
    let node: HTMLElement | null = viewport;
    node;
    node = node.parentElement
  ) {
    const transform = getComputedStyle(node).transform;
    if (transform !== "none")
      matrix = new DOMMatrix(transform).multiply(matrix);
  }
  // Translations are already represented by the measured viewport centre.
  const vector = new DOMPoint(
    event.guestX - viewport.clientWidth / 2,
    event.guestY - viewport.clientHeight / 2,
    0,
    0,
  ).matrixTransform(matrix);
  const bounds = viewport.getBoundingClientRect();
  return {
    clientX: bounds.x + bounds.width / 2 + vector.x,
    clientY: bounds.y + bounds.height / 2 + vector.y,
  };
}
