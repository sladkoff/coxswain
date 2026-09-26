import { Virtualizer } from '@pierre/diffs/react'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangedFile, Commit } from '../../core/git'
import type { GuideGroup } from '../../core/guides'
import type { NewEntry, ReviewEntry } from '../../core/review'
import type { Workspace } from '../../core/workspaces'
import { Agents } from './Agents'
import { Commits } from './Commits'
import { GuideToc } from './GuideToc'
import { Navigator, type NavigatorView } from './Navigator'
import { NewWorkspace } from './NewWorkspace'
import { Onboarding } from './Onboarding'
import { Projects } from './Projects'
import { changed, core, markViewed as mark, queryClient } from './queries'
import { Settings } from './Settings'
import { usePullRequest } from './usePullRequest'
import type { ViewSettings } from '../../preload'
import { Cog, Prose, Splitter, viewerMin } from './ui'
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
  // The pane on the left of the canvas: the Navigator (files) or the commits. Starts hidden.
  const [leftPane, setLeftPane] = useState<'files' | 'commits' | null>(null)
  const toggleLeftPane = (p: 'files' | 'commits') => setLeftPane((o) => (o === p ? null : p))
  useEffect(() => window.coxswain.onToggleNavigator(() => toggleLeftPane('files')), [])

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
  // The Commits menu: one commit's diff (its parent to it) in place of all changes.
  const [commit, setCommit] = useState<Commit | null>(null)
  useEffect(() => setCommit(null), [currentWorkspace?.id, pr.commits])
  // The guide shown over Changes (ADR 0023), or none. The newest shows when it appears, and on opening a workspace if
  // it isn't stale. A guide and a commit are both a pinned range, so picking one drops the other.
  const guides = useQuery({ ...core('listGuides', currentWorkspace?.id ?? 0), enabled: !!currentWorkspace }).data
  const [guideId, setGuideId] = useState<number | null>(null)
  const newest = useRef<{ workspaceId: number; id: number } | null>(null)
  useEffect(() => {
    if (!currentWorkspace || !guides || !pr.commits) return
    const latest = guides[0]
    if (newest.current?.workspaceId !== currentWorkspace.id) setGuideId(latest?.head === pr.commits.head ? latest.id : null)
    else if (latest && latest.id !== newest.current.id) {
      setGuideId(latest.id)
      setCommit(null)
    }
    newest.current = { workspaceId: currentWorkspace.id, id: latest?.id ?? 0 }
  }, [currentWorkspace?.id, guides, pr.commits])
  const guide = (guideId !== null && guides?.find((g) => g.id === guideId)) || null
  const range = commit ? { base: commit.parent, head: commit.sha } : guide ? { base: guide.base, head: guide.head } : null

  // The workspace's entries, as the canvas shows them (ADR 0015: the live diff, or the range picked). An explanation or
  // finding shows only with its guide.
  const base = range?.base ?? pr.commits?.mergeBase
  const allEntries = useQuery({
    ...core('listEntries', currentWorkspace?.id ?? 0, base ?? '', range?.head),
    enabled: !!currentWorkspace && !!base,
  }).data
  const entries = useMemo(
    () => allEntries?.filter((e) => !e.guideId || e.guideId === guide?.id) ?? noEntries,
    [allEntries, guide?.id],
  )
  // Callbacks handed to the Viewers are stable (useCallback), so a memoised Viewer doesn't redraw its file diff.
  // Paths of the viewed file diffs: the live diff's, reloaded with the changes, since a file diff that changed is no
  // longer viewed (ADR 0014); or at a guide's head, where they stay as they were.
  const mergeBase = pr.commits?.mergeBase
  const viewedBase = guide?.base ?? mergeBase
  const viewed =
    useQuery({
      ...core('listViewed', currentWorkspace?.id ?? 0, viewedBase ?? '', guide?.head),
      enabled: !!currentWorkspace && !!viewedBase && !!pr.changed,
    }).data ?? noPaths
  const markViewed = useCallback(
    (path: string, on: boolean) => void (currentWorkspace && viewedBase && mark(currentWorkspace.id, viewedBase, path, on, guide?.head)),
    [currentWorkspace?.id, viewedBase, guide?.head],
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
  const rangeList = useQuery({
    ...core('listChangedFiles', currentWorkspace?.id ?? 0, range?.base ?? '', range?.head),
    enabled: !!currentWorkspace && !!range,
  }).data
  // ponytail: a git error shows as no changes; show it like the Navigator's problems if it happens.
  const rangeChanged = useMemo(() => (rangeList ? (rangeList.status === 'ok' ? rangeList.files : []) : null), [rangeList])
  const diffPr = range ? { ...pr, changed: rangeChanged } : pr
  const diffDiffs = useMemo(
    () => (range ? rangeChanged?.map((file) => ({ kind: 'diff' as const, file })) : diffs),
    [!!range, rangeChanged, diffs],
  )
  // Viewed file diffs are hidden unless Show Viewed Files is on, as in the Navigator.
  const isShown = (d: { file: ChangedFile }) => viewSettings.showViewed || !viewed.includes(d.file.path)
  const shownDiffs = useMemo(() => diffDiffs?.filter(isShown), [diffDiffs, viewed, viewSettings.showViewed])
  // With a guide, its groups in reading order: the groups as added, the files in none, then the generated groups.
  // Groups whose file diffs are all viewed stay listed (the table of contents shows them); the canvas skips them.
  const sections = useMemo(() => {
    if (!guide || !diffDiffs) return null
    const byPath = new Map(diffDiffs.map((d) => [d.file.path, d]))
    const listed = new Set(guide.groups.flatMap((g) => g.paths))
    const section = (group: GuideGroup | null, ds: typeof diffDiffs) => ({ group, diffs: ds, shown: ds.filter(isShown) })
    const of = (g: GuideGroup) => section(g, g.paths.flatMap((p) => byPath.get(p) ?? []))
    const generated = (g: GuideGroup) => g.tags.includes('generated')
    return [
      ...guide.groups.filter((g) => !generated(g)).map(of),
      section(null, diffDiffs.filter((d) => !listed.has(d.file.path))),
      ...guide.groups.filter(generated).map(of),
    ].filter((x) => x.diffs.length)
  }, [guide, diffDiffs, viewed, viewSettings.showViewed])
  // The table of contents: the group at the top of the canvas's scroll, and a group picked while it was hidden (all
  // its file diffs viewed), scrolled to once Show Viewed Files has shown it.
  const [currentGroup, setCurrentGroup] = useState(0)
  const [pendingGroup, setPendingGroup] = useState<number | null>(null)
  const scrollToGroup = (i: number) => document.getElementById(`guide-group-${i}`)?.scrollIntoView()
  useEffect(() => {
    if (pendingGroup === null) return
    scrollToGroup(pendingGroup)
    setPendingGroup(null)
  }, [pendingGroup, viewSettings.showViewed])
  const pickGroup = (i: number) => {
    if (sections?.[i]?.shown.length) return scrollToGroup(i)
    setViewSettings((v) => ({ ...v, showViewed: true }))
    setPendingGroup(i)
  }
  // The last group whose top has scrolled past the top of the canvas (with a little slack) is the current one. Only
  // the canvas's own scroll: file diffs also scroll sideways inside it.
  const onCanvasScroll = (e: UIEvent<HTMLDivElement>) => {
    const scroller = e.target as HTMLElement
    if (!sections || scroller.parentElement !== e.currentTarget) return
    const top = scroller.getBoundingClientRect().top + 40
    const passed = sections.flatMap((_, i) => {
      const el = document.getElementById(`guide-group-${i}`)
      return el && el.getBoundingClientRect().top <= top ? [i] : []
    })
    setCurrentGroup(passed.at(-1) ?? sections.findIndex((x) => x.shown.length))
  }
  const [guideError, setGuideError] = useState<string | null>(null)
  const pickGuide = async () => {
    if (!currentWorkspace || !pr.commits) return
    const picked = await window.coxswain.showGuideMenu(currentWorkspace.id, guide?.id ?? null, pr.commits.head)
    if ('show' in picked) {
      setGuideId(picked.show)
      setCommit(null)
      setOpened(null)
      return
    }
    // The agent makes it in the agent pane's session; the guide shows as soon as it starts it.
    setGuideError(null)
    const result = await window.coxswain.requestGuide(currentWorkspace.id, picked.make)
    if (result.status === 'error') setGuideError(result.message)
  }
  const pickCommit = (picked: Commit | null) => {
    setCommit(picked)
    setGuideId(null)
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
    if (root.guideId) setGuideId(root.guideId)
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
        {/* The canvas's bar: the diffs' options. It also drags the window, so it lines up with the agent pane's.
            ponytail: no tabs row until the canvas shows a second thing. */}
        <div className={`flex h-10 shrink-0 items-center gap-1 border-b px-2 text-xs [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag] ${pane}`}>
          {currentWorkspace && (
            <div className="flex flex-1 items-center gap-1">
              <BarToggle title="Show or hide the files (⌘B)" on={leftPane === 'files'} onClick={() => toggleLeftPane('files')}>
                Files {diffPr.changed?.length ?? ''}
              </BarToggle>
              <button
                title="Show or hide the commits, to see one commit's changes"
                disabled={!pr.commits}
                className={`max-w-80 truncate rounded px-2 py-0.5 ${leftPane === 'commits' || commit ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                onClick={() => toggleLeftPane('commits')}
              >
                {commit ? `${commit.sha.slice(0, 7)} ${commit.subject}` : 'Commits'}
              </button>
              <button
                title="Make a guide, or pick the guide to show"
                disabled={!pr.commits}
                className={`rounded px-2 py-0.5 ${guide ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                onClick={pickGuide}
              >
                {guide ? `Guide · ${new Date(guide.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : 'Guide'}
              </button>
              {guideError && <span className="truncate text-red-600 dark:text-red-400">{guideError}</span>}
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
            {leftPane && (
              <>
                <div style={{ width: leftWidth }} className={`flex min-w-60 flex-col border-r ${pane}`}>
                  {leftPane === 'commits' ? (
                    pr.commits && (
                      <Commits workspaceId={currentWorkspace.id} mergeBase={pr.commits.mergeBase} current={commit} onPick={pickCommit} />
                    )
                  ) : (
                    <>
                      <div className="flex shrink-0 justify-end px-2 pt-1.5">
                        <ViewToggle view={view} onChange={setView} />
                      </div>
                      <Navigator key={currentWorkspace.id} workspace={currentWorkspace} pr={diffPr} view={view} viewed={viewed} showViewed={viewSettings.showViewed} entries={entries} onOpen={open} />
                    </>
                  )}
                </div>
                <Splitter min={240} max={720} onResize={setLeftWidth} />
              </>
            )}
            {sections && !showFile && (
              <GuideToc sections={sections} viewed={viewed} entries={entries} current={currentGroup} onPick={pickGroup} />
            )}
            <div style={{ minWidth: viewerMin }} className="flex min-w-0 flex-1 flex-col" onScrollCapture={onCanvasScroll}>
              {!pr.commits || !diffDiffs || !shownDiffs ? (
                <div className={`flex flex-1 items-center justify-center ${muted}`}>Loading…</div>
              ) : showFile ? (
                <Viewer opened={opened} {...viewerProps(currentWorkspace, pr.commits.mergeBase)} />
              ) : (
                // Only the lines on screen are drawn. ponytail: every file is still read from disk up front.
                <Virtualizer className="min-h-0 flex-1 overflow-auto">
                  {shownDiffs.length === 0 && (
                    <div className={`p-4 text-xs ${muted}`}>
                      {diffDiffs.length ? (
                        <>
                          All {diffDiffs.length} files viewed.{' '}
                          <button className="underline" onClick={() => setViewSettings((s) => ({ ...s, showViewed: true }))}>
                            Show them
                          </button>
                        </>
                      ) : (
                        'No changes'
                      )}
                    </div>
                  )}
                  {/* Stale (ADR 0023): the PR moved on since the guide was made. The guide stays as it was. */}
                  {guide && guide.head !== pr.commits.head && (
                    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs dark:border-amber-900 dark:bg-amber-950">
                      The PR has new commits since this guide. It still shows the PR as it was.
                    </div>
                  )}
                  {(sections ?? [{ group: undefined, diffs: diffDiffs, shown: shownDiffs }]).map((x, i) => x.shown.length > 0 && (
                    <section key={i} id={`guide-group-${i}`} className={x.group?.tags.includes('generated') ? 'opacity-60' : ''}>
                      {x.group !== undefined && <GroupHeader group={x.group} files={x.diffs.length} viewed={x.diffs.length - x.shown.length} />}
                      {x.shown.map((d) => (
                        <div key={d.file.path} id={`diff:${d.file.path}`}>
                          {x.group?.notes[d.file.path] && (
                            <div className={`px-4 pt-3 pb-2 select-text ${prose}`}>
                              <Prose>{x.group.notes[d.file.path]}</Prose>
                            </div>
                          )}
                          <Viewer stacked opened={d} {...viewerProps(currentWorkspace, range?.base ?? pr.commits!.mergeBase, range?.head)} />
                        </div>
                      ))}
                    </section>
                  ))}
                </Virtualizer>
              )}
            </div>
          </div>
        )}
        {currentWorkspace && diffPr.changed && (
          <StatusBar
            workspaceId={currentWorkspace.id}
            entries={entries}
            files={diffPr.changed}
            viewed={viewed}
            turns={turns}
            onViewThread={viewThread}
          />
        )}
      </div>
    </div>
  )
}

// A group's description and its file notes: readable text, at a line length that's easy to follow.
const prose = 'markdown max-w-[80ch] text-[13px] leading-relaxed text-neutral-700 [overflow-wrap:anywhere] dark:text-neutral-300'

// Above a guide group's file diffs: its title, how many files, and its description. group null: the files in no group.
function GroupHeader(props: { group: GuideGroup | null; files: number; viewed: number }) {
  const g = props.group
  return (
    <div className="flex flex-col gap-1.5 px-4 pt-6 pb-3 select-text">
      <h2 className="text-base font-semibold">{g ? <Prose inline>{g.title}</Prose> : 'Not in the guide'}</h2>
      <div className={muted}>
        {g?.tags.includes('generated') && 'Generated · '}
        {count(props.files, 'file')}
        {props.viewed > 0 && `, ${props.viewed} viewed`}
      </div>
      {g?.description && (
        <div className={prose}>
          <Prose>{g.description}</Prose>
        </div>
      )}
    </div>
  )
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// The canvas's bottom bar: the review at a glance. Threads, with how many are outdated or waiting on the agent, how
// many of the file diffs on screen are viewed, and their lines. The thread count opens every thread above the bar.
type StatusBarProps = {
  workspaceId: number
  entries: ReviewEntry[]
  files: ChangedFile[]
  viewed: string[]
  turns: Record<number, Turn>
  onViewThread: (threadId: number) => void
}

function StatusBar(props: StatusBarProps) {
  const [open, setOpen] = useState(false)
  // Sending every thread to the agent pane's session; the agent's reply shows there.
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sendAll = async () => {
    setSending(true)
    setError(null)
    const result = await window.coxswain.sendReview(props.workspaceId)
    setSending(false)
    if (result.status === 'error') setError(result.message)
  }
  const threads = props.entries.filter((e) => e.path && !e.parentId)
  const outdated = threads.filter((e) => e.state === 'outdated').length
  const answering = threads.filter((e) => props.turns[e.id]?.running).length
  const viewed = props.files.filter((f) => props.viewed.includes(f.path)).length
  const add = props.files.reduce((n, f) => n + f.additions, 0)
  const del = props.files.reduce((n, f) => n + f.deletions, 0)
  const parts = [
    count(threads.length, 'thread') + (outdated ? ` (${outdated} outdated)` : ''),
    answering ? `${answering} waiting on the agent` : '',
  ].filter(Boolean)
  return (
    <div className={`flex max-h-[50%] shrink-0 flex-col border-t text-xs ${pane}`}>
      {open && (
        <div className={`flex min-h-0 flex-col overflow-y-auto border-b py-1 ${pane}`}>
          {threads.length === 0 && <div className={`px-2 py-1 ${muted}`}>No threads yet. Click a line's gutter to start one.</div>}
          {threads.map((t) => (
            <ThreadRow
              key={t.id}
              root={t}
              replies={props.entries.filter((e) => e.parentId === t.id)}
              answering={!!props.turns[t.id]?.running}
              onClick={() => props.onViewThread(t.id)}
            />
          ))}
        </div>
      )}
      <div className={`flex h-8 shrink-0 items-center gap-3 px-2 ${muted}`}>
        <button
          title={open ? 'Hide the threads' : 'Show all threads'}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          onClick={() => setOpen((o) => !o)}
        >
          <span>{open ? '▾' : '▴'}</span>
          <span className="truncate">{parts.join(' · ')}</span>
        </button>
        <button
          title="Send every thread to the agent in one message"
          className="rounded px-1.5 py-0.5 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          disabled={!threads.length || sending}
          onClick={sendAll}
        >
          {sending ? 'Agent working…' : 'Send all to agent'}
        </button>
        {error && <span className="truncate text-red-600 dark:text-red-400">{error}</span>}
        <div className="flex-1" />
        <span className="tabular-nums">
          <span className="text-green-600">+{add}</span> <span className="text-red-600">−{del}</span>
        </span>
        <div className="flex items-center gap-1.5 tabular-nums">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full bg-green-600" style={{ width: `${props.files.length ? (viewed / props.files.length) * 100 : 0}%` }} />
          </div>
          {viewed} of {count(props.files.length, 'file')} viewed
        </div>
      </div>
    </div>
  )
}

// One thread in the bar's list: where it is, its first comment, and how far it got. A click shows it on the canvas.
function ThreadRow(props: { root: ReviewEntry; replies: ReviewEntry[]; answering: boolean; onClick: () => void }) {
  const { root: t, replies } = props
  const lines = t.startLine === t.endLine ? `${t.startLine}` : `${t.startLine}–${t.endLine}`
  const answers = replies.filter((r) => r.kind === 'answer').length
  const status = [
    t.state === 'outdated' && 'outdated',
    props.answering ? 'agent answering…' : answers ? count(answers, 'answer') : t.kind === 'question' && 'sent to agent',
    replies.length - answers > 0 && count(replies.length - answers, 'reply'),
  ].filter(Boolean)
  return (
    <button onClick={props.onClick} className="flex items-baseline gap-2 px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
      <span className={`shrink-0 font-mono ${muted}`}>
        {t.path!.split('/').at(-1)}:{lines}
      </span>
      <span className="min-w-0 flex-1 truncate">{t.body}</span>
      <span className={`shrink-0 ${muted}`}>{status.join(' · ')}</span>
    </button>
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
