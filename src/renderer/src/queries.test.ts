import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { SessionState } from "../../core/session-state";

let onState: (id: string, state: SessionState) => void;
let read = Promise.withResolvers<SessionState>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    coxswain: {
      onChanged: () => () => {},
      onSummaryJobs: () => () => {},
      onAgentState: (callback: typeof onState) => {
        onState = callback;
      },
      readAgentState: () => read.promise,
    },
  },
});
const { core, queryClient } = await import("./queries.ts");
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
