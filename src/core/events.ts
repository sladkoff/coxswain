// ADR 0038: the core's events, one bus for what changed in a workspace. Whoever changes something emits it; the main
// process forwards the changes to the UI, which refetches (ADR 0017), and background.ts starts the work that follows
// from one. In memory and in order: a listener that needs time does it on its own.

// entries, worktree, transcript, sessions, view: what the UI refetches. opened: the workspace's worktree was opened or
// checked again, which changes nothing the UI shows.
export type CoreEvent = {
  workspaceId: number;
  what: "entries" | "worktree" | "transcript" | "sessions" | "view" | "opened";
};

const listeners = new Set<(e: CoreEvent) => void>();
export function onEvent(listener: (e: CoreEvent) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const emit = (e: CoreEvent) => listeners.forEach((l) => l(e));
