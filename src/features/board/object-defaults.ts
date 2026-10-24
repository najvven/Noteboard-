import type { BoardElement, ElementType } from "../../types";

export interface PendingPropsBaseline {
  tool: string;
  props: Partial<BoardElement>;
}

/**
 * Saved per-type defaults replace stale values left by another tool. Values
 * changed after this same tool loaded remain explicit for the next placement.
 */
export const resolveObjectPlacementProps = ({
  type,
  pendingProps,
  savedDefaults,
  baseline,
}: {
  type: ElementType;
  pendingProps: Readonly<Partial<BoardElement>>;
  savedDefaults?: Readonly<Partial<BoardElement>>;
  baseline?: Readonly<PendingPropsBaseline> | null;
}): Partial<BoardElement> => {
  const resolved: Partial<BoardElement> = {
    ...(savedDefaults ?? {}),
  };

  Object.entries(pendingProps).forEach(([key, value]) => {
    const typedKey = key as keyof BoardElement;
    const hasSavedDefault = Object.prototype.hasOwnProperty.call(
      savedDefaults ?? {},
      typedKey,
    );
    const changedAfterToolLoad =
      baseline?.tool === type &&
      !Object.is(baseline.props[typedKey], value);

    if (!hasSavedDefault || changedAfterToolLoad) {
      (resolved as Record<string, unknown>)[key] = value;
    }
  });

  return resolved;
};
