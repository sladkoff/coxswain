import { useEffect } from 'react'
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
