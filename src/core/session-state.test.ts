import assert from "node:assert/strict";
import { test } from "node:test";
import { agentStatus, SessionStates } from "./session-state.ts";
import type { ChatEntry } from "./agents";

test("history replay is shared before a turn; live state survives a detached pane", async () => {
  const states = new SessionStates();
  const replay = Promise.withResolvers<ChatEntry[]>();
  let reads = 0;
  const history = () => {
    reads++;
    return replay.promise;
  };
  const first = states.read("a", history);
  const second = states.read("a", history);
  assert.equal(reads, 1);
  replay.resolve([
    { kind: "user", text: "Earlier question" },
    { kind: "text", text: "Earlier answer" },
  ]);
  assert.equal(await first, await second);
  assert.equal(states.start("a"), true);
  assert.equal(states.start("a"), false, "reject overlapping turns");
  states.entry("a", { kind: "user", text: "Next question" });
  states.entry("a", { id: 1, kind: "text", text: "Working" });
  const before = await states.read("a", history);
  states.entry("a", { id: 1, kind: "text", text: "Working while hidden" });
  const permission = { id: "p", title: "Run a command", options: [] };
  states.permission("a", permission);
  const reattached = await states.read("a", history);
  assert.equal(reads, 1, "no replay while streaming");
  assert.equal(reattached.entries.length, 4);
  assert.equal(reattached.entries[0].text, "Earlier question");
  assert.equal(reattached.entries[3].text, "Working while hidden");
  assert.equal(before.entries[3].text, "Working", "old snapshots are immutable");
  assert.equal(reattached.running, true);
  assert.deepEqual(reattached.permission, permission);
  assert.ok(reattached.revision > before.revision);
  states.permission("a", null);
  states.finish("a", { status: "error", message: "Stopped" });
  const ended = await states.read("a", history);
  assert.equal(ended.running, false);
  assert.equal(ended.permission, null);
  assert.equal(ended.error, "Stopped");
  assert.equal(ended.entries.length, 4);
  assert.equal(states.start("a"), true);
  assert.equal((await states.read("a", history)).error, null);
});

test("independent sessions finish while no pane listens, and failed history loads can retry", async () => {
  const states = new SessionStates();
  await assert.rejects(
    states.read("a", async () => {
      throw new Error("offline");
    }),
  );
  await states.read("a", async () => []);
  await states.read("b", async () => []);
  states.start("a");
  states.start("b");
  const seen: string[] = [];
  const off = states.subscribe((id) => seen.push(id));
  states.entry("a", { id: 2, kind: "text", text: "A" });
  off();
  states.finish("a", { status: "ok" });
  assert.deepEqual(seen, ["a"]);
  assert.equal((await states.read("a", async () => [])).running, false);
  assert.equal((await states.read("b", async () => [])).running, true);
});

test("parallel tools' titles fill in where they are; background tasks show until they end", async () => {
  const states = new SessionStates();
  states.task("a", { id: "t0", name: "unread" });
  states.entry("a", { kind: "text", text: "unread" });
  await states.read("a", async () => []);
  assert.equal(
    (await states.read("a", async () => [])).entries.length,
    0,
    "a session not read is skipped",
  );
  states.entry("a", { id: 1, kind: "tool", text: "Terminal" });
  states.entry("a", { id: 2, kind: "tool", text: "Terminal" });
  states.entry("a", { id: 1, kind: "tool", text: "Bash sleep 60" });
  states.entry("a", { kind: "text", text: "Started" });
  let s = await states.read("a", async () => []);
  assert.deepEqual(
    s.entries.map((e) => e.text),
    ["Bash sleep 60", "Terminal", "Started"],
  );
  states.task("a", { id: "t1", name: "sleep 60" });
  states.task("a", { id: "t1", name: "sleep 60" });
  states.task("a", { id: "t2", name: "pnpm dev" });
  states.taskEnded("a", "t1");
  s = await states.read("a", async () => []);
  assert.deepEqual(s.tasks, [{ id: "t2", name: "pnpm dev" }]);
  states.taskEnded("a");
  assert.deepEqual((await states.read("a", async () => [])).tasks, [], "the agent went away");
});

