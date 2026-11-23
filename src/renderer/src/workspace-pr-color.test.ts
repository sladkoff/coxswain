import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequestTitle } from "../../core/github";
import { workspacePrColor, workspacePrSymbol } from "./workspace-pr-color.ts";

test("workspace PR icon colors prioritize merge and failure states over approval", () => {
  const open: PullRequestTitle = {
    number: 1,
    title: "PR",
    author: "review-author",
    state: "open",
    draft: false,
    approved: false,
    conflicting: false,
    failing: false,
  };
  assert.equal(workspacePrColor(open), "#22c55e");
  assert.equal(
    workspacePrSymbol({ ...open, approved: true, conflicting: true }),
    "exclamationmark.square.fill",
  );
  assert.equal(workspacePrSymbol(open), "arrow.triangle.branch");
  assert.equal(workspacePrSymbol({ ...open, approved: true }), "checkmark.square.fill");
  assert.equal(
    workspacePrSymbol({ ...open, approved: true, failing: true }),
    "arrow.triangle.branch",
  );
  assert.equal(
    workspacePrSymbol({ ...open, state: "merged", approved: true }),
    "arrow.triangle.merge",
  );
  assert.equal(workspacePrColor({ ...open, approved: true }), "#22c55e");
  assert.equal(workspacePrColor({ ...open, approved: true, conflicting: true }), "#fb923c");
  assert.equal(workspacePrColor({ ...open, approved: true, failing: true }), "#fb923c");
  assert.equal(workspacePrColor({ ...open, state: "merged", failing: true }), "#c084fc");
  assert.equal(workspacePrColor({ ...open, state: "closed" }), "#f87171");
});
