import type { HTMLAttributes } from "react";
import { Settings2 } from "lucide-react";
import { SettingsToolbarIcon } from "./SettingsToolbarIcon";

export function BoardSettingsIcon({
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <SettingsToolbarIcon
      {...props}
      icon={Settings2}
      innerPart="settings"
      className={className}
    />
  );
}
