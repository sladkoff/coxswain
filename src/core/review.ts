import { type ChatEntry, newSession, type Permission, readyWorktree, type RunOptions, runTurn, stopTurn, type TurnResult } from './agents'
import type { Db } from './db'
import { readTexts } from './git'
import { ask } from './guides'

// ADR 0011: a review round is a stream of entries (glossary): notes, questions and answers.
// An entry's anchor is a line range of a file; side 'old' is the merge base (removed lines in a diff), 'new' the
// worktree. code: the lines as they were, since line numbers drift as the worktree changes. No anchor: it floats.
// base, head: the range of the view it was written in (ADR 0015); head null is the worktree (the live Diff tab).
export type Anchor = {
  path: string
  side: 'old' | 'new'
  startLine: number
  endLine: number
  code: string
  base: string
  head: string | null
}

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
  base: string | null
  head: string | null
  createdAt: string
  sentAt: string | null
  // In the view it was listed for (ADR 0015): current if its lines still read as its code; outdated if not; wrapped-up
  // if its round was. A follow-up or answer takes its question's. Floating entries are current.
  state: 'current' | 'outdated' | 'wrapped-up'
}

// A note or question from the user: anchored, or a follow-up in a thread (parentId).
export type NewEntry = { workspaceId: number; body: string; anchor?: Anchor; parentId?: number }

const columns = [
  'id',
  'review_round_id as reviewRoundId',
  'kind',
  'body',
  'parent_id as parentId',
  'path',
  'side',
  'start_line as startLine',
  'end_line as endLine',
  'code',
  'base',
  'head',
  'created_at as createdAt',
  'sent_at as sentAt',
] as const

// A round's entries in order.
const roundEntries = (db: Db, roundId: number): Promise<Omit<ReviewEntry, 'state'>[]> =>
  db.selectFrom('entries').select(columns).where('review_round_id', '=', roundId).orderBy('id').execute()

// The round new entries go in: the latest, unless it was wrapped up, which starts a new one (ADR 0012).
// ponytail: a round doesn't go stale when the code changes (glossary open question 3).
// A new round records the range its first entry was written in (ADR 0015).
async function currentRound(db: Db, workspaceId: number, anchor?: Anchor): Promise<number> {
  const row = await db
    .selectFrom('review_rounds')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('ended_at', 'is', null)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  if (row) return row.id
  const created = await db
    .insertInto('review_rounds')
    .values({ workspace_id: workspaceId, created_at: new Date().toISOString(), merge_base: anchor?.base ?? null, head: anchor?.head ?? null })
    .returning('id')
    .executeTakeFirstOrThrow()
  return created.id
}

