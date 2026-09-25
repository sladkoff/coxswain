import { Virtualizer } from '@pierre/diffs/react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import type { Comment } from '../../core/comments'
import type { Project } from '../../core/projects'
import type { Workspace } from '../../core/workspaces'
import { Agents } from './Agents'
import { Navigator, type NavigatorView } from './Navigator'
import { NewWorkspace } from './NewWorkspace'
import { Onboarding } from './Onboarding'
import { Guide } from './Guide'
import { Overview } from './Overview'
import { Projects } from './Projects'
import { Settings } from './Settings'
import { usePullRequest } from './usePullRequest'
import type { ViewSettings } from '../../preload'
import { Cog, Splitter, viewerMin } from './ui'
import { type Opened, type Turn, Viewer } from './Viewer'

const pane = 'border-neutral-200 dark:border-neutral-800'
const muted = 'text-xs text-neutral-500'

export function App() {
  const [screen, setScreen] = useState<'main' | 'settings' | 'projects' | 'new-workspace'>('main')
  useEffect(() => window.coxswain.onOpenSettings(() => setScreen('settings')), [])
  const close = () => setScreen('main')

  const [projects, setProjects] = useState<Project[] | null>(null) // null until loaded
  const current = projects?.[0] // listed most recently opened first
  useEffect(() => void window.coxswain.listProjects().then(setProjects), [])
  const selectProject = async (fullName: string) => {
    await window.coxswain.openProject(fullName)
    setProjects(await window.coxswain.listProjects())
    close()
  }

  // ponytail: pane widths reset on restart; persist them in SQLite once a settings table exists.
  const [leftWidth, setLeftWidth] = useState(416)
  const [agentsWidth, setAgentsWidth] = useState(320)
  // The Navigator is on the left of the Diff tab. Both start hidden.
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const [agentsOpen, setAgentsOpen] = useState(false)
  useEffect(() => window.coxswain.onToggleNavigator(() => setNavigatorOpen((o) => !o)), [])
  useEffect(() => window.coxswain.onToggleAgents(() => setAgentsOpen((o) => !o)), [])

  const [view, setView] = useState<NavigatorView>('diffs')
  // ponytail: resets on restart, like the Navigator's settings; store them once there's a settings table.
  const [viewSettings, setViewSettings] = useState<ViewSettings>({ diffStyle: 'unified', showViewed: false })
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const currentWorkspace = workspaces.reduce<Workspace | undefined>(
    (latest, w) => (!latest || w.lastOpenedAt > latest.lastOpenedAt ? w : latest),
    undefined,
  )
  useEffect(() => {
    setWorkspaces([])
    if (current) window.coxswain.listWorkspaces(current.id).then(setWorkspaces)
  }, [current?.id])
  const selectWorkspace = async (prNumber: number) => {
    if (!current) return
    await window.coxswain.openPullRequestWorkspace(current.id, prNumber)
    setWorkspaces(await window.coxswain.listWorkspaces(current.id))
    close()
  }

  // ADR 0008: clone as soon as a project is current; opening a workspace waits for it.
  const [cloning, setCloning] = useState(false)
  useEffect(() => {
    if (!current) return
    setCloning(true)
    window.coxswain.cloneProject(current.id).finally(() => setCloning(false))
  }, [current?.id])

  // Bumped when an agent turn ends, so the Navigator and Viewer show what the agent changed.
  const [version, setVersion] = useState(0)
  const pr = usePullRequest(currentWorkspace, version)

  // The workspace's local comments, and those waiting in the L4 message box.
  const [comments, setComments] = useState<Comment[]>([])
  const [attached, setAttached] = useState<Comment[]>([])
  // Callbacks handed to the Viewers are stable (useCallback), so a memoised Viewer doesn't redraw its file diff.
  const loadComments = useCallback(
    () => void (currentWorkspace && window.coxswain.listComments(currentWorkspace.id).then(setComments)),
    [currentWorkspace?.id],
  )
  useEffect(() => {
    setComments([])
    setAttached([])
  }, [currentWorkspace?.id])
  useEffect(() => void loadComments(), [currentWorkspace?.id, version])
  // A deleted comment leaves the message box too.
  useEffect(() => setAttached((a) => a.filter((c) => comments.some((k) => k.id === c.id))), [comments])
  // Paths of the viewed file diffs. Reloaded with the changes, since a file diff that changed is no longer viewed.
  const [viewed, setViewed] = useState<string[]>([])
  useEffect(() => {
    setViewed([])
    if (currentWorkspace && pr.commits && pr.changed)
      window.coxswain.listViewed(currentWorkspace.id, pr.commits.mergeBase).then(setViewed)
  }, [currentWorkspace?.id, pr.changed])
  const mergeBase = pr.commits?.mergeBase
  const markViewed = useCallback(
    (path: string, on: boolean) => {
      if (!currentWorkspace || !mergeBase) return
      setViewed((v) => (on ? [...v, path] : v.filter((p) => p !== path)))
      window.coxswain.setViewed(currentWorkspace.id, mergeBase, path, on)
    },
    [currentWorkspace?.id, mergeBase],
  )
  // Turns of the agent sessions in comment threads, kept here so they outlive the Viewer showing them.
  const [turns, setTurns] = useState<Record<string, Turn>>({})
  const runThreadTurn = useCallback(async (agentSessionId: string, message: string, commentIds: number[]) => {
    setTurns((t) => ({ ...t, [agentSessionId]: { running: true, error: null } }))
    const turn = window.coxswain.runTurn(agentSessionId, message, commentIds)
    loadComments() // the core marks the comments sent as the turn starts
    const result = await turn
    setTurns((t) => ({ ...t, [agentSessionId]: { running: false, error: result.status === 'error' ? result.message : null } }))
    setVersion((v) => v + 1)
  }, [loadComments])
  // L3's tabs. `opened` is a whole file picked in Files, shown in the Diff tab in place of the file diffs.
  const [tab, setTab] = useState<Tab>('overview')
  const [opened, setOpened] = useState<Opened | null>(null)
  useEffect(() => {
    setTab('overview')
    setOpened(null)
  }, [currentWorkspace?.id])
  // Memoised: the Viewer rereads when its Opened changes.
  const diffs = useMemo(() => pr.changed?.map((file) => ({ kind: 'diff' as const, file })), [pr.changed])
  const open = (path: string) => {
    if (view === 'files') return setOpened({ kind: 'file', path })
    // ponytail: file diffs above it that are still loading push it down.
    document.getElementById(`diff:${path}`)?.scrollIntoView()
  }
  const showFile = view === 'files' && opened

  const attachedIds = useMemo(() => attached.map((c) => c.id), [attached])
  const attach = useCallback((c: Comment) => {
    setAttached((a) => [...a, c])
    setAgentsOpen(true) // the comment goes in L4's message box, so show it
  }, [])
  const viewerProps = (workspace: Workspace, mergeBase: string) => ({
    workspace,
    mergeBase,
    version,
    comments,
    onCommentsChanged: loadComments,
    attachedIds,
    onAttach: attach,
    viewed,
    onViewedChange: markViewed,
    turns,
    onRunTurn: runThreadTurn,
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

  // Empty shell of the main screen from docs/UX.md: L1 project and workspaces, L2 Navigator, L3 Viewer, L4 agents.
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

      <div style={{ minWidth: viewerMin }} className="flex min-w-0 flex-1 flex-col">
        <div className={`flex h-10 shrink-0 items-center gap-1 border-b pr-2 pl-8 [-webkit-app-region:drag] ${pane}`}>
          {currentWorkspace && <Tabs tab={tab} onChange={setTab} />}
        </div>
        {/* The current tab's options; outside the tab's scroll, so it stays put. */}
        {currentWorkspace && (
          <div className={`flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs ${pane}`}>
            {tab === 'diff' && (
              <BarToggle title="Show or hide the files (⌘B)" on={navigatorOpen} onClick={() => setNavigatorOpen((o) => !o)}>
                Files {pr.changed?.length ?? ''}
              </BarToggle>
            )}
            <div className="flex-1" />
            {tab !== 'overview' && (
              <button
                title="View options"
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={async () => setViewSettings(await window.coxswain.showViewMenu(viewSettings))}
              >
                <Cog />
              </button>
            )}
            <BarToggle title="Show or hide the agent (⌥⌘B)" on={agentsOpen} onClick={() => setAgentsOpen((o) => !o)}>
              Agent
            </BarToggle>
          </div>
        )}
        {!currentWorkspace ? (
          <div className={`flex flex-1 items-center justify-center ${muted}`}>No workspace. Start one with +</div>
        ) : tab === 'overview' ? (
          <Overview key={currentWorkspace.id} workspace={currentWorkspace} />
        ) : tab === 'guide' ? (
          !pr.commits || !diffs ? (
            <div className={`flex flex-1 items-center justify-center ${muted}`}>Loading…</div>
          ) : (
            <Guide
              key={currentWorkspace.id}
              workspace={currentWorkspace}
              mergeBase={pr.commits.mergeBase}
              diffs={diffs}
              viewed={viewed}
              onViewedChange={markViewed}
              showViewed={viewSettings.showViewed}
              onShowViewed={() => setViewSettings((s) => ({ ...s, showViewed: true }))}
              viewer={viewerProps(currentWorkspace, pr.commits.mergeBase)}
            />
          )
        ) : null}
        {/* The Diff tab stays mounted while hidden, so the Navigator and the file diffs keep their state. */}
        {currentWorkspace && (
          <div className={`${tab === 'diff' ? 'flex' : 'hidden'} min-h-0 flex-1`}>
            {navigatorOpen && (
              <>
                <div style={{ width: leftWidth }} className={`flex min-w-60 flex-col border-r ${pane}`}>
                  <div className="flex shrink-0 justify-end px-2 pt-1.5">
                    <ViewToggle view={view} onChange={setView} />
                  </div>
                  <Navigator key={currentWorkspace.id} workspace={currentWorkspace} pr={pr} view={view} viewed={viewed} showViewed={viewSettings.showViewed} onOpen={open} />
                </div>
                <Splitter min={240} max={720} onResize={setLeftWidth} />
              </>
            )}
            <div style={{ minWidth: viewerMin }} className="flex min-w-0 flex-1 flex-col">
              {!pr.commits || !diffs ? (
                <div className={`flex flex-1 items-center justify-center ${muted}`}>Loading…</div>
              ) : showFile ? (
                <Viewer opened={opened} {...viewerProps(currentWorkspace, pr.commits.mergeBase)} />
              ) : (
                // Only the lines on screen are drawn. ponytail: every file is still read from disk up front.
                <Virtualizer className="min-h-0 flex-1 overflow-auto">
                  {diffs.length === 0 && <div className={`p-4 text-xs ${muted}`}>No changes</div>}
                  {diffs.map((d) => (
                    <div key={d.file.path} id={`diff:${d.file.path}`}>
                      <Viewer stacked opened={d} {...viewerProps(currentWorkspace, pr.commits!.mergeBase)} />
                    </div>
                  ))}
                </Virtualizer>
              )}
            </div>
          </div>
        )}
      </div>

      {agentsOpen && <Splitter min={240} max={800} fromRight onResize={setAgentsWidth} />}
      {/* Hidden, not unmounted: a running turn keeps streaming and still reloads the diff when it ends. */}
      <div style={{ width: agentsWidth }} className={`${agentsOpen ? 'flex' : 'hidden'} min-w-60 flex-col border-l ${pane}`}>
        {currentWorkspace ? (
          <Agents
            key={currentWorkspace.id}
            workspace={currentWorkspace}
            attached={attached}
            onDetach={(id) => setAttached((a) => a.filter((c) => c.id !== id))}
            onSent={() => {
              setAttached([])
              loadComments()
            }}
            onTurnEnd={() => setVersion((v) => v + 1)}
          />
        ) : (
          <>
            <div className={`h-10 shrink-0 border-b [-webkit-app-region:drag] ${pane}`} />
            <div className={`flex flex-1 items-center justify-center ${muted}`}>No agent sessions</div>
          </>
        )}
      </div>
    </div>
  )
}

type Tab = 'overview' | 'guide' | 'diff'

// L3's tabs.
function Tabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div className="flex gap-0.5 [-webkit-app-region:no-drag]">
      {(['overview', 'guide', 'diff'] as const).map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`rounded px-2 py-0.5 text-xs capitalize ${t === tab ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

// A toggle in a tab's bar that shows or hides a pane.
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
