import { useEffect, useState } from 'react'
import type { GitHubProblem, PullRequest } from '../../core/github'
import type { Project } from '../../core/projects'
import { button, ProblemMessage, muted, ScreenHeader } from './ui'

type Props = {
  project: Project
  openPrNumbers: number[] // PRs that already have a workspace
  onSelect: (prNumber: number) => void
  onClose: () => void
}

const row = 'block w-full rounded-md px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800'

export function NewWorkspace({ project, openPrNumbers, onSelect, onClose }: Props) {
  const [pulls, setPulls] = useState<PullRequest[] | null>(null)
  const [problem, setProblem] = useState<GitHubProblem | null>(null)
  const [query, setQuery] = useState('')

  const load = async () => {
    setProblem(null)
    const result = await window.coxswain.listPullRequests(project.owner, project.name)
    if (result.status !== 'ok') return setProblem(result)
    setPulls(result.pulls)
  }
  useEffect(() => void load(), [])

  const q = query.trim().toLowerCase()
  const shown = (pulls ?? []).filter(
    (p) => !q || `#${p.number} ${p.title} ${p.author} ${p.headRef}`.toLowerCase().includes(q),
  )

  return (
    <div className="flex h-full flex-col select-none text-sm">
      <ScreenHeader title={`New workspace in ${project.owner}/${project.name}`} onClose={onClose} />

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col p-6">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search open pull requests"
          className="mb-3 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700"
        />

        {problem && (
          <div className="flex items-center gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <ProblemMessage problem={problem} />
            <button className={`${button} ml-auto shrink-0`} onClick={load}>
              Try again
            </button>
          </div>
        )}

        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {shown.map((p) => (
            <button key={p.number} className={row} onClick={() => onSelect(p.number)}>
              <div className="flex items-center gap-2">
                <span className={muted}>#{p.number}</span>
                <span className="truncate font-medium">{p.title}</span>
                {p.draft && <span className={`text-xs ${muted}`}>Draft</span>}
                {openPrNumbers.includes(p.number) && <span className={`text-xs ${muted}`}>Open</span>}
                <span className={`ml-auto shrink-0 text-xs ${muted}`}>{new Date(p.updatedAt).toLocaleDateString()}</span>
              </div>
              <div className={`truncate ${muted}`}>
                {p.author} · {p.headRef}
              </div>
            </button>
          ))}
          {!problem && (
            <div className={`py-3 text-center ${muted}`}>
              {!pulls ? 'Loading…' : pulls.length === 0 ? 'No open pull requests' : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
