import { useEffect, useState } from 'react'
import type { Project } from '../../core/projects'
import type { Workspace } from '../../core/workspaces'
import { Navigator, type NavigatorView } from './Navigator'
import { NewWorkspace } from './NewWorkspace'
import { Onboarding } from './Onboarding'
import { Projects } from './Projects'
import { Settings } from './Settings'
import { usePullRequest } from './usePullRequest'
import { type Opened, Viewer } from './Viewer'

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

  const [view, setView] = useState<NavigatorView>('diffs')
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

  const pr = usePullRequest(current, currentWorkspace)
  const [opened, setOpened] = useState<Opened | null>(null)
  useEffect(() => setOpened(null), [currentWorkspace?.id])
  const open = (path: string) => {
    const file = pr.changed?.find((f) => f.path === path)
    setOpened(view === 'diffs' && file ? { kind: 'diff', file } : { kind: 'file', path })
  }

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
    <div className="flex h-full select-none text-sm">
      <div className={`flex w-[26rem] shrink-0 flex-col border-r ${pane}`}>
        {/* Leaves room for the macOS window buttons; the bar drags the window. */}
        <div className={`flex h-10 shrink-0 items-center justify-end border-b px-2 [-webkit-app-region:drag] ${pane}`}>
          {currentWorkspace && <ViewToggle view={view} onChange={setView} />}
        </div>
        <div className="flex min-h-0 flex-1">
          <div className={`flex w-12 flex-col items-center gap-2 border-r py-2 ${pane}`}>
            {/* The current project, like a Discord server icon. Opens the list to switch or add projects. */}
            <button
              title={`${current.owner}/${current.name}: switch or add project`}
              onClick={() => setScreen('projects')}
              className="flex size-7 items-center justify-center rounded-md bg-neutral-800 text-xs font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900"
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
          <div className="flex min-w-0 flex-1 flex-col">
            {currentWorkspace ? (
              <Navigator key={currentWorkspace.id} project={current} pr={pr} view={view} onOpen={open} />
            ) : (
              <div className={`p-2 ${muted}`}>No workspace</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`h-10 shrink-0 border-b [-webkit-app-region:drag] ${pane}`} />
        {opened && pr.commits ? (
          <Viewer project={current} commits={pr.commits} opened={opened} />
        ) : (
          <div className={`flex flex-1 items-center justify-center ${muted}`}>
            {currentWorkspace ? 'Select a file' : 'No workspace. Start one with +'}
          </div>
        )}
      </div>

      <div className={`flex w-80 shrink-0 flex-col border-l ${pane}`}>
        <div className={`h-10 shrink-0 border-b [-webkit-app-region:drag] ${pane}`} />
        <div className={`flex flex-1 items-center justify-center ${muted}`}>No agent sessions</div>
      </div>
    </div>
  )
}

function ViewToggle({ view, onChange }: { view: NavigatorView; onChange: (view: NavigatorView) => void }) {
  return (
    <div className="flex rounded-md bg-neutral-100 p-0.5 text-xs [-webkit-app-region:no-drag] dark:bg-neutral-800">
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
