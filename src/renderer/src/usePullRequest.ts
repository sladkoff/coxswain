import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ChangedFile, GitProblem } from '../../core/git'
import type { GitHubProblem } from '../../core/github'
import type { Workspace } from '../../core/workspaces'
import { core } from './queries'

export type PullRequestData = {
  changed: ChangedFile[] | null
  commits: { head: string; mergeBase: string } | null
  notice: string | null
  problem: GitHubProblem | GitProblem | null
}

// What the Navigator and Viewer share about the current workspace: its worktree (cloned and created on first
// open, ADR 0008) and what differs from the PR's merge base. The changes reload when the core says the worktree
// changed, e.g. after an agent turn; the PR's head is checked again after a minute, on window focus.
export function usePullRequest(workspace: Workspace | undefined): PullRequestData {
  const id = workspace?.id ?? 0
  // Show a worktree opened before right away, then check GitHub and fetch in the background.
  const before = useQuery({ ...core('openedBefore', id), enabled: !!workspace }).data
  const opened = useQuery({ ...core('openWorktree', id), enabled: !!workspace })
  const w = opened.data
  const at = w?.status === 'ok' ? w : before?.status === 'ok' ? before : null
  // Kept while head and merge base stay: a new object would reset what depends on it, e.g. the commit picked.
  const commits = useMemo(() => at && { head: at.head, mergeBase: at.mergeBase }, [at?.head, at?.mergeBase])
  const changed = useQuery({ ...core('listChangedFiles', id, commits?.mergeBase ?? ''), enabled: !!workspace && !!commits }).data
  // Offline or signed out: keep showing the worktree, and say it may be out of date.
  const unchecked = opened.isError || (w && w.status !== 'ok' && before?.status === 'ok')
  return {
    changed: changed?.status === 'ok' ? changed.files : null,
    commits,
    notice: unchecked ? 'Could not check the PR for new commits' : w?.status === 'ok' ? w.notice : null,
    problem: w && w.status !== 'ok' && !commits ? w : changed && changed.status !== 'ok' ? changed : null,
  }
}
