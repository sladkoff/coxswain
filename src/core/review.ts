import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { type ChatEntry, runTurn, stopTurn, type TurnResult } from './agents'
import { worktreePath } from './git'
import { runClaude } from './guides'
import { getWorkspaceRepo } from './workspaces'

// ADR 0011: a review round is a stream of entries (glossary): notes, questions and answers.
// An entry's anchor is a line range of a file; side 'old' is the merge base (removed lines in a diff), 'new' the
// worktree. code: the lines as they were, since line numbers drift as the worktree changes. No anchor: it floats.
// ponytail: anchored by line numbers only, so entries drift after edits; outdated tracking is glossary open question 2.
export type Anchor = { path: string; side: 'old' | 'new'; startLine: number; endLine: number; code: string }

export type ReviewEntry = {
  id: number
  reviewRoundId: number
  kind: 'note' | 'question' | 'answer'
  body: string
  parentId: number | null // the thread's first question, for follow-ups and answers
  path: string | null
  side: 'old' | 'new' | null
  startLine: number | null
  endLine: number | null
  code: string | null
  createdAt: string
  sentAt: string | null
}

// A note or question from the user: anchored, or a follow-up in a thread (parentId).
export type NewEntry = { workspaceId: number; body: string; anchor?: Anchor; parentId?: number }

const columns = `id, review_round_id as reviewRoundId, kind, body, parent_id as parentId, path, side,
  start_line as startLine, end_line as endLine, code, created_at as createdAt, sent_at as sentAt`

// The round new entries go in: the latest, unless it was wrapped up, which starts a new one (ADR 0012).
// ponytail: a round doesn't go stale when the code changes (glossary open question 3).
function currentRound(db: DatabaseSync, workspaceId: number): number {
  const row = db
    .prepare('select id from review_rounds where workspace_id = ? and ended_at is null order by id desc limit 1')
    .get(workspaceId) as
    | { id: number }
    | undefined
  if (row) return row.id
  return (
    db
      .prepare('insert into review_rounds (workspace_id, created_at) values (?, ?) returning id')
      .get(workspaceId, new Date().toISOString()) as { id: number }
  ).id
}

export function listEntries(db: DatabaseSync, workspaceId: number): ReviewEntry[] {
  return db
    .prepare(
      `select ${columns} from entries where review_round_id =
       (select id from review_rounds where workspace_id = ? order by id desc limit 1) order by id`,
    )
    .all(workspaceId) as ReviewEntry[]
}

function addEntry(db: DatabaseSync, roundId: number, kind: ReviewEntry['kind'], e: Omit<NewEntry, 'workspaceId'>): ReviewEntry {
  if (!e.body.trim()) throw new Error(`A ${kind} needs text`)
  const a = e.anchor
  if (a && a.side !== 'old' && a.side !== 'new') throw new Error(`Not a side: ${a.side}`)
  const [start, end] = a ? [a.startLine, a.endLine].sort((x, y) => x - y) : [null, null]
  return db
    .prepare(
      `insert into entries (review_round_id, kind, body, parent_id, path, side, start_line, end_line, code, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning ${columns}`,
    )
    .get(
      roundId,
      kind,
      e.body.trim(),
      e.parentId ?? null,
      a?.path ?? null,
      a?.side ?? null,
      start,
      end,
      a?.code ?? null,
      new Date().toISOString(),
    ) as ReviewEntry
}

export const addNote = (db: DatabaseSync, e: NewEntry) => addEntry(db, currentRound(db, e.workspaceId), 'note', e)

export function deleteEntry(db: DatabaseSync, id: number) {
  db.prepare('delete from entries where id = ?').run(id)
}

