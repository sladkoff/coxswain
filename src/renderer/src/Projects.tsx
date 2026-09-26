import { useEffect, useState } from 'react'
import type { GitHubProblem, Repo } from '../../core/github'
import type { Project } from '../../core/projects'
import { Button } from './components/button'
import { Input } from './components/field'
import { ListRow, ProblemCard, Screen } from './components/layout'
import { cn, muted } from './components/styles'

type Props = {
  projects: Project[]
  current: Project | undefined
  onSelect: (fullName: string) => void
  onClose: () => void
}

const heading = cn('mt-4 mb-1 px-2 text-xs font-medium', muted)

export function Projects({ projects, current, onSelect, onClose }: Props) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [page, setPage] = useState(0) // last page loaded
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<GitHubProblem | null>(null)
  const [query, setQuery] = useState('')

  const loadMore = async () => {
    setLoading(true)
    const result = await window.coxswain.listRepos(page + 1)
    setLoading(false)
    if (result.status !== 'ok') return setProblem(result)
    setProblem(null)
    setRepos((r) => [...r, ...result.repos])
    setPage(page + 1)
    setHasMore(result.hasMore)
  }
  useEffect(() => void loadMore(), [])

  // ponytail: search filters the pages loaded so far; switch to GitHub's search API if people miss old repos.
  const q = query.trim().toLowerCase()
  const shownProjects = projects.filter((p) => `${p.owner}/${p.name}`.toLowerCase().includes(q))
  const shownRepos = q
    ? repos.filter((r) => r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
    : repos

  return (
    <Screen title="Projects" onClose={onClose} className="max-w-2xl">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search projects and GitHub repositories"
        className="mb-3"
      />

      {problem && <ProblemCard problem={problem} onRetry={loadMore} />}

      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {shownProjects.length > 0 && (
          <>
            <div className={heading}>Your projects</div>
            {shownProjects.map((p) => (
              <ListRow key={p.id} onClick={() => onSelect(`${p.owner}/${p.name}`)}>
                <span className="font-medium">
                  {p.owner}/{p.name}
                </span>
                {p.id === current?.id && <span className={cn('ml-2 text-xs', muted)}>Current</span>}
              </ListRow>
            ))}
          </>
        )}

        <div className={heading}>GitHub repositories</div>
        {shownRepos.map((r) => (
          <RepoRow key={r.id} repo={r} onClick={() => onSelect(r.fullName)} />
        ))}
        {!problem && (
          <div className={cn('py-3 text-center', muted)}>
            {loading ? 'Loading…' : hasMore ? <Button onClick={loadMore}>Load more</Button> : `${repos.length} repositories`}
          </div>
        )}
      </div>
    </Screen>
  )
}

function RepoRow({ repo: r, onClick }: { repo: Repo; onClick: () => void }) {
  return (
    <ListRow onClick={onClick}>
      <div className="flex items-center gap-2">
        <span className="font-medium">{r.fullName}</span>
        {r.private && <span className={cn('text-xs', muted)}>Private</span>}
        {r.pushedAt && <span className={cn('ml-auto text-xs', muted)}>{new Date(r.pushedAt).toLocaleDateString()}</span>}
      </div>
      {r.description && <div className={cn('truncate', muted)}>{r.description}</div>}
    </ListRow>
  )
}
