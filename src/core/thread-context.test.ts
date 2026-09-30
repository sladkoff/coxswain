import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewEntry } from "./review";
import { unseen } from "./thread-context.ts";

const entry = (
  id: number,
  kind: ReviewEntry["kind"],
  body: string,
  more: Partial<Omit<ReviewEntry, "state" | "shown" | "now">> = {},
) =>
  ({
    id,
    workspaceId: 1,
    kind,
    body,
    parentId: id === 1 ? null : 1,
    viewId: null,
    path: null,
    side: null,
    startLine: null,
    endLine: null,
    code: null,
    base: null,
    head: null,
    createdAt: "",
    resolvedAt: null,
    agentSessionId: null,
    revision: null,
    section: null,
    quoteAt: null,
    ...more,
  }) satisfies Omit<ReviewEntry, "state" | "shown" | "now">;

const root = entry(1, "question", "Why a map?", {
  path: "a.ts",
  side: "new",
  startLine: 3,
  endLine: 3,
  code: "const m = new Map();",
  agentSessionId: "s1",
});
const thread = [
  root,
  entry(2, "answer", "For lookups by id."),
  entry(3, "note", "Hm, ids are dense."),
];
const followUp = entry(4, "question", "Would an array do?");

test("a follow-up in the session that saw the thread sends only the notes since its last question", () => {
  assert.equal(unseen(followUp, thread, "s1"), "Earlier in the thread: Hm, ids are dense.");
});

test("a follow-up in another session sends where the thread is and all of it (#11)", () => {
  const context = unseen(followUp, thread, "s2");
  assert.match(context, /^About `a\.ts` line 3/);
  assert.match(context, /const m = new Map\(\);/);
  assert.match(context, /Me: Why a map\?\nYou: For lookups by id\.\nMe: Hm, ids are dense\./);
});

test("a thread's first question carries its own anchor", () => {
  assert.match(unseen({ ...root, agentSessionId: null }, [], "s1"), /^About `a\.ts` line 3/);
});

test("a thread on a view's prose says where in the view and quotes the passage (ADR 0036)", () => {
  const onProse = entry(1, "question", "Is this right?", {
    viewId: 7,
    section: 1,
    code: "The cache is filled\nlazily.",
  });
  assert.equal(
    unseen(onProse, [], "s1"),
    "About this passage of section 2 of view 7 (see list_views):\n> The cache is filled\n> lazily.",
  );
});
