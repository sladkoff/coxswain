import { useQuery } from '@tanstack/react-query'
import type { Commit } from '../../core/git'
import { core } from './queries'
import { cn, muted, selectable } from './components/styles'
import { ProblemMessage } from './components/text'

type Props = {
  workspaceId: number
  mergeBase: string
  current: Commit | null // null: all changes
  onPick: (commit: Commit | null) => void
}

// The Commits pane, left of the canvas: All Changes, then the PR's commits, newest first. Picking one shows its diff.
export function Commits({ workspaceId, mergeBase, current, onPick }: Props) {
  const listed = useQuery(core('listCommits', workspaceId, mergeBase)).data
  const row = (on: boolean) => cn('flex gap-2 rounded px-2 py-1 text-left', selectable(on))
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 text-xs">
      <button className={row(current === null)} onClick={() => onPick(null)}>
        All Changes
      </button>
      {!listed ? (
        <div className={cn('px-2 py-1', muted)}>Loading…</div>
      ) : listed.status !== 'ok' ? (
        <div className={cn('px-2 py-1', muted)}>
          <ProblemMessage problem={listed} />
        </div>
      ) : (
        listed.commits.map((c) => (
          <button key={c.sha} title={c.subject} className={row(c.sha === current?.sha)} onClick={() => onPick(c)}>
            <span className={cn('shrink-0 font-mono', muted)}>{c.sha.slice(0, 7)}</span>
            <span className="truncate">{c.subject}</span>
          </button>
        ))
      )}
    </nav>
  )
}
