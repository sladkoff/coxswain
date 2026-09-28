import type { ChatEntry, Permission, TurnResult } from "./agents";

// In-memory projection of the agent's history and live turn. The agent owns durable history;
// this survives pane unmounts and can be read without replaying ACP during a running turn.
export type SessionState = {
  revision: number;
  entries: ChatEntry[];
  running: boolean;
  permission: Permission | null;
  error: string | null;
};

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
        const state = { revision: 0, entries, running: false, permission: null, error: null };
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

  entry(id: string, entry: ChatEntry) {
    const entries = this.states.get(id)!.entries;
    const last = entries.at(-1);
    this.update(id, {
      entries:
        entry.id !== undefined && last?.id === entry.id
          ? [...entries.slice(0, -1), entry]
          : [...entries, entry],
    });
  }

  permission(id: string, permission: Permission | null) {
    this.update(id, { permission });
  }

  finish(id: string, result: TurnResult) {
    this.update(id, {
      running: false,
      permission: null,
      error: result.status === "error" ? result.message : null,
    });
  }
}
