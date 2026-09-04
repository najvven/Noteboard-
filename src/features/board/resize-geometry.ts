export type ProportionalResizeAxis = "width" | "height";

interface ProportionalResizeInput {
  width: number;
  height: number;
  aspectRatio: number;
  minWidth: number;
  minHeight: number;
  primaryAxis: ProportionalResizeAxis;
  snap?: (value: number) => number;
}

/**
 * Applies snapping and minimum dimensions without ever breaking the requested
 * aspect ratio. Only the pointer-driven axis is snapped; the other axis is
 * derived from the ratio.
 */
export const constrainProportionalSize = ({
  width,
  height,
  aspectRatio,
  minWidth,
  minHeight,
  primaryAxis,
  snap = (value) => value,
}: ProportionalResizeInput) => {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0
    ? aspectRatio
    : 1;
  const ratioMinWidth = Math.max(0.0001, minWidth, minHeight * ratio);
  const ratioMinHeight = ratioMinWidth / ratio;

  if (primaryAxis === "height") {
    const snappedHeight = Math.abs(snap(Math.abs(height)));
    const nextHeight = Math.max(ratioMinHeight, snappedHeight);
    return { width: nextHeight * ratio, height: nextHeight };
  }

  const snappedWidth = Math.abs(snap(Math.abs(width)));
  const nextWidth = Math.max(ratioMinWidth, snappedWidth);
  return { width: nextWidth, height: nextWidth / ratio };
};
