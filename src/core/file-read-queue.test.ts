import assert from "node:assert/strict";
import { test } from "node:test";
import { FileReadQueue } from "./file-read-queue.ts";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("lookahead cannot consume slots reserved for visible and explicitly selected files", async () => {
  const queue = new FileReadQueue();
  const started: string[] = [];
  const done = new Map<string, () => void>();
  const read = (key: string, priority: "prefetch" | "visible" | "interactive") =>
    queue.run(key, priority, () => {
      started.push(key);
      return new Promise<void>((resolve) => done.set(key, resolve));
    });
  const tasks = [
    read("prefetch-a", "prefetch"),
    read("prefetch-b", "prefetch"),
    read("prefetch-c", "prefetch"),
  ];
  await tick();
  assert.deepEqual(started, ["prefetch-a", "prefetch-b"]);
  tasks.push(read("onscreen", "visible"), read("clicked", "interactive"));
  await tick();
  assert.deepEqual(started, ["prefetch-a", "prefetch-b", "onscreen", "clicked"]);
  for (const key of started) done.get(key)?.();
  await tick();
  done.get("prefetch-c")?.();
  await Promise.all(tasks);
});

test("pending reads coalesce, can be promoted, and errors release capacity", async () => {
  const queue = new FileReadQueue();
  const release = Promise.withResolvers<void>();
  const first = queue.run("first", "prefetch", () => release.promise);
  const second = queue.run("second", "prefetch", () => release.promise);
  let calls = 0;
  const promoted = queue.run("target", "prefetch", async () => {
    calls++;
    return "contents";
  });
  const same = queue.run("target", "interactive", async () => "wrong duplicate");
  assert.equal(promoted, same);
  assert.equal(await same, "contents");
  assert.equal(calls, 1);
  release.resolve();
  await Promise.all([first, second]);
  await assert.rejects(
    queue.run("failure", "visible", async () => {
      throw new Error("read failed");
    }),
  );
  assert.equal(await queue.run("failure", "interactive", async () => "retry"), "retry");
});
