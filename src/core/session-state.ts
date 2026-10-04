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
  queued: QueuedMessage[];
  done: boolean; // its last turn ended and the user hasn't looked since
  commands: AgentCommand[];
};

// A slash command the agent offers in this session (ACP available_commands_update): its own (/compact), a skill or a
// custom prompt. Sent as the message's text, "/name input", which the agent runs. hint: what to type after it.
export type AgentCommand = { name: string; description: string; hint: string | null };

// What a session's agent is up to, for the workspace rail: waiting on a permission, running a turn, finished one the
// user hasn't looked at, or nothing. A workspace shows its sessions' first in this order.
export const agentStatuses = ["waiting", "working", "done", "idle"] as const;
export type AgentStatus = (typeof agentStatuses)[number];
export function agentStatus(s: SessionState): AgentStatus {
  return s.permission ? "waiting" : s.running ? "working" : s.done ? "done" : "idle";
}

// A message sent while a turn runs, waiting for it to end (#24). id: its place in the queue, to take it off or send it
// into the running turn.
export type QueuedMessage = { id: number; entry: ChatEntry };
// What a queued message does when it leaves the queue: runs as the session's next turn, goes into the running one, or
// nothing (taken off).
export type Dequeued = "turn" | "steer" | null;

// A command the agent left running in the background, such as `sleep 60` or a dev server, from its start until it ends;
// or a subagent, which can't be stopped on its own.
export type BackgroundTask = { id: string; name: string; subagent?: boolean };

// ponytail: projections stay until app exit; evict idle sessions if long sessions need a memory bound.
export class SessionStates {
  private states = new Map<string, SessionState>();
  // Kept apart from states: the agent may send them before the session's history is read.
  private commandLists = new Map<string, AgentCommand[]>();
  private loading = new Map<string, Promise<SessionState>>();
  private listeners = new Set<(id: string, state: SessionState) => void>();
  private waiting = new Map<number, (go: Dequeued) => void>();
  private nextQueued = 0;

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
          queued: [],
          done: false,
          commands: this.commandLists.get(id) ?? [],
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
    this.update(id, { running: true, permission: null, error: null, done: false });
    return true;
  }

  // Starts a turn, or queues entry behind the running one (front: before the other queued messages), then calls
  // onQueued. Resolves when the message leaves the queue; with "turn" the session is running it, as after start.
  queue(id: string, entry: ChatEntry, front = false, onQueued?: () => void): Promise<Dequeued> {
    if (this.start(id)) return Promise.resolve("turn");
    const message = { id: this.nextQueued++, entry };
    const queued = this.states.get(id)!.queued;
    this.update(id, { queued: front ? [message, ...queued] : [...queued, message] });
    onQueued?.();
    return new Promise((resolve) => this.waiting.set(message.id, resolve));
  }

  // Takes a queued message off, or with no queuedId all of them, to go into the running turn (steer) or nowhere. A
  // comment isn't steered: the running turn's reply is its own thread's answer, so the comment's would never reach it.
  dequeue(id: string, queuedId: number | undefined, go: "steer" | null) {
    const queued = this.states.get(id)?.queued ?? [];
    const leaving = queued.filter(
      (m) => (queuedId === undefined || m.id === queuedId) && !(go === "steer" && m.entry.comment),
    );
    this.leave(id, leaving, go);
  }

  // Takes a thread's comment off the queue, not sent. False if it isn't queued.
  dequeueThread(id: string, threadId: number): boolean {
    const leaving = (this.states.get(id)?.queued ?? []).filter(
      (m) => m.entry.comment?.threadId === threadId,
    );
    this.leave(id, leaving, null);
    return leaving.length > 0;
  }

  private leave(id: string, leaving: QueuedMessage[], go: "steer" | null) {
    if (!leaving.length) return;
    const queued = this.states.get(id)!.queued;
    this.update(id, { queued: queued.filter((m) => !leaving.includes(m)) });
    for (const m of leaving) this.resolve(m.id, go);
  }

  private resolve(queuedId: number, go: Dequeued) {
    this.waiting.get(queuedId)?.(go);
    this.waiting.delete(queuedId);
  }

  // An entry again under its id replaces it where it is: text grows, and a tool's title fills in, also one a few
  // entries back when tools run in parallel. Skipped for a session not read yet.
  entry(id: string, entry: ChatEntry) {
    const entries = this.states.get(id)?.entries;
    if (!entries) return;
    const at = entry.id === undefined ? -1 : entries.findLastIndex((e) => e.id === entry.id);
    this.update(id, { entries: at < 0 ? [...entries, entry] : entries.with(at, entry) });
  }

  commands(id: string, commands: AgentCommand[]) {
    this.commandLists.set(id, commands);
    if (this.states.has(id)) this.update(id, { commands });
  }

  // The user looked at the session, so a finished turn is no longer news.
  seen(id: string) {
    if (this.states.get(id)?.done) this.update(id, { done: false });
  }

  // The loaded sessions' statuses; one not loaded ran no turn in this app, so it is idle.
  statuses(): [string, AgentStatus][] {
    return [...this.states].map(([id, s]) => [id, agentStatus(s)]);
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

  // The next queued message, if any, runs straight on, so no other turn starts in between.
  // ponytail: the queue carries on after Stop and after an error; hand it back to the composer if that surprises.
  finish(id: string, result: TurnResult) {
    const [next, ...queued] = this.states.get(id)!.queued;
    this.update(id, {
      running: !!next,
      queued,
      permission: null,
      error: !next && result.status === "error" ? result.message : null,
      done: !next,
    });
    if (next) this.resolve(next.id, "turn");
  }
}
