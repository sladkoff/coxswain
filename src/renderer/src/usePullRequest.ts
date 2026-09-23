import { useEffect, useState } from 'react'
import type { ChangedFile, GitHubProblem } from '../../core/github'
import type { Project } from '../../core/projects'
import type { Workspace } from '../../core/workspaces'

export type PullRequestData = {
  changed: ChangedFile[] | null
  commits: { head: string; mergeBase: string } | null
  problem: GitHubProblem | null
}

// What the Navigator and Viewer share about the current workspace's PR, loaded once per workspace.
export function usePullRequest(project: Project | undefined, workspace: Workspace | undefined): PullRequestData {
  const [data, setData] = useState<PullRequestData>({ changed: null, commits: null, problem: null })

  useEffect(() => {
    setData({ changed: null, commits: null, problem: null })
    if (!project || !workspace) return
    let stale = false
    const { owner, name } = project
    Promise.all([
      window.coxswain.listChangedFiles(owner, name, workspace.prNumber),
      window.coxswain.getPullRequestCommits(owner, name, workspace.prNumber),
    ]).then(([changed, commits]) => {
      if (stale) return
      if (changed.status !== 'ok') return setData({ changed: null, commits: null, problem: changed })
      if (commits.status !== 'ok') return setData({ changed: null, commits: null, problem: commits })
      setData({ changed: changed.files, commits, problem: null })
    })
    return () => void (stale = true)
  }, [project?.id, workspace?.id])

  return data
}
