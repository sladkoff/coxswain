import type { View } from "../../core/views";

// Compare both ends of the Guide's range; an unresolved snapshot must not flash a stale warning.
export function isGuideStale(
  guide: Pick<View, "guide" | "base" | "head"> | null,
  base: string | undefined,
  snapshot: string | null,
) {
  return !!guide?.guide && !!base && !!snapshot && (guide.base !== base || guide.head !== snapshot);
}
