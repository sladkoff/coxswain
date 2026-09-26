import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Phase, Timeline, TimelineEvent } from '../../core/timeline'
import type { Workspace } from '../../core/workspaces'
import { changed, core } from './queries'
import { button, muted, ProblemMessage, Prose } from './ui'

const line = 'border-neutral-200 dark:border-neutral-800'
const when = (at: string) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// The Overview tab (ADR 0020): the PR's title, then its timeline, newest first: a phase per PR head seen, each with its
// change summary and the events that happened in it. Offline or signed out, it shows what coxswain has.
export function Overview({ workspace }: { workspace: Workspace }) {
  const timeline = useQuery(core('getTimeline', workspace.id)).data

  if (!timeline) return <div className={`p-4 text-xs ${muted}`}>Loading…</div>
  const { pr, problem, phases } = timeline
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 select-text">
      <h1 className="text-lg font-semibold">
        {pr?.title ?? 'Pull request'} <span className={`font-normal ${muted}`}>#{workspace.prNumber}</span>
      </h1>
      {pr && (
        <div className={`mb-4 text-xs ${muted}`}>
          {pr.author ?? 'Someone'} opened this on {when(pr.createdAt)} ·{' '}
          <a href={pr.url} target="_blank" className="underline">
            GitHub
          </a>
        </div>
      )}
      {problem && (
        <div className={`mb-4 text-xs ${muted}`}>
          <ProblemMessage problem={problem} /> Showing only what coxswain has.
        </div>
      )}
      {!phases.length && <div className={`text-xs ${muted}`}>Checking the PR's commits…</div>}
      <div className={`ml-1.5 border-l ${line}`}>
        {phases.map((p) => (
          <PhaseView key={p.id} workspaceId={workspace.id} phase={p} timeline={timeline} />
        ))}
      </div>
    </div>
  )
}

