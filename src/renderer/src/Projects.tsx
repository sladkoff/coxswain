import { useEffect, useState } from 'react'
import type { GitHubProblem, Repo } from '../../core/github'
import type { Project } from '../../core/projects'
import { button, GitHubProblemMessage, muted, ScreenHeader } from './ui'

type Props = {
  projects: Project[]
  current: Project | undefined
  onSelect: (fullName: string) => void
  onClose: () => void
}

const row = 'block w-full rounded-md px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800'
const heading = `mt-4 mb-1 px-2 text-xs font-medium ${muted}`

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
    <div className="flex h-full flex-col select-none text-sm">
      <ScreenHeader title="Projects" onClose={onClose} />

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col p-6">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects and GitHub repositories"
          className="mb-3 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700"
        />

        {problem && (
          <div className="flex items-center gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <GitHubProblemMessage problem={problem} />
            <button className={`${button} ml-auto shrink-0`} onClick={loadMore}>
              Try again
            </button>
          </div>
        )}

        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {shownProjects.length > 0 && (
            <>
              <div className={heading}>Your projects</div>
              {shownProjects.map((p) => (
                <button key={p.id} className={row} onClick={() => onSelect(`${p.owner}/${p.name}`)}>
                  <span className="font-medium">
                    {p.owner}/{p.name}
                  </span>
                  {p.id === current?.id && <span className={`ml-2 text-xs ${muted}`}>Current</span>}
                </button>
              ))}
            </>
          )}

          <div className={heading}>GitHub repositories</div>
          {shownRepos.map((r) => (
            <button key={r.id} className={row} onClick={() => onSelect(r.fullName)}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.fullName}</span>
                {r.private && <span className={`text-xs ${muted}`}>Private</span>}
                {r.pushedAt && (
                  <span className={`ml-auto text-xs ${muted}`}>{new Date(r.pushedAt).toLocaleDateString()}</span>
                )}
              </div>
              {r.description && <div className={`truncate ${muted}`}>{r.description}</div>}
            </button>
          ))}
          {!problem && (
            <div className={`py-3 text-center ${muted}`}>
              {loading ? (
                'Loading…'
              ) : hasMore ? (
                <button className={button} onClick={loadMore}>
                  Load more
                </button>
              ) : (
                `${repos.length} repositories`
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