// The latest round's entries, with their state in the view of base → head (the worktree without head).
export async function listEntries(db: Db, workspaceId: number, base: string, head?: string): Promise<ReviewEntry[]> {
  const round = await db
    .selectFrom('review_rounds')
    .select(['id', 'ended_at as endedAt'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  if (!round) return []
  const rows = await roundEntries(db, round.id)
  if (round.endedAt) return rows.map((e) => ({ ...e, state: 'wrapped-up' }))
  const anchored = rows.filter((e) => e.path && !e.parentId)
  const paths = (side: 'old' | 'new') => [...new Set(anchored.filter((e) => e.side === side).map((e) => e.path!))]
  const [oldTexts, newTexts] = await Promise.all([
    readTexts(db, workspaceId, paths('old'), base),
    readTexts(db, workspaceId, paths('new'), head),
  ])
  const current = (e: Omit<ReviewEntry, 'state'>) => {
    const text = (e.side === 'old' ? oldTexts : newTexts).get(e.path!) ?? ''
    return text.split('\n').slice(e.startLine! - 1, e.endLine!).join('\n') === e.code
  }
  const state = new Map(anchored.map((e) => [e.id, current(e) ? ('current' as const) : ('outdated' as const)]))
  return rows.map((e) => ({ ...e, state: state.get(e.parentId ?? e.id) ?? 'current' }))
}

function addEntry(db: Db, roundId: number, kind: ReviewEntry['kind'], e: Omit<NewEntry, 'workspaceId'>): Promise<Omit<ReviewEntry, 'state'>> {
  if (!e.body.trim()) throw new Error(`A ${kind} needs text`)
  const a = e.anchor
  if (a && a.side !== 'old' && a.side !== 'new') throw new Error(`Not a side: ${a.side}`)
  const [start, end] = a ? [a.startLine, a.endLine].sort((x, y) => x - y) : [null, null]
  return db
    .insertInto('entries')
    .values({
      review_round_id: roundId,
      kind,
      body: e.body.trim(),
      parent_id: e.parentId ?? null,
      path: a?.path ?? null,
      side: a?.side ?? null,
      start_line: start,
      end_line: end,
      code: a?.code ?? null,
      base: a?.base ?? null,
      head: a?.head ?? null,
      created_at: new Date().toISOString(),
    })
    .returning(columns)
    .executeTakeFirstOrThrow()
}

// A new entry is current in the view it was written in.
export async function addNote(db: Db, e: NewEntry): Promise<ReviewEntry> {
  return { ...(await addEntry(db, await currentRound(db, e.workspaceId, e.anchor), 'note', e)), state: 'current' }
}

export async function deleteEntry(db: Db, id: number) {
  await db.deleteFrom('entries').where('id', '=', id).execute()
}

function describe(a: Pick<ReviewEntry, 'path' | 'side' | 'startLine' | 'endLine' | 'code'> & Partial<Pick<ReviewEntry, 'base' | 'head'>>): string {
  const lines = a.startLine === a.endLine ? `line ${a.startLine}` : `lines ${a.startLine}-${a.endLine}`
  const at = (sha: string) => `commit ${sha.slice(0, 7)}`
  const where =
    a.side === 'old'
      ? `removed, as at ${a.base ? at(a.base) : 'the merge base'}`
      : a.head
        ? `as at ${at(a.head)}`
        : 'as in the worktree then'
  const fence = '`'.repeat(Math.max(3, ...[...(a.code ?? '').matchAll(/`+/g)].map((m) => m[0].length + 1)))
  return `\`${a.path}\` ${lines} (${where}):\n${fence}\n${a.code}\n${fence}`
}

// The prompt of an ask: the notes with where they point and the code they're about, then the user's message.
// Marks the notes as sent.
export async function formatAsk(db: Db, noteIds: number[], message: string, roundId?: number): Promise<string> {
  if (roundId) message = [await formatHandOff(db, roundId), message.trim()].filter(Boolean).join('\n\n')
  if (!noteIds.length) return message
  const found = await db.selectFrom('entries').select(columns).where('id', 'in', noteIds).where('kind', '=', 'note').execute()
  // In the order given, not the table's.
  const notes = noteIds.map((id) => found.find((n) => n.id === id)).filter((n) => n !== undefined)
  await db.updateTable('entries').set({ sent_at: new Date().toISOString() }).where('id', 'in', noteIds).where('kind', '=', 'note').execute()
  const parts = notes.map((n) => (n.path ? `Note on ${describe(n)}\n${n.body}` : `Note: ${n.body}`))
  return [...parts, message.trim()].filter(Boolean).join('\n\n')
}

// Questions may use every tool, but whatever would change something asks the user in the thread (ADR 0018, 8).
const questionOptions: Pick<RunOptions, 'tools' | 'mode'> = { tools: 'all', mode: 'ask' }

// The round's agent session for its questions (ADR 0011), made with its first question.
async function questionSession(db: Db, roundId: number, workspaceId: number): Promise<{ agentSessionId: string; first: boolean }> {
  const row = await db
    .selectFrom('agent_sessions')
    .select('agent_session_id as id')
    .where('review_round_id', '=', roundId)
    .executeTakeFirst()
  if (row) return { agentSessionId: row.id, first: false }
  const id = await newSession('claude', { cwd: await readyWorktree(db, workspaceId), ...questionOptions })
  await db
    .insertInto('agent_sessions')
    .values({ workspace_id: workspaceId, agent: 'claude', agent_session_id: id, created_at: new Date().toISOString(), review_round_id: roundId })
    .execute()
  return { agentSessionId: id, first: true }
}

const preamble =
  "I'm reviewing the changes in this worktree and will ask you questions about them, one at a time. " +
  "Answer briefly. Don't change any files.\n\n"

// Adds a question and asks it in the round's agent session, streaming the reply; the agent's text becomes an answer
// entry in the question's thread. Returns the question once saved, and the turn's result when it ends.
export async function askQuestion(
  db: Db,
  e: NewEntry,
  onChat: (threadId: number, entry: ChatEntry) => void,
  onPermission: (threadId: number, p: Permission) => Promise<string | null>,
): Promise<{ question: ReviewEntry; turn: Promise<TurnResult> }> {
  const question = await addEntry(db, await currentRound(db, e.workspaceId, e.anchor), 'question', e)
  const threadId = question.parentId ?? question.id
  const { agentSessionId, first } = await questionSession(db, question.reviewRoundId, e.workspaceId)
  const prompt = (first ? preamble : '') + (question.path ? `About ${describe(question)}\n${question.body}` : question.body)
  const texts: string[] = []
  const turn = runTurn(db, agentSessionId, prompt, questionOptions, {
    onEntry: (c) => {
      if (c.kind === 'text') texts.push(c.text)
      onChat(threadId, c)
    },
    onPermission: (p) => onPermission(threadId, p),
  }).then(async (result) => {
    if (result.status === 'ok' && texts.length)
      await addEntry(db, question.reviewRoundId, 'answer', { body: texts.join('\n\n'), parentId: threadId })
    return result
  })
  return { question: { ...question, state: 'current' }, turn }
}

export async function stopQuestion(db: Db, workspaceId: number) {
  const row = await db
    .selectFrom('agent_sessions')
    .select('agent_session_id as id')
    .where('review_round_id', '=', (eb) =>
      eb.selectFrom('review_rounds').select('id').where('workspace_id', '=', workspaceId).orderBy('id', 'desc').limit(1),
    )
    .executeTakeFirst()
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
// The latest round, as its bar shows it. ponytail: earlier rounds, and a wrapped-up round's entries (ADR 0015), aren't reachable until rounds get a history (ticket 0001).
export type ReviewRound = { id: number; number: number; createdAt: string; endedAt: string | null; actionItems: ActionItem[] }

const itemColumns = [
  'id',
  'review_round_id as reviewRoundId',
  'body',
  'entry_ids as entryIds',
  'path',
  'side',
  'start_line as startLine',
  'end_line as endLine',
  'code',
] as const

// A round's action items in order.
async function roundItems(db: Db, roundId: number): Promise<ActionItem[]> {
  const items = await db.selectFrom('action_items').select(itemColumns).where('review_round_id', '=', roundId).orderBy('position').execute()
  return items.map((i) => ({ ...i, entryIds: JSON.parse(i.entryIds) }))
}

export async function getRound(db: Db, workspaceId: number): Promise<ReviewRound | null> {
  const rounds = await db
    .selectFrom('review_rounds')
    .select(['id', 'created_at as createdAt', 'ended_at as endedAt'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('id')
    .execute()
  const round = rounds.at(-1)
  if (!round) return null
  return { ...round, number: rounds.length, actionItems: await roundItems(db, round.id) }
}

export async function updateActionItem(db: Db, id: number, body: string) {
  if (!body.trim()) throw new Error('An action item needs text')
  await db.updateTable('action_items').set({ body: body.trim() }).where('id', '=', id).execute()
}

export async function deleteActionItem(db: Db, id: number) {
  await db.deleteFrom('action_items').where('id', '=', id).execute()
}

// A round's entries, numbered from 1 in order; answers and follow-ups cite their question's number.
function formatStream(entries: Omit<ReviewEntry, 'state'>[]): string {
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
async function formatHandOff(db: Db, roundId: number): Promise<string> {
  const [entries, items] = await Promise.all([roundEntries(db, roundId), roundItems(db, roundId)])
  const list = items.map((item, i) => `${i + 1}. ${item.path ? `On ${describe(item)}\n` : ''}${item.body}`)
  return `Implement these action items from my review of this worktree's changes, in order:\n\n${list.join('\n\n')}

For context, the review round they came from: my notes and questions, and the answers, numbered, in order.
The numbers are the round's own, not the action items'. Where an item and the round disagree, the item wins.

${formatStream(entries)}`
}

const wrapUpSystem =
  'You help a reviewer finish reviewing a pull request. Everything you need is in the message; you have no tools but the answer tool.'

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
export async function wrapUp(db: Db, workspaceId: number): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const round = await getRound(db, workspaceId)
  const entries = round ? await roundEntries(db, round.id) : []
  if (!round || !entries.length) return { status: 'error', message: 'Nothing to wrap up yet' }
  try {
    const { answer } = await ask(await readyWorktree(db, workspaceId), `${wrapUpPrompt}\n\n${formatStream(entries)}`, wrapUpSchema, '', true, wrapUpSystem)
    const items = (answer as { items?: { text: string; entries: number[] }[] } | undefined)?.items ?? []
    const byNumber = (n: number) => entries[n - 1] as (typeof entries)[number] | undefined
    // An item's anchor is its first cited entry's; an answer's or follow-up's is its question's.
    const anchorOf = (cited: typeof entries) =>
      cited.map((e) => (e.parentId ? entries.find((x) => x.id === e.parentId) : e)).find((e) => e?.path)
    const now = new Date().toISOString()
    const rows = items
      .filter((item) => item.text?.trim())
      .map((item, position) => {
        const cited = (item.entries ?? []).map(byNumber).filter((e) => e !== undefined)
        const a = anchorOf(cited)
        return {
          review_round_id: round.id,
          position,
          body: item.text.trim(),
          entry_ids: JSON.stringify(cited.map((e) => e.id)),
          path: a?.path ?? null,
          side: a?.side ?? null,
          start_line: a?.startLine ?? null,
          end_line: a?.endLine ?? null,
          code: a?.code ?? null,
          created_at: now,
        }
      })
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('action_items').where('review_round_id', '=', round.id).execute()
      if (rows.length) await trx.insertInto('action_items').values(rows).execute()
      await trx
        .updateTable('review_rounds')
        .set((eb) => ({ ended_at: eb.fn.coalesce('ended_at', eb.val(now)) }))
        .where('id', '=', round.id)
        .execute()
    })
    return { status: 'ok' }
  } catch (e) {
    return { status: 'error', message: (e as Error).message }
  }
}
