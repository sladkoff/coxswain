// Empty shell of the main screen from docs/UX.md: L0 project menu, L1 sessions, L2 diff, L3 main area, L4 agents.
const pane = 'border-neutral-200 dark:border-neutral-800'
const muted = 'text-xs text-neutral-500'

export function App() {
  return (
    <div className="flex h-full select-none text-sm">
      <div className={`flex w-72 shrink-0 flex-col border-r ${pane}`}>
        {/* pl-20 clears the macOS window buttons; the bar drags the window. */}
        <div className={`flex h-10 items-center border-b pl-20 font-medium [-webkit-app-region:drag] ${pane}`}>
          ▾ Project
        </div>
        <div className="flex min-h-0 flex-1">
          <div className={`flex w-12 flex-col items-center gap-2 border-r py-2 ${pane}`}>
            <div className="size-7 rounded-md bg-neutral-300 dark:bg-neutral-700" />
            <div className={muted}>+</div>
          </div>
          <div className={`flex-1 p-2 ${muted}`}>No changed files</div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`h-10 shrink-0 border-b [-webkit-app-region:drag] ${pane}`} />
        <div className={`flex flex-1 items-center justify-center ${muted}`}>Nothing open</div>
      </div>

      <div className={`flex w-80 shrink-0 flex-col border-l ${pane}`}>
        <div className={`h-10 shrink-0 border-b [-webkit-app-region:drag] ${pane}`} />
        <div className={`flex flex-1 items-center justify-center ${muted}`}>No agent sessions</div>
      </div>
    </div>
  )
}
