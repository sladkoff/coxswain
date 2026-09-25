import { Virtualizer } from '@pierre/diffs/react'
import { type ComponentProps, type UIEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangedFile } from '../../core/git'
import type { Guide as GuideData, GuideGroup, GuideProgress } from '../../core/guides'
import type { Workspace } from '../../core/workspaces'
import { button, muted, Prose } from './ui'
import { Viewer } from './Viewer'

type Diff = { kind: 'diff'; file: ChangedFile }
type Props = {
  workspace: Workspace
  mergeBase: string
  diffs: Diff[] // memoised by the parent, so the Viewers don't reread
  viewed: string[]
  onViewedChange: (path: string, viewed: boolean) => void
  showViewed: boolean
  onShowViewed: () => void
  viewer: Omit<ComponentProps<typeof Viewer>, 'opened' | 'stacked'>
}

type State = { kind: 'loading' } | { kind: 'creating' } | { kind: 'ok'; guide: GuideData } | { kind: 'error'; message: string }

// The Guide tab: the workspace's file diffs in groups made by the agent, each with a title and what to look at.
// Opens the stored guide; makes one the first time.
export function Guide({ workspace, mergeBase, diffs, viewed, onViewedChange, showViewed, onShowViewed, viewer }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  // Viewed file diffs, and groups whose file diffs are all viewed, are hidden unless shown (the tab bar's cog menu).
  // The group at the top of the scroll, marked in the table of contents.
  const [current, setCurrent] = useState(0)
  // A group picked in the table of contents while it was hidden: scrolled to once viewed groups show.
  const [pending, setPending] = useState<number | null>(null)
  const scrollTo = (i: number) => document.getElementById(`guide-group-${i}`)?.scrollIntoView()
  useEffect(() => {
    if (pending === null) return
    scrollTo(pending)
    setPending(null)
  }, [pending, showViewed])
  // Bumped when the workspace changes or the tab closes, so a guide that arrives late is dropped.
  const request = useRef(0)
  const create = () => {
    const r = request.current
    setState({ kind: 'creating' })
    window.coxswain.createGuide(workspace.id, mergeBase).then((g) => {
      if (r === request.current) setState(g.status === 'ok' ? { kind: 'ok', guide: g.guide } : { kind: 'error', message: g.message })
    })
  }
  useEffect(() => {
    const r = ++request.current
    setState({ kind: 'loading' })
    window.coxswain.getGuide(workspace.id, mergeBase).then((guide) => {
      if (r !== request.current) return
      if (guide) setState({ kind: 'ok', guide })
      else create()
    })
    return () => void request.current++
  }, [workspace.id, mergeBase])

  // Subscribed for as long as the tab shows, so progress sent right as a run starts or is rejoined isn't missed.
  // Once grouped, the guide being made shows, and fills in as its groups are described.
  const [progress, setProgress] = useState<GuideProgress | null>(null)
  useEffect(() => {
    setProgress(null)
    return window.coxswain.onGuideProgress((id, p) => {
      if (id !== workspace.id) return
      setProgress(p)
      const g = p.guide
      if (g)
        setState((s) => (s.kind === 'creating' || (s.kind === 'ok' && s.guide.id === g.id) ? { kind: 'ok', guide: g } : s))
    })
  }, [workspace.id])

  // The guide's groups with the file diffs as they are now, plus the changed files it doesn't mention (changed
  // since it was made, e.g. by an agent), before the generated groups, which stay last. Files no longer changed drop out.
  const groups = useMemo(() => {
    if (state.kind !== 'ok') return []
    const byPath = new Map(diffs.map((d) => [d.file.path, d]))
    const listed = new Set(state.guide.groups.flatMap((g) => g.paths))
    const rest = diffs.filter((d) => !listed.has(d.file.path))
    const withDiffs = (g: GuideGroup) => ({ ...g, diffs: g.paths.flatMap((p) => byPath.get(p) ?? []) })
    return [
      ...state.guide.groups.map(withDiffs),
      ...(rest.length
        ? [{ title: 'Not in the guide', description: 'Changed since the guide was made.', paths: [], diffs: rest }]
        : []),
    ]
      .sort((a, b) => Number(generated(a)) - Number(generated(b)))
      .filter((g) => g.diffs.length)
  }, [state, diffs])

  if (state.kind === 'loading') return null // local and near-instant
  if (state.kind === 'creating')
    return (
      <div className={`flex flex-1 items-center justify-center text-xs ${muted}`}>
        <ProgressBar progress={progress} />
      </div>
    )
  if (state.kind === 'error')
    return (
      <div className={`flex flex-1 flex-col items-center justify-center gap-2 text-xs ${muted}`}>
        <span className="select-text">Couldn't create the guide: {state.message}</span>
        <button className={button} onClick={create}>
          Try again
        </button>
      </div>
    )

  const { guide } = state
  const describing = progress?.phase === 'describing' && progress.guide?.id === guide.id && progress.done < progress.total
  const all = groups.flatMap((g) => g.diffs)
  const viewedCount = all.filter((d) => viewed.includes(d.file.path)).length
  const shown = groups
    .map((g, i) => ({ ...g, i, shown: showViewed ? g.diffs : g.diffs.filter((d) => !viewed.includes(d.file.path)) }))
    .filter((g) => g.shown.length)
  // The last group whose top has scrolled past the top of the pane (with a little slack) is the current one.
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    // Only the pane's own scroll: file diffs also scroll sideways inside it.
    const pane = e.target as HTMLElement
    if (pane.parentElement !== e.currentTarget) return
    const top = pane.getBoundingClientRect().top + 40
    const passed = shown.filter((g) => (document.getElementById(`guide-group-${g.i}`)?.getBoundingClientRect().top ?? 0) <= top)
    setCurrent(passed.length ? passed[passed.length - 1].i : (shown[0]?.i ?? 0))
  }
  return (
    <div className="flex min-h-0 flex-1">
      {/* ponytail: fixed width, no Splitter; make it resizable like the Navigator if titles get cut. */}
      <nav className="flex w-60 shrink-0 flex-col gap-2 overflow-y-auto border-r border-neutral-200 p-3 text-xs dark:border-neutral-800">
        <div className="flex flex-col gap-1">
          <div className="h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full bg-neutral-500 dark:bg-neutral-400" style={{ width: `${(100 * viewedCount) / (all.length || 1)}%` }} />
          </div>
          <span className={muted}>
            {viewedCount} of {all.length} viewed
          </span>
        </div>
        {groups.map((g, i) => {
          const n = g.diffs.filter((d) => viewed.includes(d.file.path)).length
          const done = n === g.diffs.length
          return (
            <button
              key={i}
              onClick={() => {
                if (done && !showViewed) {
                  onShowViewed()
                  setPending(i)
                } else scrollTo(i)
              }}
              className={`flex items-baseline gap-2 rounded px-1.5 py-1 text-left ${i === current ? 'bg-neutral-200 dark:bg-neutral-700' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'} ${done || generated(g) ? muted : ''}`}
            >
              <span className="min-w-0 flex-1">
                <Prose inline>{g.title}</Prose>
              </span>
              <span className={`shrink-0 tabular-nums ${muted}`}>{done ? '✓' : `${n}/${g.diffs.length}`}</span>
            </button>
          )
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col" onScrollCapture={onScroll}>
        <Virtualizer className="min-h-0 flex-1 overflow-auto">
          <div className={`flex items-center gap-2 px-4 pt-3 text-xs ${muted}`}>
            <span>
              Made by {guide.model} on {new Date(guide.finishedAt ?? guide.createdAt).toLocaleString()}
              {guide.startedAt && guide.finishedAt && ` in ${duration(guide.startedAt, guide.finishedAt)}`}
              {!guide.finishedAt &&
                (describing ? `, describing groups: ${progress.done} of ${progress.total}…` : ', unfinished: some groups have no description')}
            </span>
            <button className={`${button} text-xs`} onClick={create}>
              Regenerate
            </button>
          </div>
          {!shown.length && <div className={`p-4 text-xs ${muted}`}>All files viewed</div>}
          {shown.map((g) => {
            const done = g.diffs.every((d) => viewed.includes(d.file.path))
            return (
              <section key={g.i} id={`guide-group-${g.i}`} className={`pt-6 ${generated(g) ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3 px-4 pb-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 select-text">
                    <h2 className="text-base font-semibold">
                      <Prose inline>{g.title}</Prose>
                    </h2>
                    <div className={`text-xs ${muted}`}>
                      {generated(g) && 'Generated · '}
                      {g.diffs.length} files{g.shown.length < g.diffs.length && `, ${g.diffs.length - g.shown.length} viewed`}
                    </div>
                    {g.description ? (
                      <div className={prose}>
                        <Prose>{g.description}</Prose>
                      </div>
                    ) : (
                      describing && g.paths.length > 0 && <div className={`text-xs ${muted}`}>Describing…</div>
                    )}
                  </div>
                  <label className="flex shrink-0 items-center gap-1 pt-1 text-xs">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={(e) =>
                        g.diffs
                          .filter((d) => viewed.includes(d.file.path) !== e.target.checked)
                          .forEach((d) => onViewedChange(d.file.path, e.target.checked))
                      }
                    />
                    Viewed
                  </label>
                </div>
                {g.shown.map((d) => (
                  <div key={d.file.path}>
                    {g.notes?.[d.file.path] && (
                      <div className={`px-4 pt-3 pb-2 select-text ${prose}`}>
                        <Prose>{g.notes[d.file.path]}</Prose>
                      </div>
                    )}
                    <Viewer stacked opened={d} {...viewer} />
                  </div>
                ))}
              </section>
            )
          })}
        </Virtualizer>
      </div>
    </div>
  )
}

// A group's description and its file notes: the same readable text, at a line length that's easy to follow.
const prose = 'markdown max-w-[80ch] text-[13px] leading-relaxed text-neutral-700 [overflow-wrap:anywhere] dark:text-neutral-300'

const generated = (g: Pick<GuideGroup, 'tags'>) => !!g.tags?.includes('generated')

const duration = (from: string, to: string) => {
  const s = Math.round((Date.parse(to) - Date.parse(from)) / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

// Share of the bar for summarising, when there is any; grouping takes the rest. Describing happens with the
// guide showing. A guess: summarising and grouping should each take well under a minute for #5311 (ADR 0010).
const summarisingShare = 0.5

// An approximate progress bar: steps the core reports fill it, and between them it creeps towards the next step,
// slower and slower, so it moves without ever getting ahead of the work.
function ProgressBar({ progress: p }: { progress: GuideProgress | null }) {
  const [since, setSince] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => setSince(Date.now()), [p?.done, p?.phase])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const summarising = p?.phase === 'summarising'
  const [from, to, label] = !p
    ? [0, 0.05, 'Creating guide…']
    : summarising && p.total
      ? // Batches run many at once, so the bar heads for the end of summarising.
        [(summarisingShare * p.done) / p.total, summarisingShare, `Summarising files: ${p.done} of ${p.total} batches`]
      : summarising
        ? [0, 0.05, 'Creating guide…']
        : [summarisingShare, 1, 'Grouping files…']
  // Seconds a step takes, roughly: the summaries, or the grouping.
  const pace = summarising ? 20 : 30
  const fraction = from + (to - from) * 0.9 * (1 - Math.exp(-(now - since) / 1000 / pace))
  return (
    <div className="flex w-72 flex-col gap-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full rounded-full bg-neutral-500 transition-[width] duration-300 dark:bg-neutral-400"
          style={{ width: `${Math.round(fraction * 1000) / 10}%` }}
        />
      </div>
      <span>{label}</span>
    </div>
  )
}
