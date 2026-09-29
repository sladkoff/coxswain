import type { ChatEntry, Permission, TurnResult } from "./agents";

// In-memory projection of the agent's history and live turn. The agent owns durable history;
// this survives pane unmounts and can be read without replaying ACP during a running turn.
export type SessionState = {
  revision: number;
  entries: ChatEntry[];
  running: boolean;
  permission: Permission | null;
  error: string | null;
  tasks: BackgroundTask[];
};

// A command the agent left running in the background, such as `sleep 60` or a dev server, from its start until it ends.
export type BackgroundTask = { id: string; name: string };

// ponytail: projections stay until app exit; evict idle sessions if long sessions need a memory bound.
export class SessionStates {
  private states = new Map<string, SessionState>();
  private loading = new Map<string, Promise<SessionState>>();
  private listeners = new Set<(id: string, state: SessionState) => void>();

  subscribe(listener: (id: string, state: SessionState) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  // Deduplicate history replay, including a read racing the start of a turn. No turn starts until
  // its history is loaded, so replay cannot steal the adapter's live listener or replace live text.
  read(id: string, history: () => Promise<ChatEntry[]>): Promise<SessionState> {
    const state = this.states.get(id);
    if (state) return Promise.resolve(state);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const load = history()
      .then((entries) => {
        const state: SessionState = {
          revision: 0,
          entries,
          running: false,
          permission: null,
          error: null,
          tasks: [],
        };
        this.states.set(id, state);
        return state;
      })
      .finally(() => this.loading.delete(id));
    this.loading.set(id, load);
    return load;
  }

  private update(id: string, patch: Partial<SessionState>) {
    const before = this.states.get(id)!;
    const state = { ...before, ...patch, revision: before.revision + 1 };
    this.states.set(id, state);
    for (const listener of this.listeners) listener(id, state);
  }

  start(id: string): boolean {
    if (this.states.get(id)!.running) return false;
    this.update(id, { running: true, permission: null, error: null });
    return true;
  }

  // An entry again under its id replaces it where it is: text grows, and a tool's title fills in, also one a few
  // entries back when tools run in parallel. Skipped for a session not read yet.
  entry(id: string, entry: ChatEntry) {
    const entries = this.states.get(id)?.entries;
    if (!entries) return;
    const at = entry.id === undefined ? -1 : entries.findLastIndex((e) => e.id === entry.id);
    this.update(id, { entries: at < 0 ? [...entries, entry] : entries.with(at, entry) });
  }

  permission(id: string, permission: Permission | null) {
    this.update(id, { permission });
  }

  // Skipped for a session not read yet: none of its turns ran in this app, so none of its tasks is known.
  task(id: string, task: BackgroundTask) {
    const tasks = this.states.get(id)?.tasks;
    if (tasks && !tasks.some((t) => t.id === task.id)) this.update(id, { tasks: [...tasks, task] });
  }

  // The task ended, or with no taskId all of them: the agent's process went away.
  taskEnded(id: string, taskId?: string) {
    const tasks = this.states.get(id)?.tasks;
    const left = tasks?.filter((t) => taskId !== undefined && t.id !== taskId);
    if (tasks && left!.length < tasks.length) this.update(id, { tasks: left });
  }

  finish(id: string, result: TurnResult) {
    this.update(id, {
      running: false,
      permission: null,
      error: result.status === "error" ? result.message : null,
    });
  }
}
