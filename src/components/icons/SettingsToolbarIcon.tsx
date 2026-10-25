import type { HTMLAttributes } from "react";
import { Square, type LucideIcon } from "lucide-react";

type SettingsToolbarIconProps = HTMLAttributes<HTMLSpanElement> & {
  icon: LucideIcon;
  innerPart?: string;
};

export function SettingsToolbarIcon({
  icon: Icon,
  innerPart = "section",
  className = "",
  ...props
}: SettingsToolbarIconProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`.trim()}
    >
      <Square
        data-icon-part="board"
        className="absolute inset-0 h-full w-full"
        strokeWidth={1.8}
      />
      <Icon
        data-icon-part={innerPart}
        className="absolute left-1/2 top-1/2 h-[52%] w-[52%] -translate-x-1/2 -translate-y-1/2"
        strokeWidth={2.25}
      />
    </span>
  );
}
