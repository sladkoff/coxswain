import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { PullRequest } from '../../core/github'
import type { Project } from '../../core/projects'
import { Input } from './components/field'
import { ListRow, ProblemCard, Screen } from './components/layout'
import { cn, muted } from './components/styles'
import { core } from './queries'

type Props = {
  project: Project
  openPrNumbers: number[] // PRs that already have a workspace
  onSelect: (prNumber: number) => void
  onClose: () => void
}

export function NewWorkspace({ project, openPrNumbers, onSelect, onClose }: Props) {
  const result = useQuery(core('listPullRequests', project.owner, project.name))
  const pulls = result.data?.status === 'ok' ? result.data.pulls : null
  const problem = result.data && result.data.status !== 'ok' ? result.data : null
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const shown = (pulls ?? []).filter(
    (p) => !q || `#${p.number} ${p.title} ${p.author} ${p.headRef}`.toLowerCase().includes(q),
  )

  return (
    <Screen title={`New workspace in ${project.owner}/${project.name}`} onClose={onClose} className="max-w-2xl">
      <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search open pull requests" className="mb-3" />

      {problem && <ProblemCard problem={problem} onRetry={() => result.refetch()} />}

      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {shown.map((p) => (
          <PullRequestRow key={p.number} pull={p} open={openPrNumbers.includes(p.number)} onClick={() => onSelect(p.number)} />
        ))}
        {!problem && (
          <div className={cn('py-3 text-center', muted)}>
            {!pulls ? 'Loading…' : pulls.length === 0 ? 'No open pull requests' : null}
          </div>
        )}
      </div>
    </Screen>
  )
}

// An open PR to start a workspace on; open: it already has one.
function PullRequestRow({ pull: p, open, onClick }: { pull: PullRequest; open: boolean; onClick: () => void }) {
  return (
    <ListRow onClick={onClick}>
      <div className="flex items-center gap-2">
        <span className={muted}>#{p.number}</span>
        <span className="truncate font-medium">{p.title}</span>
        {p.draft && <span className={cn('text-xs', muted)}>Draft</span>}
        {open && <span className={cn('text-xs', muted)}>Open</span>}
        <span className={cn('ml-auto shrink-0 text-xs', muted)}>{new Date(p.updatedAt).toLocaleDateString()}</span>
      </div>
      <div className={cn('truncate', muted)}>
        {p.author} · {p.headRef}
      </div>
    </ListRow>
  )
}
