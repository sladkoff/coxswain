import { Virtualizer } from '@pierre/diffs/react'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import type { Commit } from '../../core/git'
import type { NewEntry, ReviewEntry } from '../../core/review'
import type { Workspace } from '../../core/workspaces'
import { Agents } from './Agents'
import { Navigator, type NavigatorView } from './Navigator'
import { NewWorkspace } from './NewWorkspace'
import { Onboarding } from './Onboarding'
import { Projects } from './Projects'
import { changed, core, markViewed as mark, queryClient } from './queries'
import { Settings } from './Settings'
import { usePullRequest } from './usePullRequest'
import type { ViewSettings } from '../../preload'
import { Cog, Splitter, viewerMin } from './ui'
import { type Opened, type Turn, Viewer } from './Viewer'

const pane = 'border-neutral-200 dark:border-neutral-800'
const muted = 'text-xs text-neutral-500'
// Stable empty lists: a new [] each render would redraw the memoised Viewers.
const noEntries: ReviewEntry[] = []
const noPaths: string[] = []

export function App() {
  const [screen, setScreen] = useState<'main' | 'settings' | 'projects' | 'new-workspace'>('main')
  useEffect(() => window.coxswain.onOpenSettings(() => setScreen('settings')), [])
  const close = () => setScreen('main')

  const projects = useQuery(core('listProjects')).data
  const current = projects?.[0] // listed most recently opened first
  const selectProject = async (fullName: string) => {
    await window.coxswain.openProject(fullName)
    await queryClient.invalidateQueries({ queryKey: ['listProjects'] })
    close()
  }

  // ponytail: pane widths reset on restart; persist them in SQLite once a settings table exists.
  const [leftWidth, setLeftWidth] = useState(416)
  const [agentsWidth, setAgentsWidth] = useState(416)
  // The Navigator is on the left of the canvas. Starts hidden.
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  useEffect(() => window.coxswain.onToggleNavigator(() => setNavigatorOpen((o) => !o)), [])

  const [view, setView] = useState<NavigatorView>('diffs')
  // ponytail: resets on restart, like the Navigator's settings; store them once there's a settings table.
  const [viewSettings, setViewSettings] = useState<ViewSettings>({ diffStyle: 'unified', showViewed: false })
  const workspaces = useQuery({ ...core('listWorkspaces', current?.id ?? 0), enabled: !!current }).data ?? []
  const currentWorkspace = workspaces.reduce<Workspace | undefined>(
    (latest, w) => (!latest || w.lastOpenedAt > latest.lastOpenedAt ? w : latest),
    undefined,
  )
  const selectWorkspace = async (prNumber: number) => {
    if (!current) return
    await window.coxswain.openPullRequestWorkspace(current.id, prNumber)
    await queryClient.invalidateQueries({ queryKey: ['listWorkspaces', current.id] })
    close()
  }

  // ADR 0008: clone as soon as a project is current; opening a workspace waits for it.
  const [cloning, setCloning] = useState(false)
  useEffect(() => {
    if (!current) return
    setCloning(true)
    window.coxswain.cloneProject(current.id).finally(() => setCloning(false))
  }, [current?.id])

  const pr = usePullRequest(currentWorkspace)
  // The Diff tab's Commits: one commit's diff (its parent to it) in place of all changes. The Guide keeps all changes.
  const [commit, setCommit] = useState<Commit | null>(null)
  useEffect(() => setCommit(null), [currentWorkspace?.id, pr.commits])

  // The workspace's entries, as the canvas shows them (ADR 0015: the live diff, or the commit picked). A pinned guide
  // lists its own.
  const base = commit?.parent ?? pr.commits?.mergeBase
  const entries =
    useQuery({ ...core('listEntries', currentWorkspace?.id ?? 0, base ?? '', commit?.sha), enabled: !!currentWorkspace && !!base })
      .data ?? noEntries
  // Callbacks handed to the Viewers are stable (useCallback), so a memoised Viewer doesn't redraw its file diff.
  // Paths of the live diff's viewed file diffs. Reloaded with the changes, since a file diff that changed is no
  // longer viewed (ADR 0014).
  const mergeBase = pr.commits?.mergeBase
  const viewed =
    useQuery({ ...core('listViewed', currentWorkspace?.id ?? 0, mergeBase ?? ''), enabled: !!currentWorkspace && !!mergeBase && !!pr.changed })
      .data ?? noPaths
  const markViewed = useCallback(
    (path: string, on: boolean) => void (currentWorkspace && mergeBase && mark(currentWorkspace.id, mergeBase, path, on)),
    [currentWorkspace?.id, mergeBase],
  )
  // Questions' turns by thread, kept here so they outlive the Viewer showing them. The reply streams in as chat
  // entries; once the turn ends it's an answer entry. A tool use to approve waits in permission until answered.
  const [turns, setTurns] = useState<Record<number, Turn>>({})
  useEffect(() => {
    const offChat = window.coxswain.onQuestionChat((id, c) =>
      setTurns((t) => ({ ...t, [id]: { running: true, error: null, live: [...(t[id]?.live ?? []), c], permission: t[id]?.permission ?? null } })),
    )
    const offPermission = window.coxswain.onQuestionPermission((id, permission) =>
      setTurns((t) => ({ ...t, [id]: { running: true, error: null, live: t[id]?.live ?? [], permission } })),
    )
    // The answer entry comes with the core's change event, just before this.
    const offEnd = window.coxswain.onQuestionEnd((id, result) =>
      setTurns((t) => ({ ...t, [id]: { running: false, error: result.status === 'error' ? result.message : null, live: [], permission: null } })),
    )
    return () => {
      offChat()
      offPermission()
      offEnd()
    }
  }, [])
  const answerPermission = useCallback((threadId: number, id: string, optionId: string) => {
    window.coxswain.answerPermission(id, optionId)
    setTurns((t) => ({ ...t, [threadId]: { ...t[threadId], permission: null } }))
  }, [])
  const ask = useCallback(async (q: NewEntry) => {
    const question = await window.coxswain.askQuestion(q)
    const id = question.parentId ?? question.id
    setTurns((t) => ({ ...t, [id]: { running: true, error: null, live: t[id]?.live ?? [], permission: t[id]?.permission ?? null } }))
    changed({ workspaceId: q.workspaceId, what: 'entries' })
  }, [])
  // `opened` is a whole file picked in Files, shown on the canvas in place of the file diffs.
  const [opened, setOpened] = useState<Opened | null>(null)
  useEffect(() => setOpened(null), [currentWorkspace?.id])
  // Memoised: the Viewer rereads when its Opened changes.
  const diffs = useMemo(() => pr.changed?.map((file) => ({ kind: 'diff' as const, file })), [pr.changed])
  const commitList = useQuery({
    ...core('listChangedFiles', currentWorkspace?.id ?? 0, commit?.parent ?? '', commit?.sha),
    enabled: !!currentWorkspace && !!commit,
  }).data
  // ponytail: a git error shows as no changes; show it like the Navigator's problems if it happens.
  const commitChanged = useMemo(() => (commitList ? (commitList.status === 'ok' ? commitList.files : []) : null), [commitList])
  const diffPr = commit ? { ...pr, changed: commitChanged } : pr
  const diffDiffs = useMemo(
    () => (commit ? commitChanged?.map((file) => ({ kind: 'diff' as const, file })) : diffs),
    [commit, commitChanged, diffs],
  )
  const pickCommit = async () => {
    if (!currentWorkspace || !pr.commits) return
    const picked = await window.coxswain.showCommitsMenu(currentWorkspace.id, pr.commits.mergeBase, commit?.sha ?? null)
    setCommit(picked)
    setOpened(null)
  }
  const open = (path: string) => {
    if (view === 'files') return setOpened({ kind: 'file', path })
    // ponytail: file diffs above it that are still loading push it down.
    document.getElementById(`diff:${path}`)?.scrollIntoView()
  }
  const showFile = view === 'files' && opened
  // Shows a thread on the canvas: back to the live file diffs, scrolled to its file, then to the thread once the
  // file diff has drawn it. ponytail: an outdated thread isn't between the lines, so this stops at its file.
  const viewThread = (threadId: number) => {
    const root = entries.find((e) => e.id === threadId)
    if (!root?.path) return
    setOpened(null)
    setCommit(null)
    document.getElementById(`diff:${root.path}`)?.scrollIntoView()
    let tries = 20
    const find = () => {
      const el = document.getElementById(`thread:${threadId}`)
      if (el) el.scrollIntoView({ block: 'center' })
      else if (tries--) setTimeout(find, 50)
    }
    find()
  }

  const viewerProps = (workspace: Workspace, mergeBase: string, head?: string) => ({
    workspace,
    mergeBase,
    head,
    entries,
    viewed,
    onViewedChange: markViewed,
    turns,
    onAsk: ask,
    onAnswerPermission: answerPermission,
    diffStyle: viewSettings.diffStyle,
  })

  if (screen === 'settings') return <Settings onClose={close} />
  if (screen === 'projects')
    return <Projects projects={projects ?? []} current={current} onSelect={selectProject} onClose={close} />
  if (screen === 'new-workspace' && current)
    return (
      <NewWorkspace
        project={current}
        openPrNumbers={workspaces.map((w) => w.prNumber)}
        onSelect={selectWorkspace}
        onClose={close}
      />
    )
  if (!projects) return null // local and near-instant, so no loading screen
  if (!current)
    return <Onboarding onSettings={() => setScreen('settings')} onChooseProject={() => setScreen('projects')} />

  // Empty shell of the main screen from docs/UX.md: L1 project and workspaces, the agent pane, the canvas.
  return (
    // Side panes keep their dragged width but shrink with the window before the Viewer goes below viewerMin.
    <div className="flex h-full select-none overflow-hidden text-sm">
      <div className={`flex flex-col ${pane}`}>
        {/* The bar drags the window; the macOS window buttons reach past it into L3's, so the border starts below it. */}
        <div className={`h-10 shrink-0 border-b [-webkit-app-region:drag] ${pane}`} />
        <div className={`flex min-h-0 flex-1 border-r ${pane}`}>
          <div className="flex w-12 flex-col items-center gap-2 py-2">
            {/* The current project, like a Discord server icon. Opens the list to switch or add projects. */}
            <button
              title={`${current.owner}/${current.name}${cloning ? ' (cloning…)' : ''}: switch or add project`}
              onClick={() => setScreen('projects')}
              className={`${cloning ? 'animate-pulse' : ''} flex size-7 items-center justify-center rounded-md bg-neutral-800 text-xs font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900`}
            >
              {current.name[0].toUpperCase()}
            </button>
            <div className="h-px w-5 bg-neutral-200 dark:bg-neutral-800" />
            {/* The project's workspaces; the pill on the left marks the current one. */}
            {workspaces.map((w) => {
              const selected = w.id === currentWorkspace?.id
              return (
                <div key={w.id} className="relative flex w-full justify-center">
                  {selected && (
                    <span className="absolute top-1 left-0 h-5 w-1 rounded-r bg-neutral-900 dark:bg-neutral-100" />
                  )}
                  <button
                    title={`PR #${w.prNumber}`}
                    onClick={() => selectWorkspace(w.prNumber)}
                    className={`flex h-7 w-10 items-center justify-center rounded-md text-[10px] font-medium ${
                      selected
                        ? 'bg-neutral-300 text-neutral-900 dark:bg-neutral-600 dark:text-white'
                        : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800/60 dark:hover:bg-neutral-800'
                    }`}
                  >
                    #{w.prNumber}
                  </button>
                </div>
              )
            })}
            <button
              title="New workspace"
              onClick={() => setScreen('new-workspace')}
              className="flex size-7 items-center justify-center rounded-md text-base text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {currentWorkspace && (
        <>
          {/* The agent pane, always shown for a workspace. */}
          <div style={{ width: agentsWidth }} className={`flex min-w-60 flex-col border-r ${pane}`}>
            <Agents
              key={currentWorkspace.id}
              workspace={currentWorkspace}
              onViewThread={viewThread}
            />
          </div>
          <Splitter min={240} max={800} onResize={setAgentsWidth} />
        </>
      )}

      {/* The canvas: what the agent and the human look at together. For now, the workspace's file diffs. */}
      <div style={{ minWidth: viewerMin }} className="flex min-w-0 flex-1 flex-col">
        <div className={`flex h-10 shrink-0 items-center gap-1 border-b px-2 text-xs [-webkit-app-region:drag] ${pane}`}>
          {currentWorkspace && (
            <div className="flex flex-1 items-center gap-1 [-webkit-app-region:no-drag]">
              <BarToggle title="Show or hide the files (⌘B)" on={navigatorOpen} onClick={() => setNavigatorOpen((o) => !o)}>
                Files {diffPr.changed?.length ?? ''}
              </BarToggle>
              <button
                title="Show all changes or one commit's"
                disabled={!pr.commits}
                className={`max-w-80 truncate rounded px-2 py-0.5 ${commit ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                onClick={pickCommit}
              >
                {commit ? `${commit.sha.slice(0, 7)} ${commit.subject}` : 'Commits'}
              </button>
              <div className="flex-1" />
              <button
                title="View options"
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={async () => setViewSettings(await window.coxswain.showViewMenu(viewSettings))}
              >
                <Cog />
              </button>
            </div>
          )}
        </div>
        {!currentWorkspace ? (
          <div className={`flex flex-1 items-center justify-center ${muted}`}>No workspace. Start one with +</div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {navigatorOpen && (
              <>
                <div style={{ width: leftWidth }} className={`flex min-w-60 flex-col border-r ${pane}`}>
                  <div className="flex shrink-0 justify-end px-2 pt-1.5">
                    <ViewToggle view={view} onChange={setView} />
                  </div>
                  <Navigator key={currentWorkspace.id} workspace={currentWorkspace} pr={diffPr} view={view} viewed={viewed} showViewed={viewSettings.showViewed} entries={entries} onOpen={open} />
                </div>
                <Splitter min={240} max={720} onResize={setLeftWidth} />
              </>
            )}
            <div style={{ minWidth: viewerMin }} className="flex min-w-0 flex-1 flex-col">
              {!pr.commits || !diffDiffs ? (
                <div className={`flex flex-1 items-center justify-center ${muted}`}>Loading…</div>
              ) : showFile ? (
                <Viewer opened={opened} {...viewerProps(currentWorkspace, pr.commits.mergeBase)} />
              ) : (
                // Only the lines on screen are drawn. ponytail: every file is still read from disk up front.
                <Virtualizer className="min-h-0 flex-1 overflow-auto">
                  {diffDiffs.length === 0 && <div className={`p-4 text-xs ${muted}`}>No changes</div>}
                  {diffDiffs.map((d) => (
                    <div key={d.file.path} id={`diff:${d.file.path}`}>
                      <Viewer stacked opened={d} {...viewerProps(currentWorkspace, commit?.parent ?? pr.commits!.mergeBase, commit?.sha)} />
                    </div>
                  ))}
                </Virtualizer>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// A toggle in the canvas's bar that shows or hides a pane.
function BarToggle(props: { title: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      className={`rounded px-2 py-0.5 ${props.on ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
    >
      {props.children}
    </button>
  )
}

function ViewToggle({ view, onChange }: { view: NavigatorView; onChange: (view: NavigatorView) => void }) {
  return (
    <div className="flex rounded-md bg-neutral-100 p-0.5 text-xs dark:bg-neutral-800">
      {(['diffs', 'files'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded px-2 py-0.5 capitalize ${v === view ? 'bg-white shadow-sm dark:bg-neutral-600' : 'text-neutral-500'}`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}
