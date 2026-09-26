import { useQuery } from '@tanstack/react-query'
import type { Workspace } from '../../core/workspaces'
import { core } from './queries'
import { muted, ProblemMessage, Prose } from './ui'

// The Overview tab: the PR's title and description. Offline or signed out, it keeps what was fetched before.
export function Overview({ workspace }: { workspace: Workspace }) {
  const pr = useQuery(core('getPullRequestOverview', workspace.id)).data

  if (!pr) return <div className={`p-4 text-xs ${muted}`}>Loading…</div>
  if (pr.status !== 'ok')
    return (
      <div className={`p-4 text-xs ${muted}`}>
        <ProblemMessage problem={pr} />
      </div>
    )
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 select-text">
      <h1 className="mb-3 text-lg font-semibold">
        {pr.title} <span className={`font-normal ${muted}`}>#{workspace.prNumber}</span>
      </h1>
      {pr.body ? (
        <div className="markdown [overflow-wrap:anywhere]">
          <Prose>{pr.body}</Prose>
        </div>
      ) : (
        <div className={`text-xs ${muted}`}>No description</div>
      )}
    </div>
  )
}
