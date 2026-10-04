import { focusManager, QueryClient, queryOptions } from "@tanstack/react-query";
import type { Changed, CoxswainApi } from "../../preload";
import type { SessionState } from "../../core/session-state";

// Every read from the core goes through TanStack Query (ADR 0017). Core data is stale at once but only refetched
// when a pane mounts or the core says it changed: the core keeps the workspace on screen fresh, GitHub included
// (ADR 0030). The project's lists from GitHub are refetched after a minute, on window focus.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Focus is the window's: TanStack only listens for the page being hidden, which a window behind another isn't.
focusManager.setEventListener((focused) => {
  const on = () => focused(true);
  const off = () => focused(false);
  window.addEventListener("focus", on);
  window.addEventListener("blur", off);
  return () => {
    window.removeEventListener("focus", on);
    window.removeEventListener("blur", off);
  };
});

type Api = CoxswainApi;
type Reads = {
  [K in keyof Api]: Api[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof Api];

const github = { staleTime: 60_000, refetchOnWindowFocus: true };
type Extra = { staleTime?: number; refetchOnWindowFocus?: boolean };
const extra: Partial<Record<Reads, Extra>> = {
  readAgentState: { staleTime: Infinity },
  listAgentStatuses: { staleTime: Infinity }, // refetched when a status changes (below)
  listJobs: { staleTime: Infinity }, // the core pushes them (below)
  readFileAt: { staleTime: Infinity }, // a file at a commit never changes
  listPullRequests: github,
  listPullRequestTitles: github,
};
// Offline or signed out: a GitHub read keeps what it fetched before. Throwing leaves the query's data as it was.
// The workspace's own (openWorktree, readPullRequest) are kept by the core.
const keepsOk = new Set<Reads>(["listPullRequestTitles"]);

// A core call as a query: its key is the call's name and arguments, so keys live here only.
// Trailing undefined arguments are left out of the key, so an optional head given or not makes the same key.
export function core<K extends Reads>(name: K, ...args: Parameters<Api[K]>) {
  const key = [name, ...args];
  while (key.length > 1 && key.at(-1) === undefined) key.pop();
  return queryOptions({
    queryKey: key,
    queryFn: async (): Promise<Awaited<ReturnType<Api[K]>>> => {
      const result = await (
        window.coxswain[name] as (...a: unknown[]) => Promise<Awaited<ReturnType<Api[K]>>>
      )(...args);
      const before = queryClient.getQueryData<{ status?: string }>(key);
      if (
        keepsOk.has(name) &&
        before?.status === "ok" &&
        (result as { status?: string }).status !== "ok"
      )
        throw new Error((result as { message?: string }).message ?? "GitHub is unreachable");
      return result;
    },
    // Also runs when the query commits its response, after any intervening IPC events.
    structuralSharing:
      name === "readAgentState"
        ? (before, after) => {
            const old = before as SessionState | undefined;
            const next = after as SessionState;
            return old && old.revision > next.revision ? old : next;
          }
        : true,
    ...extra[name],
  });
}

// The queries each kind of change makes stale: the only place that says so (ADR 0017). For a change in a workspace,
// those of that workspace, but for the unscoped ones (keyed by something else); for one outside, all of them.
const affects: Record<Changed["what"], Reads[]> = {
  entries: ["listEntries"],
  // Entries and Reviewed follow the code they're about (ADR 0014, 0015).
  worktree: [
    "snapshot",
    "uncommitted",
    "listTurns",
    "listCommits",
    "listChangedFiles",
    "listWorktreeFiles",
    "readWorktreeFile",
    "listReviewed",
    "listEntries",
    "summaryCoverage",
  ],
  // A turn's session reports its agent's choices of model and effort afresh.
  transcript: ["listAgentSessions", "listAgentPicks"],
  // An agent named a session.
  sessions: ["listAgentSessions"],
  view: ["listViews"],
  reviewed: ["listReviewed"],
  // ADR 0030: its PR or what's pushed moved; the sidebar shows the PR's title and state too.
  github: ["openWorktree", "readPullRequest", "listPullRequestTitles"],
  projects: ["listProjects"],
  workspaces: ["listWorkspaces"],
  // An agent sent its slash commands for one of its sessions.
  commands: ["agentCommands"],
  settings: [
    "getSummarySettings",
    "listPrompts",
    "getCommentToAgent",
    "listAgentPicks",
    "newSessionAgent",
  ],
};
const unscoped = new Set<Reads>(["listPullRequestTitles"]);

// Refetches what's on screen and marks the rest stale. Resolves once what's on screen is in.
// Live agent state arrives separately, including for sessions whose panes are absent.
export const changed = (change: Changed) =>
  queryClient.invalidateQueries({
    predicate: ({ queryKey: [name, id] }) =>
      affects[change.what].includes(name as Reads) &&
      (!("workspaceId" in change) || unscoped.has(name as Reads) || id === change.workspaceId),
  });

window.coxswain.onChanged(changed);

// Marks a file diff reviewed or not at once, and puts it back if the core fails to store it.
// Without head: the live diff; with it, a pinned range (ADR 0014).
export function markReviewed(
  workspaceId: number,
  mergeBase: string,
  path: string,
  on: boolean,
  head?: string,
  kind?: "diff" | "file",
) {
  const { queryKey } = core("listReviewed", workspaceId, mergeBase, head, kind);
  queryClient.setQueryData(queryKey, (v = []) => (on ? [...v, path] : v.filter((p) => p !== path)));
  window.coxswain
    .setReviewed(workspaceId, mergeBase, path, on, head, kind)
    .catch(() => queryClient.invalidateQueries({ queryKey }));
}

// Installed once for the window, independently of the mounted agent pane.
// The rail's statuses are asked for again only when a session's status changes, not at every token.
const statuses = new Map<string, string>();
window.coxswain.onAgentState((id, state) => {
  queryClient.setQueryData(core("readAgentState", id).queryKey, (before) =>
    before && before.revision > state.revision ? before : state,
  );
  const status = [!!state.permission, state.running, state.done].join();
  if (statuses.get(id) === status) return;
  statuses.set(id, status);
  void queryClient.invalidateQueries({ queryKey: core("listAgentStatuses").queryKey });
});

// ADR 0029: the core sends the file summary jobs whenever one changes.
// Coverage is counted again when a job starts or ends, not at every step of one.
let runningJobs = "";
window.coxswain.onJobs((jobs) => {
  queryClient.setQueryData(core("listJobs").queryKey, jobs);
  const running = jobs.flatMap((j) => (j.state === "running" ? [j.id] : [])).join();
  if (running === runningJobs) return;
  runningJobs = running;
  void queryClient.invalidateQueries({ queryKey: ["summaryCoverage"] });
});
