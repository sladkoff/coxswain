import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useRef, useState } from 'react'
import type { ChangedFile, GitProblem } from '../../core/git'
import type { Workspace } from '../../core/workspaces'
import type { NavigatorSettings } from '../../preload'
import { Cog, ProblemMessage, muted } from './ui'
import type { PullRequestData } from './usePullRequest'

export type NavigatorView = 'diffs' | 'files'

type Props = {
  workspace: Workspace
  pr: PullRequestData
  view: NavigatorView
  viewed: string[]
  showViewed: boolean
  onOpen: (path: string) => void
}

// L2: the workspace's changed files (diffs) or its whole file tree (files).
// The file tree reloads whenever the changes do, since new files show up in both.
export function Navigator({ workspace, pr, view, viewed, showViewed, onOpen }: Props) {
  const [tree, setTree] = useState<string[] | null>(null)
  const [treeProblem, setTreeProblem] = useState<GitProblem | null>(null)
  // ponytail: reset per workspace and on restart; store them with the other UI state once there's a settings table.
  const [settings, setSettings] = useState<NavigatorSettings>({ layout: 'tree' })

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
      {view === 'diffs' && (
        <div className={`flex items-center justify-between px-2 py-1 text-xs ${muted}`}>
          <span>
            {pr.changed.filter((f) => viewed.includes(f.path)).length} of {pr.changed.length} viewed
            {!showViewed && viewed.length > 0 && ', hidden'}
          </span>
          <button
            title="View options"
            className="rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            onClick={async () => setSettings(await window.coxswain.showNavigatorMenu(settings))}
          >
            <Cog />
          </button>
        </div>
      )}
      {/* Remounts on reload: the tree takes its paths only when created. */}
      <Tree
        key={`${view}:${settings.layout}:${idOf(view === 'diffs' ? pr.changed : paths)}`}
        paths={paths}
        changed={pr.changed}
        viewed={viewed}
        hidden={view === 'diffs' && !showViewed ? viewed : []}
        expanded={view === 'diffs'}
        flat={view === 'diffs' && settings.layout === 'list'}
        onOpen={onOpen}
      />
    </div>
  )
}

// A number per loaded list, so a reload (a new array) remounts the tree.
const ids = new WeakMap<object, number>()
let nextId = 0
const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ++nextId), nextId)

type TreeProps = {
  paths: string[]
  changed: ChangedFile[]
  viewed: string[]
  hidden: string[] // left out of the tree, e.g. viewed files
  expanded: boolean
  flat: boolean // every file as a top-level row with its full path, no folders
  onOpen: (path: string) => void
}

// A list is a tree without folders. @pierre/trees has no list mode, so each row is named after the file alone,
// with its folder shown next to the +/− lines. Two files with the same name keep their whole path, with its
// slashes as division slashes (U+2215), which look alike but don't make folders. Paths are mapped at the edges
// of the tree only.
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')))
function listRows(paths: string[]): (p: string) => string {
  const seen = new Map<string, number>()
  for (const p of paths) seen.set(baseName(p), (seen.get(baseName(p)) ?? 0) + 1)
  return (p) => (seen.get(baseName(p))! > 1 ? p.replaceAll('/', '∕') : baseName(p))
}

function Tree({ paths, changed, viewed, hidden, expanded, flat, onOpen }: TreeProps) {
  const [row] = useState(() => (flat ? listRows(paths) : (p: string) => p))
  const visible = paths.filter((p) => !hidden.includes(p)).map(row)
  const [counts] = useState(
    () =>
      new Map(
        changed.map((f) => {
          const lines = `+${f.additions} −${f.deletions}`
          const folder = flat && row(f.path) === baseName(f.path) ? dirName(f.path) : ''
          return [row(f.path), { lines, folder }]
        }),
      ),
  )
  const [files] = useState(() => new Map(paths.map((p) => [row(p), p])))
  // Read by the decorations, which the tree takes only when created.
  const viewedNow = useRef(new Set(viewed.map(row)))
  const { model } = useFileTree({
    paths: visible,
    gitStatus: changed.map((f) => ({ path: row(f.path), status: f.status })),
    initialExpansion: expanded ? 'open' : 'closed',
    flattenEmptyDirectories: true,
    density: 'compact',
    renderRowDecoration: ({ item }) => {
      const c = counts.get(item.path)
      if (!c) return null
      const viewed = viewedNow.current.has(item.path)
      const parts = [
        ...(c.folder ? [{ text: c.folder, color: '#a3a3a3' }] : []),
        // The gap after the folder is an em space starting the next part: trailing space on the folder is trimmed.
        ...(viewed ? [{ text: '\u2003✓ ', color: '#16a34a' }] : []),
        { text: viewed ? c.lines : `\u2003${c.lines}` },
      ]
      return { text: parts.map((p) => p.text).join(''), title: viewed ? 'Viewed' : undefined, parts }
    },
    // Selecting a folder only opens it; selecting a file opens it in the Viewer.
    onSelectionChange: (selected) => {
      const path = selected.at(-1)
      const file = path && files.get(path)
      if (file) onOpen(file)
    },
  })
  useEffect(() => {
    const before = viewedNow.current
    viewedNow.current = new Set(viewed.map(row))
    const toggled = changed
      .map((f) => ({ path: row(f.path), status: f.status }))
      .filter((f) => before.has(f.path) !== viewedNow.current.has(f.path))
    // ponytail: the tree has no call to redraw decorations, so drop and restore the git status of the toggled
    // rows to make it redraw them. Replace with a decoration refresh if @pierre/trees gets one.
    if (!toggled.length) return
    model.applyGitStatusPatch({ remove: toggled.map((f) => f.path) })
    model.applyGitStatusPatch({ set: toggled })
  }, [viewed])
  const visibleKey = visible.join('\0')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    model.resetPaths(visible)
  }, [visibleKey])
  return <FileTree model={model} className="min-h-0 flex-1" style={{ height: '100%' }} />
}
