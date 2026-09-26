import type { Project } from '../../core/projects'
import type { Workspace } from '../../core/workspaces'
import { cn, divider, titleBar } from './components/styles'

type Props = {
  project: Project
  cloning: boolean
  workspaces: Workspace[]
  current: Workspace | undefined
  onProjects: () => void
  onSelect: (prNumber: number) => void
  onNew: () => void
}

// L1, the sidebar: the current project, then its workspaces, then + for a new one.
export function WorkspaceRail({ project, cloning, workspaces, current, onProjects, onSelect, onNew }: Props) {
  return (
    <div className={cn('flex flex-col', divider)}>
      {/* The bar drags the window; the macOS window buttons reach past it into L3's, so the border starts below it. */}
      <div className={cn(titleBar, 'border-b', divider)} />
      <div className={cn('flex min-h-0 flex-1 border-r', divider)}>
        <div className="flex w-12 flex-col items-center gap-2 py-2">
          {/* The current project, like a Discord server icon. Opens the list to switch or add projects. */}
          <button
            title={`${project.owner}/${project.name}${cloning ? ' (cloning…)' : ''}: switch or add project`}
            onClick={onProjects}
            className={cn(
              cloning && 'animate-pulse',
              'flex size-7 items-center justify-center rounded-md bg-neutral-800 text-xs font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900',
            )}
          >
            {project.name[0].toUpperCase()}
          </button>
          <div className="h-px w-5 bg-neutral-200 dark:bg-neutral-800" />
          {workspaces.map((w) => (
            <WorkspaceButton key={w.id} workspace={w} selected={w.id === current?.id} onClick={() => onSelect(w.prNumber)} />
          ))}
          <button
            title="New workspace"
            onClick={onNew}
            className="flex size-7 items-center justify-center rounded-md text-base text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

// A workspace by its PR number; the pill on the left marks the current one.
function WorkspaceButton({ workspace: w, selected, onClick }: { workspace: Workspace; selected: boolean; onClick: () => void }) {
  return (
    <div className="relative flex w-full justify-center">
      {selected && <span className="absolute top-1 left-0 h-5 w-1 rounded-r bg-neutral-900 dark:bg-neutral-100" />}
      <button
        title={`PR #${w.prNumber}`}
        onClick={onClick}
        className={cn(
          'flex h-7 w-10 items-center justify-center rounded-md text-[10px] font-medium',
          selected
            ? 'bg-neutral-300 text-neutral-900 dark:bg-neutral-600 dark:text-white'
            : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800/60 dark:hover:bg-neutral-800',
        )}
      >
        #{w.prNumber}
      </button>
    </div>
  )
}
