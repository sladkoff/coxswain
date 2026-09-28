import type { Db } from "./db";
import { headCommit } from "./git.ts";

// ADR 0030: the watcher looks at the HEAD of the workspace on screen every few seconds, and tells when it moved: a
// commit, a pull or a reset, in coxswain or not. GitHub is checked by the worktree check, which the UI repeats while
// the workspace shows.
// ponytail: one workspace at a time, polled with git; fs events if many workspaces make that slow.
export const watchLimits = { everyMs: 3000 };

type Watched = {
  workspaceId: number;
  timer: ReturnType<typeof setInterval>;
  head: string | null;
  busy: boolean;
};
let watched: Watched | null = null;

const listeners = new Set<(workspaceId: number) => void>();
export function onHeadMoved(listener: (workspaceId: number) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// Watches this workspace, and stops watching the one before; null stops.
export function watchWorkspace(db: Db, workspaceId: number | null) {
  if (watched?.workspaceId === workspaceId) return;
  if (watched) clearInterval(watched.timer);
  watched = null;
  if (workspaceId === null) return;
  const w: Watched = { workspaceId, timer: undefined!, head: null, busy: false };
  const check = async () => {
    if (w.busy) return;
    w.busy = true;
    try {
      const head = await headCommit(db, workspaceId);
      const was = w.head;
      w.head = head;
      if (watched === w && was && head !== was) listeners.forEach((l) => l(workspaceId));
    } catch {
      // The worktree isn't there yet, or git failed once; the next check tries again.
    } finally {
      w.busy = false;
    }
  };
  w.timer = setInterval(check, watchLimits.everyMs);
  watched = w;
  void check();
}
