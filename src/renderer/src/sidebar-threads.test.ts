import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewEntry } from "../../core/review";
import type { GuideOptions } from "../../preload";
import { visibleSidebarThreads } from "./sidebar-threads.ts";
const options: GuideOptions = {
  showResolved: true,
  onlyFilesWithThreads: false,
  showAgentThreads: true,
  showComments: true,
  hiddenAuthors: [],
  shownAuthors: [],
};
const entries = [
  { id: 1, kind: "question", parentId: null },
  { id: 2, kind: "note", parentId: null, resolvedAt: "done" },
  { id: 3, kind: "comment", author: "robot", parentId: null },
  { id: 4, kind: "comment", author: "alice", parentId: null },
  { id: 5, kind: "answer", parentId: 1 },
] as unknown as ReviewEntry[];
const authors = [
  { name: "You", isBot: false },
  { name: "alice", isBot: false },
  { name: "robot", isBot: true },
];
test("Guide and Changes use identical author, kind and resolution filtering", () => {
  const ids = (change: Partial<GuideOptions>) =>
    visibleSidebarThreads(entries, { ...options, ...change }, authors).map((entry) => entry.id);
  assert.deepEqual(ids({}), [1, 2, 4]);
  assert.deepEqual(ids({ showResolved: false }), [1, 4]);
  assert.deepEqual(ids({ showAgentThreads: false }), [2, 4]);
  assert.deepEqual(ids({ showComments: false }), [1]);
  assert.deepEqual(ids({ hiddenAuthors: ["You"] }), [4]);
  assert.deepEqual(ids({ shownAuthors: ["robot"] }), [1, 2, 3, 4]);
});

test("cached bot identity excludes a suffixless bot before GitHub author metadata loads", () => {
  const cached = [
    {
      id: 9,
      kind: "comment",
      author: "greptile-apps",
      authorIsBot: true,
      parentId: null,
      resolvedAt: null,
    },
  ] as ReviewEntry[];
  assert.deepEqual(visibleSidebarThreads(cached, options, []), []);
  assert.equal(
    visibleSidebarThreads(cached, { ...options, shownAuthors: ["greptile-apps"] }, []).length,
    1,
  );
});
