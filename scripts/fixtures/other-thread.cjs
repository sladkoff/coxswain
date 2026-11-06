require("./workspace-scroll.cjs");
if (process.env.COXSWAIN_TEST_NO_GUIDE) window.coxswain.listViews = async () => [];
const other = {
  id: 31,
  workspaceId: 1,
  kind: "note",
  body: "Historical thread on a file outside the Guide",
  parentId: null,
  viewId: null,
  path: "old-only.ts",
  side: "new",
  startLine: 1,
  endLine: 1,
  code: "const value = 2;",
  base: "old-base",
  head: "old-head",
  revision: "old-head",
  createdAt: "2026-09-28T10:00:00Z",
  resolvedAt: null,
  state: "outdated",
};
const changed = window.coxswain.listChangedFiles;
const read = window.coxswain.readFileAt;
window.fixture.reads = [];
window.fixture.reviewed = [];
Object.assign(window.coxswain, {
  readFileAt: (...args) => {
    window.fixture.reads.push(args);
    return read(...args);
  },
  setReviewed: async (...args) => {
    window.fixture.reviewed.push(args);
  },
  listEntries: async (_id, _mergeBase, _base, head) => [
    { ...other, shown: head === "old-head", state: head === "old-head" ? "current" : "outdated" },
  ],
  listChangedFiles: (id, base, head) =>
    head === "old-head"
      ? Promise.resolve({
          status: "ok",
          files: [{ path: "old-only.ts", status: "modified", additions: 1, deletions: 1 }],
        })
      : changed(id, base, head),
});
