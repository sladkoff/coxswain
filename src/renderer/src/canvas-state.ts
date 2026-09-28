import type { ReviewEntry } from "../../core/review";
import type { View } from "../../core/views";

import type { CanvasSearch } from "./router";
export type { CanvasSearch } from "./router";

// Undefined means the default is not resolved yet: never flash the live diff before selecting a view.
export function defaultViewId(
  s: CanvasSearch,
  views: View[] | undefined,
  snapshot: string | null,
  snapshotReady = !!snapshot,
) {
  if (s.viewId !== undefined) return s.viewId;
  if (s.commit || s.scope) return null;
  if (!views || !snapshotReady) return undefined;
  return views[0]?.head === snapshot ? views[0].id : null;
}

// The entry records the range where it was written. Clear incompatible selections so it is
// reachable even when the user came from a whole file or a different scope.
export function threadLocation(root: ReviewEntry): CanvasSearch {
  return {
    ws: root.workspaceId,
    thread: root.id,
    at: root.path ?? undefined,
    view: undefined,
    file: undefined,
    line: undefined,
    scope: undefined,
    viewId: root.viewId,
    commit:
      !root.viewId && root.head && root.base
        ? { sha: root.head, parent: root.base, subject: "Comment range" }
        : undefined,
  };
}
