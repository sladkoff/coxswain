require("./workspace-scroll.cjs");
const listeners = new Set();
let appearance = "dark";
let softDark = false;
window.fixture.appearance = (value) => {
  softDark = value === "soft-dark";
  appearance = softDark ? "dark" : value;
  listeners.forEach((callback) => callback({ what: "settings" }));
};
const onChanged = window.coxswain.onChanged;
const thread = {
  id: 1,
  workspaceId: 1,
  kind: "note",
  body: "Change the default value to 2",
  parentId: null,
  viewId: null,
  path: "a.ts",
  side: "new",
  startLine: 1,
  endLine: 1,
  code: "const value = 2;",
  base: "base",
  head: "head-1",
  revision: "head-1",
  createdAt: "2026-11-23T10:00:00Z",
  resolvedAt: "2026-11-23T10:01:00Z",
  resolutionSummary:
    "The exported default is now 2, matching the requested behavior. The initializer and its consumers use this value consistently, so new instances no longer start with the old default.",
  state: "current",
  shown: true,
};
Object.assign(window.coxswain, {
  getAppearance: async () => appearance,
  getSoftDark: async () => softDark,
  listEntries: async (id) => (id === 1 ? [structuredClone(thread)] : []),
  onChanged: (callback) => {
    listeners.add(callback);
    const off = onChanged(callback);
    return () => {
      listeners.delete(callback);
      off();
    };
  },
  resolveThread: async (_id, resolved) => {
    thread.resolvedAt = resolved ? new Date().toISOString() : null;
    if (!resolved) thread.resolutionSummary = null;
    listeners.forEach((callback) => callback({ workspaceId: 1, what: "entries" }));
  },
});

const listWorkspaces = window.coxswain.listWorkspaces;
Object.assign(window.coxswain, {
  listProjects: async () => [
    { id: 1, name: "review-fixture", github: "fixture/reviews", path: null, where: "fixture" },
  ],
  listWorkspaces: async () =>
    (await listWorkspaces()).map((w) => ({ ...w, prNumber: w.id === 1 ? 42 : null })),
  listPullRequestTitles: async () => ({
    status: "ok",
    pulls: [
      {
        number: 42,
        title: "Handle empty input",
        author: "review-creator",
        state: "open",
        draft: false,
        approved: false,
        conflicting: false,
        failing: false,
      },
    ],
  }),
});
