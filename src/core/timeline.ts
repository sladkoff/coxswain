import type { Db } from './db'
import { type Commit, isAncestor, listChangedFiles, listCommits, openedWorktree, readFileDiff } from './git'
import { getPullRequestActivity, type GitHubEvent, type GitHubProblem } from './github'
import { ask, getGuideSettings } from './guides'
import { type ReviewEntry, workspaceEntries } from './review'
import { getWorkspaceRepo } from './workspaces'

// ADR 0020: the timeline (glossary) is a workspace's PR history in phases, one per PR head coxswain saw, each with a
// change summary. Only the phases are stored; the rest is put together from entries, git and GitHub when it's read.
// kind: created (the first phase), pushed (builds on the previous head) or rebased (doesn't; base is the merge base).
// A change summary is prose (markdown); the prompt asks it for the change's intent and why.
export type ChangeSummary = { text: string; model: string | null; at: string }
type Entry = Omit<ReviewEntry, 'state'>
// An event (glossary). entry: a thread's first note or question with its replies and answers.
export type TimelineEvent = { kind: 'entry'; at: string; entry: Entry; replies: Entry[] } | GitHubEvent
// files, additions, deletions and commits: base → head, counted by git; null when git couldn't read them.
export type Phase = {
  id: number
  kind: 'created' | 'pushed' | 'rebased'
  head: string
  base: string
  seenAt: string
  current: boolean
  stats: { files: number; additions: number; deletions: number } | null
  commits: Commit[]
  summary: ChangeSummary | null
  summarising: boolean
  events: TimelineEvent[]
}
// pr: null when GitHub couldn't be reached (problem); the phases and coxswain's own events still show.
// phases: newest first, and so are their events.
export type Timeline = {
  pr: { title: string; body: string; author: string | null; createdAt: string; url: string } | null
  problem: GitHubProblem | null
  phases: Phase[]
}

// Called whenever the PR's head is read from GitHub: adds a phase if the head is new, then makes the change summary
// of every phase still without one. onChange: the timeline changed (a phase added, a summary started or stored).
export async function recordHead(db: Db, workspaceId: number, head: string, mergeBase: string, onChange: () => void) {
  const last = await db
    .selectFrom('phases')
    .select('head')
    .where('workspace_id', '=', workspaceId)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  if (last?.head !== head) {
    const base = last && (await isAncestor(db, workspaceId, last.head, head)) ? last.head : mergeBase
    // A head seen before (a force-push back) keeps its old phase.
    await db
      .insertInto('phases')
      .values({ workspace_id: workspaceId, head, base, merge_base: mergeBase, seen_at: new Date().toISOString() })
      .onConflict((oc) => oc.columns(['workspace_id', 'head']).doNothing())
      .execute()
    onChange()
  }
  const todo = await db.selectFrom('phases').select('id').where('workspace_id', '=', workspaceId).where('summarised_at', 'is', null).execute()
  // A summary that failed isn't tried again on its own until the app restarts; Regenerate still can.
  for (const p of todo) if (!failed.has(p.id)) summarise(db, p.id, onChange).catch(() => {})
}

const running = new Map<number, Promise<void>>()
const failed = new Set<number>()

// Makes a phase's change summary (again) and stores it. Safe to call while one runs: it waits for that one.
export function summarise(db: Db, phaseId: number, onChange: () => void): Promise<void> {
  let run = running.get(phaseId)
  if (!run) {
    run = makeSummary(db, phaseId)
      .then(
        () => void failed.delete(phaseId),
        (e) => {
          failed.add(phaseId)
          console.error(`change summary of phase ${phaseId}:`, e)
          throw e
        },
      )
      .finally(() => {
        running.delete(phaseId)
        onChange()
      })
    running.set(phaseId, run)
    onChange()
  }
  return run
}

// ADR 0020: one run on the summary model with the phase's diff, cut like a guide's (ADR 0010).
// ponytail: fixed sizes, the guide's; share them if they ever become settings.
const fileLines = 300
const diffLines = 3000

const summarySchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'A short paragraph or two of prose, in markdown' },
  },
  required: ['summary'],
}

