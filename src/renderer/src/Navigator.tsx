import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useState } from 'react'
import type { ChangedFile, GitHubProblem } from '../../core/github'
import type { Project } from '../../core/projects'
import { GitHubProblemMessage, muted } from './ui'
import type { PullRequestData } from './usePullRequest'

export type NavigatorView = 'diffs' | 'files'

type Props = {
  project: Project
  pr: PullRequestData
  view: NavigatorView
  onOpen: (path: string) => void
}

// L2: the workspace's changed files (diffs) or its whole file tree (files).
export function Navigator({ project, pr, view, onOpen }: Props) {
  const [tree, setTree] = useState<{ paths: string[]; truncated: boolean } | null>(null)
  const [treeProblem, setTreeProblem] = useState<GitHubProblem | null>(null)

  useEffect(() => {
    if (view !== 'files' || tree || !pr.commits) return
    window.coxswain.listFilesAt(project.owner, project.name, pr.commits.head).then((r) => {
      if (r.status === 'ok') setTree(r)
      else setTreeProblem(r)
    })
  }, [view, pr.commits])

  const problem = pr.problem ?? treeProblem
  if (problem)
    return (
      <div className="p-2 text-xs">
        <GitHubProblemMessage problem={problem} />
      </div>
    )
  const paths = view === 'diffs' ? pr.changed?.map((f) => f.path) : tree?.paths
  if (!pr.changed || !paths) return <div className={`p-2 text-xs ${muted}`}>Loading…</div>
  if (paths.length === 0) return <div className={`p-2 text-xs ${muted}`}>No changed files</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view === 'files' && tree?.truncated && (
        <div className={`px-2 py-1 text-xs ${muted}`}>Too many files: GitHub returned only part of the tree.</div>
      )}
      <Tree key={view} paths={paths} changed={pr.changed} expanded={view === 'diffs'} onOpen={onOpen} />
    </div>
  )
}

type TreeProps = { paths: string[]; changed: ChangedFile[]; expanded: boolean; onOpen: (path: string) => void }

function Tree({ paths, changed, expanded, onOpen }: TreeProps) {
  const [counts] = useState(() => new Map(changed.map((f) => [f.path, `+${f.additions} −${f.deletions}`])))
  const [files] = useState(() => new Set(paths))
  const { model } = useFileTree({
    paths,
    gitStatus: changed.map((f) => ({ path: f.path, status: f.status })),
    initialExpansion: expanded ? 'open' : 'closed',
    flattenEmptyDirectories: true,
    density: 'compact',
    renderRowDecoration: ({ item }) => {
      const text = counts.get(item.path)
      return text ? { text } : null
    },
    // Selecting a folder only opens it; selecting a file opens it in the Viewer.
    onSelectionChange: (selected) => {
      const path = selected.at(-1)
      if (path && files.has(path)) onOpen(path)
    },
  })
  return <FileTree model={model} className="min-h-0 flex-1" style={{ height: '100%' }} />
}
