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
  if (s.viewId === null) return null;
  if (s.viewId !== undefined) return views ? (views[0]?.id ?? null) : undefined;
  if (s.commit || s.scope) return null;
  if (!views) return undefined;
  if (views[0]?.guide) return views[0].id;
  if (!snapshotReady) return undefined;
  // Keep a previous guide readable while its automatic replacement is generated. Other stale views fall back to the diff.
  const newest = views[0];
  return newest && (newest.guide || !newest.worktree || newest.head === snapshot)
    ? newest.id
    : null;
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

// A sidebar file pick is a file-header destination, even when leaving a thread in that same file.
export function reviewFileLocation(path: string, pane: "sections" | "diffs"): CanvasSearch {
  return {
    view: pane,
    ...(pane === "diffs" ? { viewId: null } : {}),
    at: path,
    file: undefined,
    fileAt: undefined,
    line: undefined,
    codeLine: undefined,
    thread: undefined,
    section: undefined,
  };
}
