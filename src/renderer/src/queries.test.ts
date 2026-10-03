import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { SessionState } from "../../core/session-state";

let onState: (id: string, state: SessionState) => void;
let read = Promise.withResolvers<SessionState>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener: () => {},
    removeEventListener: () => {},
    coxswain: {
      onChanged: () => () => {},
      onJobs: () => () => {},
      onAgentState: (callback: typeof onState) => {
        onState = callback;
      },
      readAgentState: () => read.promise,
    },
  },
});
const { changed, core, queryClient } = await import("./queries.ts");
after(() => {
  queryClient.clear();
  Reflect.deleteProperty(globalThis, "window");
});

test("a delayed IPC read cannot erase streamed text, permission or turn completion", async () => {
  const old: SessionState = {
    revision: 0,
    entries: [],
    running: false,
    permission: null,
    error: null,
    tasks: [],
    queued: [],
    done: false,
  };
  const query = core("readAgentState", "session");
  const pending = queryClient.fetchQuery(query);
  const live: SessionState = {
    ...old,
    revision: 3,
    running: true,
    entries: [
      { kind: "user", text: "Question" },
      { id: 1, kind: "text", text: "Answer" },
    ],
    permission: { id: "p", title: "Command", options: [] },
  };
  onState("session", live);
  read.resolve(old);
  await pending;
  assert.deepEqual(queryClient.getQueryData(query.queryKey), live);
  const done = { ...live, revision: 4, running: false, permission: null };
  onState("session", done);
  onState("session", live);
  assert.deepEqual(queryClient.getQueryData(query.queryKey), done);
});

test("a change makes stale what it affects: in its workspace, but for the unscoped; everywhere, outside one", async () => {
  const seed = (key: unknown[]) => queryClient.setQueryData(key, {});
  const stale = (key: unknown[]) => queryClient.getQueryState(key)?.isInvalidated ?? false;
  const keys = {
    here: ["openWorktree", 1],
    there: ["openWorktree", 2],
    titles: ["listPullRequestTitles", "owner", "name", [7]],
    entries: ["listEntries", 1],
    prompts: ["listPrompts"],
    picks: ["listAgentPicks", 2, "claude"],
  };
  Object.values(keys).forEach(seed);
  await changed({ workspaceId: 1, what: "github" });
  assert.equal(stale(keys.here), true);
  assert.equal(stale(keys.there), false);
  assert.equal(stale(keys.titles), true);
  assert.equal(stale(keys.entries), false);
  await changed({ what: "settings" });
  assert.equal(stale(keys.prompts), true);
  assert.equal(stale(keys.picks), true);
});