test("subagents are listed with commands until they end, also past the turn", async () => {
  const states = new SessionStates();
  await states.read("a", async () => []);
  states.start("a");
  states.task("a", { id: "c", name: "pnpm dev" });
  states.task("a", { id: "s", name: "Sleep then write file", subagent: true });
  states.finish("a", { status: "ok" });
  assert.deepEqual(
    (await states.read("a", async () => [])).tasks.map((t) => t.name),
    ["pnpm dev", "Sleep then write file"],
  );
  states.taskEnded("a", "s");
  assert.deepEqual((await states.read("a", async () => [])).tasks, [{ id: "c", name: "pnpm dev" }]);
});

test("messages sent during a turn queue behind it, run in order, and can be taken off or sent into it", async () => {
  const states = new SessionStates();
  await states.read("a", async () => []);
  assert.equal(await states.queue("a", { kind: "user", text: "first" }), "turn");
  const second = states.queue("a", { kind: "user", text: "second" });
  const third = states.queue("a", { kind: "user", text: "third" });
  const fourth = states.queue("a", { kind: "user", text: "fourth" });
  const queued = (await states.read("a", async () => [])).queued;
  assert.deepEqual(
    queued.map((m) => m.entry.text),
    ["second", "third", "fourth"],
  );
  states.dequeue("a", queued[1].id, null);
  assert.equal(await third, null);
  states.dequeue("a", queued[2].id, "steer");
  assert.equal(await fourth, "steer");
  states.finish("a", { status: "error", message: "Stopped" });
  assert.equal(await second, "turn");
  const next = await states.read("a", async () => []);
  assert.equal(next.running, true, "no other turn starts in between");
  assert.deepEqual(next.queued, []);
  assert.equal(next.error, null);
  const front = states.queue("a", { kind: "user", text: "back" });
  const steered = states.queue("a", { kind: "user", text: "handed back" }, true);
  assert.deepEqual(
    (await states.read("a", async () => [])).queued.map((m) => m.entry.text),
    ["handed back", "back"],
  );
  states.dequeue("a", undefined, null);
  assert.equal(await front, null);
  assert.equal(await steered, null);
});

test("a queued comment says so, isn't steered into another thread's turn, and comes off by its thread", async () => {
  const states = new SessionStates();
  await states.read("a", async () => []);
  let queuedCalls = 0;
  const onQueued = () => queuedCalls++;
  assert.equal(await states.queue("a", { kind: "user", text: "first" }, false, onQueued), "turn");
  assert.equal(queuedCalls, 0, "a message that runs at once isn't queued");
  const comment = (threadId: number) => ({
    kind: "user" as const,
    text: `comment ${threadId}`,
    comment: { threadId, where: "a.ts:1", body: "why?" },
  });
  const seven = states.queue("a", comment(7), false, onQueued);
  const eight = states.queue("a", comment(8), false, onQueued);
  assert.equal(queuedCalls, 2);
  const [first] = (await states.read("a", async () => [])).queued;
  states.dequeue("a", first.id, "steer");
  assert.equal(
    (await states.read("a", async () => [])).queued.length,
    2,
    "Send now leaves a comment queued: its answer would land in the running turn's thread",
  );
  assert.equal(states.dequeueThread("a", 8), true);
  assert.equal(await eight, null);
  assert.equal(states.dequeueThread("a", 8), false, "not queued any more");
  states.finish("a", { status: "ok" });
  assert.equal(await seven, "turn");
  assert.equal(
    states.dequeueThread("a", 7),
    false,
    "running, not queued: Stop stops the turn instead",
  );
});

test("a session is working, then waiting on a permission, then done until seen", async () => {
  const states = new SessionStates();
  const status = async () => agentStatus(await states.read("a", async () => []));
  assert.equal(await status(), "idle");
  states.start("a");
  assert.equal(await status(), "working");
  states.permission("a", { id: "p", title: "Run a command", options: [] });
  assert.equal(await status(), "waiting");
  states.permission("a", null);
  const queued = states.queue("a", { kind: "user", text: "Next" });
  states.finish("a", { status: "ok" });
  assert.equal(await queued, "turn");
  assert.equal(await status(), "working", "a queued message runs on, so not done yet");
  states.finish("a", { status: "ok" });
  assert.equal(await status(), "done");
  assert.deepEqual(states.statuses(), [["a", "done"]]);
  states.seen("a");
  assert.equal(await status(), "idle");
});