function describe(a: Pick<ReviewEntry, 'path' | 'side' | 'startLine' | 'endLine' | 'code'>): string {
  const lines = a.startLine === a.endLine ? `line ${a.startLine}` : `lines ${a.startLine}-${a.endLine}`
  const where = a.side === 'old' ? 'removed by the PR, as at its merge base' : 'as in the worktree then'
  const fence = '`'.repeat(Math.max(3, ...[...(a.code ?? '').matchAll(/`+/g)].map((m) => m[0].length + 1)))
  return `\`${a.path}\` ${lines} (${where}):\n${fence}\n${a.code}\n${fence}`
}

// The prompt of an ask: the notes with where they point and the code they're about, then the user's message.
// Marks the notes as sent.
export function formatAsk(db: DatabaseSync, noteIds: number[], message: string, roundId?: number): string {
  if (roundId) message = [formatHandOff(db, roundId), message.trim()].filter(Boolean).join('\n\n')
  if (!noteIds.length) return message
  const byId = db.prepare(`select ${columns} from entries where id = ? and kind = 'note'`)
  const notes = noteIds.map((id) => byId.get(id) as ReviewEntry | undefined).filter((n) => n !== undefined)
  const sent = db.prepare('update entries set sent_at = ? where id = ?')
  const now = new Date().toISOString()
  for (const n of notes) sent.run(now, n.id)
  const parts = notes.map((n) => (n.path ? `Note on ${describe(n)}\n${n.body}` : `Note: ${n.body}`))
  return [...parts, message.trim()].filter(Boolean).join('\n\n')
}

// The round's agent session for its questions (ADR 0011), made with its first question.
function questionSession(db: DatabaseSync, roundId: number): { agentSessionId: string; first: boolean } {
  const row = db.prepare('select agent_session_id as id from agent_sessions where review_round_id = ?').get(roundId) as
    | { id: string }
    | undefined
  if (row) return { agentSessionId: row.id, first: false }
  const id = randomUUID()
  db.prepare(
    `insert into agent_sessions (workspace_id, agent, agent_session_id, created_at, review_round_id)
     select workspace_id, 'claude', ?, ?, id from review_rounds where id = ?`,
  ).run(id, new Date().toISOString(), roundId)
  return { agentSessionId: id, first: true }
}

const preamble =
  "I'm reviewing the changes in this worktree and will ask you questions about them, one at a time. " +
  "Answer briefly. Don't change any files.\n\n"

// Adds a question and asks it in the round's agent session, streaming the reply; the agent's text becomes an answer
// entry in the question's thread. Returns the question once saved, and the turn's result when it ends.
export function askQuestion(
  db: DatabaseSync,
  e: NewEntry,
  onChat: (threadId: number, entry: ChatEntry) => void,
): { question: ReviewEntry; turn: Promise<TurnResult> } {
  const question = addEntry(db, currentRound(db, e.workspaceId), 'question', e)
  const threadId = question.parentId ?? question.id
  const { agentSessionId, first } = questionSession(db, question.reviewRoundId)
  const prompt = (first ? preamble : '') + (question.path ? `About ${describe(question)}\n${question.body}` : question.body)
  const texts: string[] = []
  const turn = runTurn(db, agentSessionId, prompt, { readOnly: true }, (c) => {
    if (c.kind === 'text') texts.push(c.text)
    onChat(threadId, c)
  }).then((result) => {
    if (result.status === 'ok' && texts.length)
      addEntry(db, question.reviewRoundId, 'answer', { body: texts.join('\n\n'), parentId: threadId })
    return result
  })
  return { question, turn }
}

export function stopQuestion(db: DatabaseSync, workspaceId: number) {
  const row = db
    .prepare(
      `select agent_session_id as id from agent_sessions where review_round_id =
       (select id from review_rounds where workspace_id = ? order by id desc limit 1)`,
    )
    .get(workspaceId) as { id: string } | undefined
  if (row) stopTurn(row.id)
}

// ADR 0012: an action item, drafted by wrapping up a round. entryIds: the entries it came from. Anchored like an entry.
export type ActionItem = {
  id: number
  reviewRoundId: number
  body: string
  entryIds: number[]
  path: string | null
  side: 'old' | 'new' | null
  startLine: number | null
  endLine: number | null
  code: string | null
}
// The latest round, as its bar shows it. ponytail: earlier rounds aren't reachable until rounds get a history.
export type ReviewRound = { id: number; number: number; createdAt: string; endedAt: string | null; actionItems: ActionItem[] }

export function getRound(db: DatabaseSync, workspaceId: number): ReviewRound | null {
  const round = db
    .prepare(
      `select id, (select count(*) from review_rounds r where r.workspace_id = review_rounds.workspace_id and r.id <= review_rounds.id) as number,
       created_at as createdAt, ended_at as endedAt from review_rounds where workspace_id = ? order by id desc limit 1`,
    )
    .get(workspaceId) as Omit<ReviewRound, 'actionItems'> | undefined
  if (!round) return null
  const items = db
    .prepare(
      `select id, review_round_id as reviewRoundId, body, entry_ids as entryIds, path, side, start_line as startLine,
       end_line as endLine, code from action_items where review_round_id = ? order by position`,
    )
    .all(round.id) as (Omit<ActionItem, 'entryIds'> & { entryIds: string })[]
  return { ...round, actionItems: items.map((i) => ({ ...i, entryIds: JSON.parse(i.entryIds) })) }
}

export function updateActionItem(db: DatabaseSync, id: number, body: string) {
  if (!body.trim()) throw new Error('An action item needs text')
  db.prepare('update action_items set body = ? where id = ?').run(body.trim(), id)
}

export function deleteActionItem(db: DatabaseSync, id: number) {
  db.prepare('delete from action_items where id = ?').run(id)
}

// A round's entries, numbered from 1 in order; answers and follow-ups cite their question's number.
function formatStream(entries: ReviewEntry[]): string {
  const number = new Map(entries.map((e, i) => [e.id, i + 1]))
  return entries
    .map((e, i) => {
      const on = e.path ? ` on ${describe(e)}` : ''
      const head =
        e.kind === 'answer'
          ? `Your answer to [${number.get(e.parentId!)}]`
          : e.parentId
            ? `My follow-up to [${number.get(e.parentId)}]`
            : `My ${e.kind}${on}`
      return `[${i + 1}] ${head}:\n${e.body}`
    })
    .join('\n\n')
}

// Hand off (glossary): a wrapped-up round's action items, with where they point, then the round's whole stream so the
// agent has the reasoning behind them. Goes in front of an ask's message.
// ponytail: a hand-off isn't recorded; action items don't know they were sent. Add a handed_off_at when it matters.
function formatHandOff(db: DatabaseSync, roundId: number): string {
  const entries = db.prepare(`select ${columns} from entries where review_round_id = ? order by id`).all(roundId) as ReviewEntry[]
  const items = db
    .prepare('select body, path, side, start_line as startLine, end_line as endLine, code from action_items where review_round_id = ? order by position')
    .all(roundId) as Pick<ActionItem, 'body' | 'path' | 'side' | 'startLine' | 'endLine' | 'code'>[]
  const list = items.map((item, i) => `${i + 1}. ${item.path ? `On ${describe(item)}\n` : ''}${item.body}`)
  return `Implement these action items from my review of this worktree's changes, in order:\n\n${list.join('\n\n')}

For context, the review round they came from: my notes and questions, and the answers, numbered, in order.
The numbers are the round's own, not the action items'. Where an item and the round disagree, the item wins.

${formatStream(entries)}`
}

const wrapUpSystem =
  'You help a reviewer finish reviewing a pull request. Everything you need is in the message; you have no tools. Answer in the structured format asked for.'

const wrapUpPrompt = `Below is my review round of a pull request: my notes and questions, and your answers, numbered, in the
order I made them. Draft the action items: the changes to make to the code because of this review. Each item
is one change, written as a self-contained instruction for a coding agent that won't see this review, so say
where and what. Merge notes that ask for the same thing, turn decisions reached in questions and answers into
items, and leave out questions that led to nothing to change. Cite the numbers of the entries each item comes
from. Order the items as they are best done.`

const wrapUpSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The change to make, as an instruction' },
          entries: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the entries it comes from' },
        },
        required: ['text', 'entries'],
      },
    },
  },
  required: ['items'],
}