async function makeSummary(db: Db, phaseId: number) {
  const phase = await db.selectFrom('phases').selectAll().where('id', '=', phaseId).executeTakeFirstOrThrow()
  const workspaceId = phase.workspace_id
  const { owner, name, prNumber } = await getWorkspaceRepo(db, workspaceId)
  const [cwd, changed, commits, activity, earlier, settings] = await Promise.all([
    openedWorktree(db, workspaceId),
    listChangedFiles(db, workspaceId, phase.base, phase.head),
    listCommits(db, workspaceId, phase.base, phase.head),
    getPullRequestActivity(owner, name, prNumber),
    db.selectFrom('phases').selectAll().where('workspace_id', '=', workspaceId).where('id', '<', phaseId).orderBy('id').execute(),
    getGuideSettings(db),
  ])
  if (changed.status !== 'ok') throw new Error(changed.message)
  const previous = earlier.at(-1)
  const kind = !previous ? 'created' : phase.base === previous.head ? 'pushed' : 'rebased'

  let budget = diffLines
  const diffs = await Promise.all(
    changed.files.map(async (f) => {
      const line = `${f.status} +${f.additions} -${f.deletions} ${f.path}`
      if (budget <= 0) return `### ${line} (diff left out)`
      const text = await readFileDiff(db, workspaceId, phase.base, f, phase.head).catch((e) => `(couldn't read the diff: ${(e as Error).message})`)
      const lines = text.split('\n')
      budget -= Math.min(lines.length, fileLines)
      const cut = lines.length <= fileLines ? lines : [...lines.slice(0, fileLines), `… ${lines.length - fileLines} more lines`]
      return `### ${line}\n${cut.join('\n')}`
    }),
  )
  // What reviewers said since the previous phase, so the why of a push can say which feedback it answers.
  const since = previous ? Date.parse(previous.seen_at) : -Infinity
  const until = Date.parse(phase.seen_at)
  const within = (at: string | null) => !!at && Date.parse(at) >= since && Date.parse(at) < until
  const feedback = previous
    ? [
        ...(activity.status === 'ok' ? activity.events : [])
          .filter((e) => e.kind !== 'state')
          .filter((e) => within(e.at) && e.body.trim())
          .map((e) => `- ${e.kind === 'review' ? `Review (${e.state})` : 'Comment'} by ${e.author}: ${e.body.trim().slice(0, 1000)}`),
      ]
    : []

  const scope = {
    created: 'This is the PR as coxswain first saw it: every change from the merge base.',
    pushed: 'These are the commits pushed since the previous version of the PR, and only their changes.',
    rebased: 'The PR was rebased or force-pushed since the previous version; this is the whole PR as it is now.',
  }[kind]
  const prompt = [
    `You are writing the timeline of a pull request for a reviewer. Summarise what this version of the PR changed. ${scope}`,
    "Write it as a short paragraph or two of plain prose that a reviewer reads in half a minute: what the change sets out to do and why, from the description, the commit messages and the review feedback below. If none of them says why, say so plainly rather than guess. Don't use headings or labels, don't list the files, and don't review the change. Name files by path where it helps.",
    activity.status === 'ok' && `The PR: ${activity.title}\n\n${activity.body.trim() || '(no description)'}`,
    earlier.some((p) => p.summary) &&
      `Earlier versions of the PR, oldest first:\n${earlier.map((p, i) => `${i + 1}. ${p.summary ?? '(not summarised)'}`).join('\n\n')}`,
    feedback.length && `Review feedback since the previous version:\n${feedback.join('\n')}`,
    commits.status === 'ok' && `Commits, newest first:\n${commits.commits.map((c) => `- ${c.subject}`).join('\n')}`,
    `Changed files (status, lines added and removed, path), each with its diff:\n\n${diffs.join('\n\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const out = await ask(cwd, prompt, summarySchema, settings.summaryModel, false)
  const answer = out.answer as { summary?: string } | undefined
  if (!answer?.summary?.trim()) throw new Error('Claude Code gave no summary')
  await db
    .updateTable('phases')
    .set({ summary: answer.summary.trim(), model: out.model ?? settings.summaryModel, summarised_at: new Date().toISOString() })
    .where('id', '=', phaseId)
    .execute()
}

// The timeline as the Overview shows it (ADR 0020). Each event goes in the latest phase seen at or before it; a
// review goes in the phase of the commit it was made on, if there is one. Events before the first phase go in it.
// ponytail: asks GitHub on every read, and entries changing reads it again; cache the activity if that shows.
export async function getTimeline(db: Db, workspaceId: number): Promise<Timeline> {
  const { owner, name, prNumber } = await getWorkspaceRepo(db, workspaceId)
  const [activity, rows, entries] = await Promise.all([
    getPullRequestActivity(owner, name, prNumber),
    db.selectFrom('phases').selectAll().where('workspace_id', '=', workspaceId).orderBy('id').execute(),
    workspaceEntries(db, workspaceId),
  ])
  const phases: Phase[] = await Promise.all(
    rows.map(async (r, i) => {
      const [changed, commits] = await Promise.all([
        listChangedFiles(db, workspaceId, r.base, r.head),
        listCommits(db, workspaceId, r.base, r.head),
      ])
      const files = changed.status === 'ok' ? changed.files : null
      return {
        id: r.id,
        kind: i === 0 ? 'created' : r.base === rows[i - 1].head ? 'pushed' : 'rebased',
        head: r.head,
        base: r.base,
        seenAt: r.seen_at,
        current: i === rows.length - 1,
        stats: files && {
          files: files.length,
          additions: files.reduce((n, f) => n + f.additions, 0),
          deletions: files.reduce((n, f) => n + f.deletions, 0),
        },
        commits: commits.status === 'ok' ? commits.commits : [],
        summary: r.summary !== null ? { text: r.summary, model: r.model, at: r.summarised_at ?? r.seen_at } : null,
        summarising: running.has(r.id),
        events: [],
      }
    }),
  )
  const place = (e: TimelineEvent) => {
    const at = Date.parse(e.at)
    const phase =
      (e.kind === 'review' && phases.find((p) => p.head === e.commit)) || phases.findLast((p) => Date.parse(p.seenAt) <= at) || phases[0]
    phase?.events.push(e)
  }
  for (const entry of entries.filter((e) => !e.parentId))
    place({ kind: 'entry', at: entry.createdAt, entry, replies: entries.filter((e) => e.parentId === entry.id) })
  if (activity.status === 'ok') for (const e of activity.events) place(e)
  // Newest first, phases and the events in them, so the latest is at the top.
  for (const p of phases) p.events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return {
    pr: activity.status === 'ok' ? { title: activity.title, body: activity.body, author: activity.author, createdAt: activity.createdAt, url: activity.url } : null,
    problem: activity.status === 'ok' ? null : activity,
    phases: phases.reverse(),
  }
}
