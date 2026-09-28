import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionStates } from "./session-state.ts";
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
