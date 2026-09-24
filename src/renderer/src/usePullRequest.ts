import { useEffect, useState } from 'react'
import type { ChangedFile, GitProblem } from '../../core/git'
import type { GitHubProblem } from '../../core/github'
import type { Workspace } from '../../core/workspaces'

export type PullRequestData = {
  changed: ChangedFile[] | null
  commits: { head: string; mergeBase: string } | null
  notice: string | null
  problem: GitHubProblem | GitProblem | null
}

const empty: PullRequestData = { changed: null, commits: null, notice: null, problem: null }

// What the Navigator and Viewer share about the current workspace: its worktree (cloned and created on first
// open, ADR 0008) and what differs from the PR's merge base. `version` changes reload the changes, e.g. after
// an agent turn.
export function usePullRequest(workspace: Workspace | undefined, version: number): PullRequestData {
  // workspaceId: whose data it is. Reset only in an effect, so the first render after switching workspace still
  // holds the last one's, and children's effects run before this one's: a Guide would make a guide for the new
  // workspace from the old merge base. Returned only when it's the current workspace's.
  const [data, setData] = useState<PullRequestData & { workspaceId?: number }>(empty)

  useEffect(() => {
    setData(empty)
    if (!workspace) return
    let stale = false
    const id = workspace.id
    const start = { ...empty, workspaceId: id }
    ;(async () => {
      // Show a worktree opened before right away, then check GitHub and fetch in the background.
      const before = await window.coxswain.openedBefore(id)
      if (stale) return
      if (before?.status === 'ok') setData({ ...start, commits: { head: before.head, mergeBase: before.mergeBase } })
      const w = await window.coxswain.openWorktree(id)
      if (stale) return
      if (w.status !== 'ok') {
        // Offline or signed out: keep showing the worktree, and say it may be out of date.
        if (before) setData((d) => ({ ...d, notice: 'Could not check the PR for new commits' }))
        else setData({ ...start, problem: w })
      } else if (!before || before.status !== 'ok' || w.head !== before.head || w.mergeBase !== before.mergeBase) {
        setData({ ...start, commits: { head: w.head, mergeBase: w.mergeBase }, notice: w.notice })
      } else if (w.notice) setData((d) => ({ ...d, notice: w.notice }))
    })()
    return () => void (stale = true)
  }, [workspace?.id])

  useEffect(() => {
    if (!workspace || !data.commits) return
    let stale = false
    window.coxswain.listChangedFiles(workspace.id, data.commits.mergeBase).then((changed) => {
      if (stale) return
      if (changed.status !== 'ok') setData((d) => ({ ...d, problem: changed }))
      else setData((d) => ({ ...d, changed: changed.files }))
    })
    return () => void (stale = true)
  }, [data.commits, version])

  return data.workspaceId === workspace?.id ? data : empty
}
