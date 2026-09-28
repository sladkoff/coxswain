import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { ChangedFile, GitProblem } from "../../core/git";
import type { GitHubProblem } from "../../core/github";
import type { Workspace } from "../../core/workspaces";
import { core, queryClient } from "./queries";

export type PullRequestData = {
  changed: ChangedFile[] | null;
  // head: what's on GitHub, the PR's head or the branch's (the merge base until it's pushed; ADR 0028).
  commits: { head: string; mergeBase: string } | null;
  // The local changes: what the worktree has on top of head (uncommitted, untracked, not pushed).
  local: ChangedFile[] | null;
  // The worktree as a commit now; a view pinned to another one is stale.
  snapshot: string | null;
  snapshotReady: boolean; // settled, including an error: a failed snapshot must not block the live diff
  notice: string | null;
  problem: GitHubProblem | GitProblem | null;
};

// What the Navigator and Viewer share about the current workspace: its worktree (cloned and created on first
// open, ADR 0008) and what differs from its merge base. The changes reload when the core says the worktree
// changed, e.g. after an agent turn; what's on GitHub is checked again after a minute, on window focus.
export function usePullRequest(workspace: Workspace | undefined): PullRequestData {
  const id = workspace?.id ?? 0;
  // Show a worktree opened before right away, then check GitHub and fetch in the background.
  const before = useQuery({ ...core("openedBefore", id), enabled: !!workspace }).data;
  const opened = useQuery({ ...core("openWorktree", id), enabled: !!workspace });
  const w = opened.data;
  const at = w?.status === "ok" ? w : before?.status === "ok" ? before : null;
  // Kept while head and merge base stay: a new object would reset what depends on it, e.g. the commit picked.
  const commits = useMemo(
    () => at && { head: at.head, mergeBase: at.mergeBase },
    [at?.head, at?.mergeBase],
  );
  // A branch workspace found its PR: the sidebar names it by the PR now.
  const prNumber = w?.status === "ok" ? w.prNumber : undefined;
  useEffect(() => {
    if (workspace && prNumber !== undefined && prNumber !== workspace.prNumber)
      void queryClient.invalidateQueries({ queryKey: ["listWorkspaces", workspace.projectId] });
  }, [prNumber, workspace?.prNumber]);
  const ready = !!workspace && !!commits;
  // ADR 0030: the core watches the workspace on screen for its HEAD moving.
  useEffect(() => {
    if (!ready) return;
    void window.coxswain.watchWorkspace(id);
    return () => void window.coxswain.watchWorkspace(null);
  }, [ready, id]);
  const changed = useQuery({
    ...core("listChangedFiles", id, commits?.mergeBase ?? ""),
    enabled: ready,
  }).data;
  const local = useQuery({
    ...core("listChangedFiles", id, commits?.head ?? ""),
    enabled: ready,
  }).data;
  const snapshotQuery = useQuery({ ...core("snapshot", id), enabled: ready });
  const snapshot = snapshotQuery.data;
  // Offline or signed out: keep showing the worktree, and say it may be out of date.
  const unchecked = opened.isError || (w && w.status !== "ok" && before?.status === "ok");
  return {
    changed: changed?.status === "ok" ? changed.files : null,
    commits,
    local: local?.status === "ok" ? local.files : null,
    snapshot: snapshot?.status === "ok" ? snapshot.sha : null,
    snapshotReady: snapshotQuery.isSuccess || snapshotQuery.isError,
    notice: unchecked
      ? "Could not check GitHub for new commits"
      : w?.status === "ok"
        ? w.notice
        : null,
    problem:
      w && w.status !== "ok" && !commits ? w : changed && changed.status !== "ok" ? changed : null,
  };
}