function PhaseView({ workspaceId, phase, timeline }: { workspaceId: number; phase: Phase; timeline: Timeline }) {
  const [error, setError] = useState<string | null>(null)
  const title =
    phase.kind === 'created' ? 'PR created' : phase.kind === 'pushed' ? `${plural(phase.commits.length, 'new commit')}` : 'Rebased'
  // The first phase starts when the PR was opened, not when coxswain first saw it.
  const at = phase.kind === 'created' && timeline.pr ? timeline.pr.createdAt : phase.seenAt
  const summarise = async () => {
    setError(null)
    const result = await window.coxswain.summarisePhase(workspaceId, phase.id)
    if (result.status === 'error') setError(result.message)
    changed({ workspaceId, what: 'timeline' })
  }
  const s = phase.summary
  return (
    <div className="relative pb-5 pl-4 text-xs">
      <span className="absolute top-1 -left-[5px] size-2.5 rounded-full bg-neutral-500" />
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className={muted}>{when(at)}</span>
        <span className="flex-1" />
        <span className={`font-mono ${muted}`}>{phase.head.slice(0, 7)}</span>
        {phase.current && <span className="rounded bg-neutral-200 px-1 dark:bg-neutral-800">current</span>}
      </div>
      <div className={`mt-0.5 ${muted}`}>
        {phase.stats && `${plural(phase.stats.files, 'file')} · +${phase.stats.additions} −${phase.stats.deletions} · `}
        {phase.commits.length > 0 ? (
          <details className="inline">
            <summary className="inline cursor-default">{plural(phase.commits.length, 'commit')}</summary>
            <ul className="mt-1 mb-1 flex flex-col gap-0.5">
              {phase.commits.map((c) => (
                <li key={c.sha}>
                  <span className="font-mono">{c.sha.slice(0, 7)}</span> {c.subject}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          'no commits'
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {s ? (
          <div className="markdown text-sm [overflow-wrap:anywhere]">
            <Prose>{s.text}</Prose>
          </div>
        ) : (
          <span className={muted}>{phase.summarising ? 'Summarising…' : 'No summary yet'}</span>
        )}
        <span className={`flex items-center gap-2 ${muted}`}>
          {s?.model}
          {!phase.summarising && (
            <button className={`${button} text-xs`} onClick={summarise}>
              {s ? 'Regenerate' : 'Summarise'}
            </button>
          )}
          {phase.summarising && s && 'Summarising…'}
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
        </span>
      </div>
      {phase.kind === 'created' && timeline.pr && (
        <details className="mt-2">
          <summary className={`cursor-default ${muted}`}>Description</summary>
          <div className="markdown mt-1 [overflow-wrap:anywhere]">
            {timeline.pr.body ? <Prose>{timeline.pr.body}</Prose> : <span className={muted}>No description</span>}
          </div>
        </details>
      )}
      {phase.events.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {phase.events.map((e, i) => (
            <EventView key={i} event={e} />
          ))}
        </div>
      )}
    </div>
  )
}

const reviewed: Record<string, string> = {
  approved: 'approved',
  changes_requested: 'requested changes',
  commented: 'reviewed',
  dismissed: 'reviewed (dismissed)',
}
const stateChange = {
  merged: 'merged the PR',
  closed: 'closed the PR',
  reopened: 'reopened the PR',
  ready: 'marked the PR ready for review',
  draft: 'marked the PR as a draft',
  'force-pushed': 'force-pushed',
}

// One event: a line saying what happened, then its text, if any.
function EventView({ event: e }: { event: TimelineEvent }) {
  const head = (what: React.ReactNode, url?: string) => (
    <div className={`flex gap-2 ${muted}`}>
      <span className="tabular-nums">{time(e.at)}</span>
      <span className="min-w-0 truncate">{what}</span>
      {url && (
        <a href={url} target="_blank" className="underline">
          GitHub
        </a>
      )}
    </div>
  )
  switch (e.kind) {
    case 'entry': {
      const at = where(e.entry)
      return (
        <div>
          {head(
            <>
              <span className="capitalize">{e.entry.kind}</span>
              {at && <span className="font-mono"> · {at}</span>}
            </>,
          )}
          <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{e.entry.body}</div>
          {e.replies.length > 0 && (
            <details className={`mt-1 ml-3 border-l pl-2 ${line}`}>
              <summary className={`cursor-default ${muted}`}>
                {plural(e.replies.filter((r) => r.kind === 'answer').length, 'answer')}
              </summary>
              {e.replies.map((r) => (
                <div key={r.id} className="mt-1">
                  <div className={muted}>{r.kind === 'answer' ? 'Answer' : r.kind === 'question' ? 'Follow-up' : 'Reply'}</div>
                  <div className="markdown [overflow-wrap:anywhere]">{r.kind === 'answer' ? <Prose>{r.body}</Prose> : r.body}</div>
                </div>
              ))}
            </details>
          )}
        </div>
      )
    }
    case 'comment':
      return (
        <div>
          {head(`${e.author} commented`, e.url)}
          <Clamped text={e.body} />
        </div>
      )
    case 'review':
      return (
        <div>
          {head(`${e.author} ${reviewed[e.state] ?? 'reviewed'}${e.comments ? ` · ${plural(e.comments, 'comment')}` : ''}`, e.url)}
          {e.body && <Clamped text={e.body} />}
        </div>
      )
    case 'state':
      return head(`${e.author} ${stateChange[e.what]}`)
  }
}

// GitHub text, cut to a few lines until clicked.
function Clamped({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`markdown [overflow-wrap:anywhere] ${open ? '' : 'line-clamp-4'}`} onClick={() => setOpen(true)}>
      <Prose>{text}</Prose>
    </div>
  )
}

const where = (a: { path: string | null; startLine: number | null; endLine: number | null }) =>
  a.path && `${a.path}:${a.startLine === a.endLine ? a.startLine : `${a.startLine}–${a.endLine}`}`
