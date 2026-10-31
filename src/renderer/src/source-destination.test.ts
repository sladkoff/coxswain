import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewSourceDestination, type ReviewSurface } from "./source-destination.ts";

const file = {
  kind: "diff",
  file: { path: "visible.ts", status: "modified", previousPath: null, additions: 1, deletions: 1 },
} as const;
const surface: ReviewSurface = { visible: [file], base: "base", head: "head" };

test("file search and code links reuse displayed Guide and Changes files", () => {
  for (const view of ["sections", "diffs", undefined] as const) {
    const search = { view, viewId: 10 };
    const picked = reviewSourceDestination(search, surface, "visible.ts");
    assert.equal(picked?.at, "visible.ts");
    assert.equal(picked?.view, undefined, "reuse leaves the current view unchanged");
    assert.deepEqual(reviewSourceDestination(search, surface, "visible.ts", 42, "head")?.codeLine, {
      path: "visible.ts",
      line: 42,
      side: "additions",
    });
    assert.deepEqual(reviewSourceDestination(search, surface, "visible.ts", 18, "base")?.codeLine, {
      path: "visible.ts",
      line: 18,
      side: "deletions",
    });
  }
});

test("hidden, missing and mismatched revision targets fall back to Files", () => {
  assert.equal(reviewSourceDestination({}, { ...surface, visible: [] }, "visible.ts"), null);
  assert.equal(reviewSourceDestination({}, surface, "missing.ts"), null);
  assert.equal(reviewSourceDestination({}, surface, "visible.ts", 42, "other"), null);
  assert.equal(
    reviewSourceDestination({}, surface, "visible.ts", 42),
    null,
    "live links cannot use a different snapshot",
  );
  for (const search of [{ view: "files" }, { pr: true }, { settings: true }] as const)
    assert.equal(reviewSourceDestination(search, surface, "visible.ts"), null);
});

test("live diffs, renames and whole-file Guide embeds use their matching revision", () => {
  assert.equal(
    reviewSourceDestination({}, { ...surface, head: undefined }, "visible.ts", 4)?.codeLine?.side,
    "additions",
  );
  const renamed: ReviewSurface = {
    ...surface,
    visible: [{ ...file, file: { ...file.file, previousPath: "old.ts" } }],
  };
  assert.equal(reviewSourceDestination({}, renamed, "old.ts", 8, "base")?.at, "visible.ts");
  const whole: ReviewSurface = { ...surface, visible: [{ kind: "file", path: "whole.ts" }] };
  assert.equal(
    reviewSourceDestination({}, whole, "whole.ts", 2, "head")?.codeLine?.side,
    "additions",
  );
  assert.equal(reviewSourceDestination({}, whole, "whole.ts", 2, "base"), null);
});
