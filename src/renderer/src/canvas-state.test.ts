import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultViewId, reviewFileLocation, threadLocation } from "./canvas-state.ts";
import type { View } from "../../core/views";
import type { ReviewEntry } from "../../core/review";

test("default canvas waits for views and snapshot instead of flashing the diff", () => {
  const views = [{ id: 7, head: "head", worktree: true }] as View[];
  assert.equal(defaultViewId({}, undefined, "head"), undefined);
  assert.equal(defaultViewId({}, views, null), undefined);
  assert.equal(
    defaultViewId({}, views, null, true),
    null,
    "failed snapshot falls back to the live diff",
  );
  assert.equal(defaultViewId({}, views, "head"), 7);
  assert.equal(defaultViewId({}, views, "other"), null);
  assert.equal(
    defaultViewId({}, [{ ...views[0], guide: true }], "other"),
    7,
    "the previous guide remains readable while its replacement runs",
  );
  assert.equal(
    defaultViewId({}, [{ id: 8, head: "commit", worktree: false }] as View[], "other"),
    8,
    "a view of a commit never goes stale",
  );
  assert.equal(defaultViewId({}, [], "head"), null);
  assert.equal(
    defaultViewId({ viewId: null }, views, "head"),
    null,
    "explicit Diff stays selected",
  );
  assert.equal(
    defaultViewId({ viewId: 3 }, views, "head"),
    7,
    "legacy view selection opens the workspace Guide",
  );
  assert.equal(defaultViewId({ scope: "unpushed" }, views, "head"), null);
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
    scope: "unpushed" as const,
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

test("a pinned saved Guide is readable before the live snapshot or network check finishes", () => {
  const saved = [{ id: 7, guide: true, head: "pinned", base: "base", worktree: true }] as View[];
  assert.equal(defaultViewId({}, saved, null, false), 7);
  assert.equal(
    defaultViewId({ viewId: null }, saved, null, false),
    null,
    "live Changes does not use the saved Guide",
  );
  assert.equal(defaultViewId({ scope: "unpushed" }, saved, null, false), null);
});

test("picking a sidebar file exits its thread and targets the file header in Guide or Changes", () => {
  for (const pane of ["sections", "diffs"] as const) {
    const previous = {
      viewId: 7,
      at: "same.py",
      thread: 42,
      section: 0,
      line: 12,
      codeLine: { path: "same.py", line: 12, side: "additions" as const },
    };
    const destination = { ...previous, ...reviewFileLocation("same.py", pane) };
    assert.equal(destination.at, "same.py");
    assert.equal(destination.view, pane);
    assert.equal(destination.thread, undefined);
    assert.equal(destination.section, undefined);
    assert.equal(destination.line, undefined);
    assert.equal(destination.codeLine, undefined);
    assert.equal(destination.viewId, pane === "sections" ? 7 : null);
  }
});
