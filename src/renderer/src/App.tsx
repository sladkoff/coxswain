import { Virtualizer } from '@pierre/diffs/react'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import type { Commit } from '../../core/git'
import type { NewEntry, ReviewEntry, ReviewRound } from '../../core/review'
import type { Workspace } from '../../core/workspaces'
import { Agents } from './Agents'
import { Navigator, type NavigatorView } from './Navigator'
import { NewWorkspace } from './NewWorkspace'
import { Onboarding } from './Onboarding'
import { Guide } from './Guide'
import { Overview } from './Overview'
import { Projects } from './Projects'
import { changed, core, markViewed as mark, queryClient } from './queries'
import { Round } from './Round'
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
  const [agentsWidth, setAgentsWidth] = useState(320)
  // The Navigator is on the left of the Diff tab. Both start hidden.
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const [agentsOpen, setAgentsOpen] = useState(false)
  useEffect(() => window.coxswain.onToggleNavigator(() => setNavigatorOpen((o) => !o)), [])
  useEffect(() => window.coxswain.onToggleAgents(() => setAgentsOpen((o) => !o)), [])

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

  // The entries of the workspace's current review round, as the Diff tab shows them (ADR 0015: the live diff, or the
  // commit picked), and the notes waiting in the L4 message box. A pinned guide lists its own.
  const base = commit?.parent ?? pr.commits?.mergeBase
  const entries =
    useQuery({ ...core('listEntries', currentWorkspace?.id ?? 0, base ?? '', commit?.sha), enabled: !!currentWorkspace && !!base })
      .data ?? noEntries
  const [attached, setAttached] = useState<ReviewEntry[]>([])
  const [handedOff, setHandedOff] = useState<ReviewRound | null>(null) // a wrapped-up round in L4's message box
  // Callbacks handed to the Viewers are stable (useCallback), so a memoised Viewer doesn't redraw its file diff.
  useEffect(() => {
    setAttached([])
    setHandedOff(null)
  }, [currentWorkspace?.id])
  // A deleted note leaves the message box too.
  useEffect(() => setAttached((a) => a.filter((c) => entries.some((k) => k.id === c.id))), [entries])
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
  // entries; once the turn ends it's an answer entry.
  const [turns, setTurns] = useState<Record<number, Turn>>({})
  useEffect(() => {
    const offChat = window.coxswain.onQuestionChat((id, c) =>
      setTurns((t) => ({ ...t, [id]: { running: true, error: null, live: [...(t[id]?.live ?? []), c] } })),
    )
    // The answer entry comes with the core's change event, just before this.
    const offEnd = window.coxswain.onQuestionEnd((id, result) =>
      setTurns((t) => ({ ...t, [id]: { running: false, error: result.status === 'error' ? result.message : null, live: [] } })),
    )
    return () => {
      offChat()
      offEnd()
    }
  }, [])
  const ask = useCallback(async (q: NewEntry) => {
    const question = await window.coxswain.askQuestion(q)
    const id = question.parentId ?? question.id
    setTurns((t) => ({ ...t, [id]: { running: true, error: null, live: t[id]?.live ?? [] } }))
    changed({ workspaceId: q.workspaceId, what: 'entries' })
  }, [])
  // L3's tabs. `opened` is a whole file picked in Files, shown in the Diff tab in place of the file diffs.
  const [tab, setTab] = useState<Tab>('overview')
  const [opened, setOpened] = useState<Opened | null>(null)
  useEffect(() => {
    setTab('overview')
    setOpened(null)
  }, [currentWorkspace?.id])
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

  const attachedIds = useMemo(() => attached.map((c) => c.id), [attached])
  const attach = useCallback((c: ReviewEntry) => {
    setAttached((a) => [...a, c])
    setAgentsOpen(true) // the note goes in L4's message box, so show it
  }, [])
  const viewerProps = (workspace: Workspace, mergeBase: string, head?: string) => ({
    workspace,
    mergeBase,
    head,
    entries,
    attachedIds,
    onAttach: attach,
    viewed,
    onViewedChange: markViewed,
    turns,
    onAsk: ask,
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
                Files {diffPr.changed?.length ?? ''}
              </BarToggle>
            )}
            {tab === 'diff' && (
              <button
                title="Show all changes or one commit's"
                disabled={!pr.commits}
                className={`max-w-80 truncate rounded px-2 py-0.5 ${commit ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                onClick={pickCommit}
              >
                {commit ? `${commit.sha.slice(0, 7)} ${commit.subject}` : 'Commits'}
              </button>
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
              prHead={pr.commits.head}
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
        {/* Its own key: a sibling of the Guide, and a key shared with it left old Guides behind on a tab switch. */}
        {currentWorkspace && tab !== 'overview' && <Round
            key={`round-${currentWorkspace.id}`}
            workspace={currentWorkspace}
            entries={entries}
            handedOff={handedOff?.id === entries[0]?.reviewRoundId}
            onHandOff={(r) => {
              setHandedOff(r)
              setAgentsOpen(true)
            }}
          />}
      </div>

      {agentsOpen && <Splitter min={240} max={800} fromRight onResize={setAgentsWidth} />}
      {/* Hidden, not unmounted: a running turn keeps streaming. */}
      <div style={{ width: agentsWidth }} className={`${agentsOpen ? 'flex' : 'hidden'} min-w-60 flex-col border-l ${pane}`}>
        {currentWorkspace ? (
          <Agents
            key={currentWorkspace.id}
            workspace={currentWorkspace}
            attached={attached}
            handedOff={handedOff}
            onDetach={(id) => setAttached((a) => a.filter((c) => c.id !== id))}
            onDetachRound={() => setHandedOff(null)}
            onSent={() => {
              setAttached([])
              setHandedOff(null)
            }}
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
