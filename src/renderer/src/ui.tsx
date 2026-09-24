import { useEffect, useRef } from 'react'
import type { GitProblem } from '../../core/git'
import type { GitHubProblem } from '../../core/github'

export const muted = 'text-neutral-500'
export const button =
  'rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'
export const primaryButton =
  'rounded-md bg-neutral-900 px-2.5 py-1 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300'
const code = 'rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs select-text dark:bg-neutral-800'

// Title bar of a full-window screen; Esc or Done closes it.
export function ScreenHeader({ title, onClose }: { title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-200 pr-3 pl-20 [-webkit-app-region:drag] dark:border-neutral-800">
      <span className="font-medium">{title}</span>
      <button className={`${button} [-webkit-app-region:no-drag]`} onClick={onClose}>
        Done
      </button>
    </div>
  )
}

export function ProblemMessage({ problem }: { problem: GitHubProblem | GitProblem }) {
  switch (problem.status) {
    case 'git-error':
      return <span className="select-text">Git: {problem.message}</span>
    case 'signed-out':
      return (
        <span>
          Not signed in. Run <code className={code}>gh auth login</code> in a terminal.
        </span>
      )
    case 'gh-missing':
      return (
        <span>
          The GitHub CLI isn't installed. Run <code className={code}>brew install gh</code>, then{' '}
          <code className={code}>gh auth login</code>.
        </span>
      )
    case 'error':
      return <span>Couldn't reach GitHub: {problem.message}</span>
  }
}

// Drag handle on the border between a side pane and the Viewer; resizes the side pane, which is on its left (or
// right, with `fromRight`). The Viewer never gets narrower than `viewerMin`.
export const viewerMin = 320
export function Splitter(props: { min: number; max: number; fromRight?: boolean; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; width: number; max: number } | null>(null)
  return (
    <div
      className="relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize [-webkit-app-region:no-drag]"
      onPointerDown={(e) => {
        const el = e.currentTarget
        const [pane, viewer] = props.fromRight
          ? [el.nextElementSibling, el.previousElementSibling]
          : [el.previousElementSibling, el.nextElementSibling]
        if (!pane || !viewer) return
        // Measured, not taken from state: the pane may have shrunk with the window.
        const width = pane.clientWidth
        el.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, width, max: Math.min(props.max, width + viewer.clientWidth - viewerMin) }
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        const dx = (e.clientX - s.x) * (props.fromRight ? -1 : 1)
        props.onResize(Math.max(props.min, Math.min(s.max, s.width + dx)))
      }}
      onLostPointerCapture={() => (start.current = null)}
    />
  )
}

// Hides or shows the Agents pane (L4); also View > Toggle Agents. Icons from Lucide (ISC licence).
export function AgentsToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      title={`${open ? 'Hide' : 'Show'} agents (⌥⌘B)`}
      onClick={onClick}
      className="rounded p-1 text-neutral-500 hover:bg-neutral-200 [-webkit-app-region:no-drag] dark:hover:bg-neutral-800"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M15 3v18" />
        <path d={open ? 'm8 9 3 3-3 3' : 'm10 15-3-3 3-3'} />
      </svg>
    </button>
  )
}
