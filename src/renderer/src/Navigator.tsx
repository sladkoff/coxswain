import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useState } from 'react'
import type { ChangedFile, GitProblem } from '../../core/git'
import type { Workspace } from '../../core/workspaces'
import { ProblemMessage, muted } from './ui'
import type { PullRequestData } from './usePullRequest'

export type NavigatorView = 'diffs' | 'files'

type Props = {
  workspace: Workspace
  pr: PullRequestData
  view: NavigatorView
  onOpen: (path: string) => void
}

// L2: the workspace's changed files (diffs) or its whole file tree (files).
// The file tree reloads whenever the changes do, since new files show up in both.
export function Navigator({ workspace, pr, view, onOpen }: Props) {
  const [tree, setTree] = useState<string[] | null>(null)
  const [treeProblem, setTreeProblem] = useState<GitProblem | null>(null)

  useEffect(() => {
    if (view !== 'files' || !pr.changed) return
    let stale = false
    window.coxswain.listWorktreeFiles(workspace.id).then((r) => {
      if (stale) return
      if (r.status === 'ok') setTree(r.paths)
      else setTreeProblem(r)
    })
    return () => void (stale = true)
  }, [view, pr.changed])

  const problem = pr.problem ?? treeProblem
  if (problem)
    return (
      <div className="p-2 text-xs">
        <ProblemMessage problem={problem} />
      </div>
    )
  const paths = view === 'diffs' ? pr.changed?.map((f) => f.path) : tree
  if (!pr.commits) return <div className={`p-2 text-xs ${muted}`}>Preparing the worktree (the first time clones the repository)…</div>
  if (!pr.changed || !paths) return <div className={`p-2 text-xs ${muted}`}>Loading…</div>
  if (paths.length === 0) return <div className={`p-2 text-xs ${muted}`}>No changed files</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pr.notice && <div className={`px-2 py-1 text-xs ${muted}`}>{pr.notice}</div>}
      {/* Remounts on reload: the tree takes its paths only when created. */}
      <Tree key={`${view}:${idOf(view === 'diffs' ? pr.changed : paths)}`} paths={paths} changed={pr.changed} expanded={view === 'diffs'} onOpen={onOpen} />
    </div>
  )
}

// A number per loaded list, so a reload (a new array) remounts the tree.
const ids = new WeakMap<object, number>()
let nextId = 0
const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ++nextId), nextId)

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
