import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PullRequestOverview } from '../../core/github'
import type { Workspace } from '../../core/workspaces'
import { muted, ProblemMessage } from './ui'

// The Overview tab: the PR's title and description.
export function Overview({ workspace }: { workspace: Workspace }) {
  const [pr, setPr] = useState<PullRequestOverview | null>(null)
  useEffect(() => {
    let stale = false
    window.coxswain.getPullRequestOverview(workspace.id).then((p) => !stale && setPr(p))
    return () => void (stale = true)
  }, [workspace.id])

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
          <Markdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" /> }}>
            {pr.body}
          </Markdown>
        </div>
      ) : (
        <div className={`text-xs ${muted}`}>No description</div>
      )}
    </div>
  )
}
