import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultViewId, threadLocation } from "./canvas-state.ts";
import type { View } from "../../core/views";
import type { ReviewEntry } from "../../core/review";

test("default canvas waits for views and snapshot instead of flashing the diff", () => {
  const views = [{ id: 7, head: "head" }] as View[];
  assert.equal(defaultViewId({}, undefined, "head"), undefined);
  assert.equal(defaultViewId({}, views, null), undefined);
  assert.equal(
    defaultViewId({}, views, null, true),
    null,
    "failed snapshot falls back to the live diff",
  );
  assert.equal(defaultViewId({}, views, "head"), 7);
  assert.equal(defaultViewId({}, views, "other"), null);
  assert.equal(defaultViewId({}, [], "head"), null);
  assert.equal(
    defaultViewId({ viewId: null }, views, "head"),
    null,
    "explicit Diff stays selected",
  );
  assert.equal(defaultViewId({ viewId: 3 }, views, "head"), 3, "remembered view wins");
  assert.equal(defaultViewId({ scope: "local" }, views, "head"), null);
});

test("thread navigation clears conflicting selections and returns to the thread's range", () => {
  const root = {
    id: 4,
    workspaceId: 1,
    path: "a.ts",
    base: "base",
    head: "head",
    viewId: 7,
  } as ReviewEntry;
  const previous = {
    scope: "local" as const,
    view: "files" as const,
    file: "b.ts",
    line: 8,
    commit: { sha: "other", parent: "old", subject: "Other" },
  };
  const target = { ...previous, ...threadLocation(root) };
  assert.equal(target.viewId, 7);
  assert.equal(target.thread, 4);
  assert.equal(target.at, "a.ts");
  for (const k of ["scope", "view", "file", "line", "commit"] as const)
    assert.equal(target[k], undefined);
  assert.deepEqual(threadLocation({ ...root, viewId: null }).commit, {
    sha: "head",
    parent: "base",
    subject: "Comment range",
  });
  assert.equal(threadLocation({ ...root, viewId: null, head: null }).commit, undefined);
});
