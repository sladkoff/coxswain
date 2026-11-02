import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ContentDigests } from "./content-digests.ts";

test("overlapping immutable reads share work and subsets reuse digests without buffers", async () => {
  const cache = new ContentDigests();
  const loading = Promise.withResolvers<Map<string, Buffer | null>>();
  let calls = 0;
  const read = (paths: string[]) =>
    cache.read("repo:commit", paths, () => {
      calls++;
      return loading.promise;
    });
  const all = read(["a", "b"]);
  const subset = read(["b"]);
  loading.resolve(
    new Map([
      ["a", Buffer.from("hello")],
      ["b", null],
    ]),
  );
  const result = await all;
  assert.equal(calls, 1);
  assert.deepEqual(await subset, new Map([["b", result.get("b")]]));
  assert.equal(result.get("a"), createHash("sha1").update("hello").digest("hex"));
  assert.equal(result.get("b"), "absent");
  await read(["a"]);
  assert.equal(calls, 1);
  const whole = await cache.read(
    "repo:commit",
    ["a"],
    async () => new Map([["a", Buffer.from("hello")]]),
    "file",
  );
  assert.equal(whole.get("a"), createHash("sha1").update("file\0hello").digest("hex"));
});

test("digest cache is bounded, distinguishes revisions, and retries failed reads", async () => {
  const cache = new ContentDigests(1);
  let calls = 0;
  const read = (scope: string, path: string) =>
    cache.read(scope, [path], async (paths) => {
      calls++;
      return new Map(paths.map((path) => [path, Buffer.from(path)]));
    });
  await read("first", "a");
  await read("second", "a");
  await read("first", "a");
  assert.equal(calls, 3);
  await assert.rejects(
    cache.read("bad", ["x"], async () => {
      throw new Error("failed");
    }),
  );
  assert.equal((await read("bad", "x")).size, 1);
});
