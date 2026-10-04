// ADR 0038: the core's events, one bus for what changed. Whoever changes something emits it, in the core, so every
// write tells: the main process forwards the changes to the UI, which refetches (ADR 0017), and background.ts starts the
// work that follows from one. In memory and in order: a listener that needs time does it on its own.

// In a workspace: entries, worktree, transcript, sessions, view, reviewed, and github (its PR or what's pushed of it
// moved on GitHub; ADR 0030): what the UI refetches. opened: the workspace's worktree was opened or checked again,
// which changes nothing the UI shows. Not in one: projects, workspaces (the list, or a workspace's row), settings and commands (an agent's slash commands).
export type CoreEvent =
  | {
      workspaceId: number;
      what:
        | "entries"
        | "worktree"
        | "transcript"
        | "sessions"
        | "view"
        | "reviewed"
        | "github"
        | "opened";
    }
  | { what: "projects" | "workspaces" | "settings" | "commands" };

const listeners = new Set<(e: CoreEvent) => void>();
export function onEvent(listener: (e: CoreEvent) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const emit = (e: CoreEvent) => listeners.forEach((l) => l(e));
