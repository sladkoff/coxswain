// A deterministic preload for the real built renderer. No git, accounts, agents or user data.
const listeners = new Map();
const on = (name, callback) => {
  const all = listeners.get(name) ?? new Set();
  all.add(callback);
  listeners.set(name, all);
  return () => all.delete(callback);
};
const emit = (name, ...args) => listeners.get(name)?.forEach((callback) => callback(...args));
const delay = (value, ms = 40) =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));
const workspaces = [1, 2].map((id) => ({
  id,
  projectId: 1,
  prNumber: null,
  branch: `workspace-${id}`,
  baseBranch: "main",
  lastOpenedAt: id === 1 ? "2026-09-28" : "2026-09-27",
}));
const sessions = [1, 2].map((id) => ({
  id,
  workspaceId: id,
  agent: "codex",
  agentSessionId: `session-${id}`,
  title: `Session ${id}`,
  createdAt: "2026-09-28T10:00:00Z",
}));
const states = new Map(
  sessions.map((session) => [
    session.agentSessionId,
    {
      revision: 0,
      entries: [
        { kind: "user", text: `Earlier question ${session.id}` },
        { kind: "text", text: `Earlier answer ${session.id}` },
      ],
      running: false,
      permission: null,
      error: null,
    },
  ]),
);
const views = [1, 2].map((id) => ({
  id,
  workspaceId: id,
  title: `View ${id}`,
  guide: false,
  base: "base",
  head: `head-${id}`,
  createdAt: "2026-09-28T10:00:00Z",
  sections: [
    {
      title: `Diagram ${id}`,
      parts: [
        {
          kind: "prose",
          text:
            "```mermaid\nflowchart TD\n A[Workspace] --> B[Canvas]\n```\n\n" +
            "Scroll fixture paragraph.\n\n".repeat(40),
        },
      ],
    },
    { title: "Reviewed section", parts: [{ kind: "diff", path: "a.ts", generated: false }] },
  ],
}));
const entry = {
  id: 1,
  workspaceId: 1,
  kind: "note",
  body: "Navigate to this reviewed comment",
  parentId: null,
  viewId: 1,
  path: "a.ts",
  side: "new",
  startLine: 1,
  endLine: 1,
  code: "const value = 2;",
  base: "base",
  head: "head-1",
  createdAt: "2026-09-28T10:00:00Z",
  resolvedAt: null,
  state: "current",
};
const update = (id, patch) => {
  const before = states.get(id);
  const state = { ...before, ...patch, revision: before.revision + 1 };
  states.set(id, state);
  emit("state", id, structuredClone(state));
};
let finish;
let finishId;
window.fixture = {
  action: (id) => emit("action", id),
  update,
  finish: () => {
    update(finishId, { running: false, permission: null });
    finish?.({ status: "ok" });
  },
  outdated: () => {
    entry.state = "outdated";
    emit("changed", { workspaceId: 1, what: "entries" });
  },
  permission: () =>
    update("session-1", {
      permission: {
        id: "permission-1",
        title: "Fixture permission",
        options: [{ id: "yes", name: "Allow fixture", kind: "allow_once" }],
      },
    }),
};
window.coxswain = {
  onChanged: (f) => on("changed", f),
  onAgentState: (f) => on("state", f),
  onAction: (f) => on("action", f),
  onQuestionChat: () => () => {},
  onQuestionPermission: () => () => {},
  onQuestionEnd: () => () => {},
  onCheckDiagrams: () => () => {},
  checkSetup: () => delay({ problems: [] }),
  listProjects: () => delay([{ id: 1, owner: "fixture", name: "flickering" }]),
  listWorkspaces: () => delay(workspaces),
  openWorkspace: () => delay(),
  cloneProject: () => delay({ status: "ok" }),
  listPullRequestTitles: () => delay({ status: "ok", pulls: [] }),
  setNavigation: () => {},
  openedBefore: (id) => delay({ status: "ok", head: `head-${id}`, mergeBase: "base" }),
  openWorktree: (id) =>
    delay({ status: "ok", head: `head-${id}`, mergeBase: "base", prNumber: null, notice: null }),
  snapshot: (id) => delay({ status: "ok", sha: `head-${id}` }, 180),
  listViews: (id) =>
    delay(
      views.filter((v) => v.workspaceId === id),
      130,
    ),
  listChangedFiles: (_id, _base, head) =>
    delay({
      status: "ok",
      files: [
        { path: "a.ts", status: "modified", additions: 1, deletions: 1 },
        ...(!head ? [{ path: "live-only.ts", status: "added", additions: 1, deletions: 0 }] : []),
      ],
    }),
  listReviewed: (_id, _base, _head, kind) => delay(kind === "file" ? [] : ["a.ts"], 130),
  listEntries: (id) => delay(id === 1 ? [entry] : []),
  listAgentSessions: (id) => delay(sessions.filter((s) => s.workspaceId === id)),
  readAgentState: (id) => delay(states.get(id)),
  newSessionAgent: () => delay("codex"),
  listAgentPicks: () => delay({}),
  startAgentSession: async (workspaceId, agent) => {
    await delay(null, 300);
    const id = sessions.length + 1;
    const session = {
      id,
      workspaceId,
      agent,
      agentSessionId: `session-${id}`,
      title: `Session ${id}`,
      createdAt: "2026-09-28T11:00:00Z",
    };
    sessions.push(session);
    states.set(session.agentSessionId, {
      revision: 0,
      entries: [],
      running: false,
      permission: null,
      error: null,
    });
    return structuredClone(session);
  },
  runTurn: async (id, message) => {
    finishId = id;
    update(id, {
      running: true,
      entries: [
        ...states.get(id).entries,
        { kind: "user", text: message },
        { id: 10, kind: "text", text: "Streaming before switch" },
      ],
    });
    return new Promise((resolve) => {
      finish = resolve;
    });
  },
  answerPermission: () => update("session-1", { permission: null }),
  stopTurn: () => window.fixture.finish(),
  readFileAt: (_id, sha) =>
    delay({ status: "ok", binary: false, text: `const value = ${sha === "base" ? 1 : 2};\n` }),
  readWorktreeFile: () => delay({ status: "ok", binary: false, text: "const value = 2;\n" }),
  listWorktreeFiles: () => delay({ status: "ok", paths: ["a.ts", "live-only.ts"] }),
};
