import React, { forwardRef, useImperativeHandle, useState } from "react";
import type { SmartGuide } from "../features/board/smart-guides";

export interface SmartGuidesHandle {
  setGuides: (guides: SmartGuide[]) => void;
}
const SmartGuidesOverlay = forwardRef<
  SmartGuidesHandle,
  { zoom: number; width: number; height: number }
>(function SmartGuidesOverlay({ zoom, width, height }, ref) {
  const [guides, setGuides] = useState<SmartGuide[]>([]);
  useImperativeHandle(ref, () => ({ setGuides }), []);
  if (!guides.length) return null;
  return (
    <svg
      data-smart-guides="true"
      className="absolute inset-0 overflow-visible pointer-events-none"
      style={{ width, height, zIndex: 100002 }}
    >
      {guides.map((guide, index) => (
        <g key={index} data-guide-kind={guide.kind} data-equal-spacing={guide.equalSpacing || undefined} stroke="#d946b5" strokeWidth={1 / zoom}>
          <line
            x1={guide.x1}
            y1={guide.y1}
            x2={guide.x2}
            y2={guide.y2}
          />
          {guide.extensions?.map((segment,i) => <line key={`extension-${i}`} {...segment} strokeDasharray={`${3 / zoom} ${3 / zoom}`} />)}
          {guide.kind === "distance" && (
            <>
              {[
                [guide.x1, guide.y1],
                [guide.x2, guide.y2],
              ].map(([x, y], i) => (
                <line
                  key={i}
                  x1={x - (guide.x1 === guide.x2 ? 4 / zoom : 0)}
                  y1={y - (guide.y1 === guide.y2 ? 4 / zoom : 0)}
                  x2={x + (guide.x1 === guide.x2 ? 4 / zoom : 0)}
                  y2={y + (guide.y1 === guide.y2 ? 4 / zoom : 0)}
                />
              ))}
              <g
                transform={`translate(${(guide.x1 + guide.x2) / 2},${(guide.y1 + guide.y2) / 2 - 8 / zoom}) scale(${1 / zoom})`}
              >
                <rect
                  x={-(guide.label!.length * 3 + 5)}
                  y="-9"
                  width={guide.label!.length * 6 + 10}
                  height="16"
                  rx="4"
                  fill="white"
                  stroke="none"
                />
                <text
                  textAnchor="middle"
                  y="3"
                  fontSize="10"
                  fontFamily="Arial,sans-serif"
                  fontWeight="600"
                  fill="#b52b94"
                  stroke="none"
                >
                  {guide.label}
                </text>
              </g>
            </>
          )}
        </g>
      ))}
    </svg>
  );
});
export default SmartGuidesOverlay;
