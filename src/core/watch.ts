import type { Db } from "./db";
import { worktreeState } from "./git.ts";

// ADR 0030: the watcher looks at the workspace on screen every few seconds: its HEAD and `git status`. A HEAD that
// moved (a commit, a pull, a reset, in coxswain or not) is a "head" change; other changes to what's uncommitted are a
// "status" change. GitHub is checked by the worktree check, which the UI repeats while the workspace shows.
// ponytail: one workspace at a time, polled with git; fs events if many workspaces or big repos make that slow.
export const watchLimits = { everyMs: 3000 };

type Watched = {
  workspaceId: number;
  timer: ReturnType<typeof setInterval>;
  last: { head: string; status: string } | null;
  busy: boolean;
};
let watched: Watched | null = null;

const listeners = new Set<(workspaceId: number, change: "head" | "status") => void>();
export function onWorkspaceChange(
  listener: (workspaceId: number, change: "head" | "status") => void,
) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// Watches this workspace, and stops watching the one before; null stops.
export function watchWorkspace(db: Db, workspaceId: number | null) {
  if (watched?.workspaceId === workspaceId) return;
  if (watched) clearInterval(watched.timer);
  watched = null;
  if (workspaceId === null) return;
  const w: Watched = { workspaceId, timer: undefined!, last: null, busy: false };
  const check = async () => {
    if (w.busy) return;
    w.busy = true;
    try {
      const now = await worktreeState(db, workspaceId);
      const was = w.last;
      w.last = now;
      if (watched !== w || !was) return;
      const change = now.head !== was.head ? "head" : now.status !== was.status ? "status" : null;
      if (change) listeners.forEach((l) => l(workspaceId, change));
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
