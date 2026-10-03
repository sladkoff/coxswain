import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { ChangedFile, GitProblem } from "../../core/git";
import type { GitHubProblem, PullRequestDetails } from "../../core/github";
import type { Workspace } from "../../core/workspaces";
import { core } from "./queries";

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
  // ADR 0037: the PR on GitHub, for its panel, CI and the review threads mirrored into entries; null without one.
  details: PullRequestDetails | null;
};

// What the Navigator and Viewer share about the current workspace: its worktree (cloned and created on first
// open, ADR 0008) and what differs from its merge base. Everything reloads when the core says it changed: the
// worktree after an agent turn or when HEAD moves, what's on GitHub when its check found something new (ADR 0030).
export function usePullRequest(workspace: Workspace | undefined): PullRequestData {
  const id = workspace?.id ?? 0;
  // ADR 0030: the core keeps the workspace on screen fresh, and checks GitHub for it at once.
  useEffect(() => {
    if (!workspace) return;
    void window.coxswain.watchWorkspace(id);
    return () => void window.coxswain.watchWorkspace(null);
  }, [id]);
  // What the core's last check found, at once when it has checked before, else once the first check is in.
  const opened = useQuery({ ...core("openWorktree", id), enabled: !!workspace });
  const w = opened.data;
  const at = w?.status === "ok" ? w : null;
  // Kept while head and merge base stay: a new object would reset what depends on it, e.g. the commit picked.
  const commits = useMemo(
    () => at && { head: at.head, mergeBase: at.mergeBase },
    [at?.head, at?.mergeBase],
  );
  const prNumber = w?.status === "ok" ? w.prNumber : undefined;
  const ready = !!workspace && !!commits;
  const changed = useQuery({
    ...core("listChangedFiles", id, commits?.mergeBase ?? ""),
    enabled: ready,
  }).data;
  const local = useQuery({
    ...core("listChangedFiles", id, commits?.head ?? ""),
    enabled: ready,
  }).data;
  const snapshotQuery = useQuery({ ...core("snapshot", id), enabled: ready });
  // Read once the worktree is open: the threads it mirrors are anchored there.
  const details = useQuery({
    ...core("readPullRequest", id),
    enabled: ready && (prNumber ?? workspace?.prNumber ?? null) !== null,
  }).data;
  const snapshot = snapshotQuery.data;
  return {
    changed: changed?.status === "ok" ? changed.files : null,
    commits,
    local: local?.status === "ok" ? local.files : null,
    snapshot: snapshot?.status === "ok" ? snapshot.sha : null,
    snapshotReady: snapshotQuery.isSuccess || snapshotQuery.isError,
    notice: at?.notice ?? null, // offline, the core keeps the last check's and says so here
    problem:
      w && w.status !== "ok" && !commits ? w : changed && changed.status !== "ok" ? changed : null,
    details: details?.status === "ok" ? details : null,
  };
}
