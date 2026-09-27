import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { Changed, CoxswainApi } from "../../preload";

// Every read from the core goes through TanStack Query (ADR 0017). Core data is stale at once but only refetched
// when a pane mounts or the core says it changed; GitHub's is refetched after a minute, on window focus.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

type Api = CoxswainApi;
type Reads = {
  [K in keyof Api]: Api[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof Api];

const github = { staleTime: 60_000, refetchOnWindowFocus: true };
const extra: Partial<Record<Reads, { staleTime?: number; refetchOnWindowFocus?: boolean }>> = {
  readFileAt: { staleTime: Infinity }, // a file at a commit never changes
  openWorktree: github, // asks GitHub for the PR's head and fetches it
  listPullRequests: github,
};
// Offline or signed out: a GitHub read keeps what it fetched before. Throwing leaves the query's data as it was.
const keepsOk = new Set<Reads>(["openWorktree"]);

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
    ...extra[name],
  });
}

// The queries each kind of change makes stale, for the workspace it happened in.
const affects: Record<Changed["what"], Reads[]> = {
  entries: ["listEntries"],
  // Entries and Reviewed follow the code they're about (ADR 0014, 0015).
  worktree: [
    "listChangedFiles",
    "listWorktreeFiles",
    "readWorktreeFile",
    "listReviewed",
    "listEntries",
  ],
  // A turn's session reports its agent's choices of model and effort afresh.
  transcript: ["listAgentSessions", "readTranscript", "listAgentPicks"],
  guide: ["listGuides"],
};

// Refetches what's on screen and marks the rest stale. Resolves once what's on screen is in.
// readTranscript's key has no workspace, so every one is marked; only the one on screen refetches.
export const changed = ({ workspaceId, what }: Changed) =>
  queryClient.invalidateQueries({
    predicate: ({ queryKey: [name, id] }) =>
      affects[what].includes(name as Reads) && (id === workspaceId || name === "readTranscript"),
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
) {
  const { queryKey } = core("listReviewed", workspaceId, mergeBase, head);
  queryClient.setQueryData(queryKey, (v = []) => (on ? [...v, path] : v.filter((p) => p !== path)));
  window.coxswain
    .setReviewed(workspaceId, mergeBase, path, on, head)
    .catch(() => queryClient.invalidateQueries({ queryKey }));
}