// Wraps up the latest round (ADR 0012): drafts its action items from its entries and ends it. Again on an ended round,
// replaces its action items.
export async function wrapUp(db: DatabaseSync, workspaceId: number): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const round = getRound(db, workspaceId)
  const entries = round
    ? (db.prepare(`select ${columns} from entries where review_round_id = ? order by id`).all(round.id) as ReviewEntry[])
    : []
  if (!round || !entries.length) return { status: 'error', message: 'Nothing to wrap up yet' }
  try {
    const { owner, name } = getWorkspaceRepo(db, workspaceId)
    const { structured } = await runClaude(
      worktreePath(owner, name, workspaceId),
      `${wrapUpPrompt}\n\n${formatStream(entries)}`,
      wrapUpSchema,
      '',
      true,
      wrapUpSystem,
    )
    const items = (structured as { items?: { text: string; entries: number[] }[] } | undefined)?.items ?? []
    const byNumber = (n: number) => entries[n - 1] as ReviewEntry | undefined
    // An item's anchor is its first cited entry's; an answer's or follow-up's is its question's.
    const anchorOf = (cited: ReviewEntry[]) =>
      cited.map((e) => (e.parentId ? entries.find((x) => x.id === e.parentId) : e)).find((e) => e?.path)
    const insert = db.prepare(
      `insert into action_items (review_round_id, position, body, entry_ids, path, side, start_line, end_line, code, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const now = new Date().toISOString()
    db.exec('begin')
    try {
      db.prepare('delete from action_items where review_round_id = ?').run(round.id)
      items
        .filter((item) => item.text?.trim())
        .forEach((item, position) => {
          const cited = (item.entries ?? []).map(byNumber).filter((e) => e !== undefined)
          const a = anchorOf(cited)
          insert.run(round.id, position, item.text.trim(), JSON.stringify(cited.map((e) => e.id)),
            a?.path ?? null, a?.side ?? null, a?.startLine ?? null, a?.endLine ?? null, a?.code ?? null, now)
        })
      db.prepare('update review_rounds set ended_at = coalesce(ended_at, ?) where id = ?').run(now, round.id)
      db.exec('commit')
    } catch (e) {
      db.exec('rollback')
      throw e
    }
    return { status: 'ok' }
  } catch (e) {
    return { status: 'error', message: (e as Error).message }
  }
}
