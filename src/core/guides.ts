import { run } from './agents'
import type { Db } from './db'
import { type ChangedFile, diffFingerprints, listChangedFiles, openedWorktree, readFileDiff } from './git'

// A guide (glossary): the workspace's file diffs in groups, each about one theme, with a title, a short description
// of what the reviewer is looking at, and a note on each file diff. Made by Claude Code; stored, since nobody else has it.
// notes: by path. Missing on guides made before notes, and on a group not described yet. tags: see guideTags.
export type GuideGroup = { title: string; description: string; paths: string[]; notes?: Record<string, string>; tags?: GuideTag[] }
// Tags the agent can put on a group (glossary). generated: files made by a tool, not written by hand; the group is
// low-lighted and comes last.
export const guideTags = ['generated'] as const
export type GuideTag = (typeof guideTags)[number]
// model: the models that made it, as Claude Code reported them. The diff it was made from (ADR 0014): kind 'all' is
// the merge base → the PR head then (head; null for a guide from before, which shows the live diff), kind 'commit'
// one commit's diff, mergeBase being the commit's parent.
// createdAt: when it was grouped and first stored. finishedAt: null while its groups are still being described, or
// if that was cut off (the app quit).
export type Guide = {
  id: number
  workspaceId: number
  mergeBase: string
  head: string | null
  kind: 'all' | 'commit'
  model: string
  groups: GuideGroup[]
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
export type GuideResult = { status: 'ok'; guide: Guide } | { status: 'error'; message: string }
// How far making a guide has got (ADR 0010): batches summarised, then grouping, then groups described. guide: the
// stored guide once grouped, filled in as groups are described.
export type GuideProgress = {
  phase: 'summarising' | 'grouping' | 'describing'
  done: number
  total: number
  guide: Guide | null
}

// The guide prompt and models can be changed in Settings. model groups the files and describes the groups;
// summaryModel summarises each file first. An empty model means Claude Code's own default.
export type GuideSettings = { prompt: string; model: string; summaryModel: string; defaultPrompt: string }
export type GuideSettingsChange = Omit<GuideSettings, 'defaultPrompt'>

const defaultPrompt = `You are helping a reviewer read a pull request. Sort its changed files into groups, each about one theme
(a feature, a refactor, tests, configuration, ...), in the order a reviewer should read them: the core change
first, supporting changes after. Give each group a short title and a description of one to three sentences
saying what the reviewer is looking at and what to check, and each file a note of one sentence saying what
to look at in it. Every changed file goes in exactly one group. Put files made by a tool rather than written
by hand (lockfiles, generated API clients or models, snapshots, build output, migrations dumped by a tool) in
groups of their own, tagged "generated".`

// Claude Code's own system prompt is for coding; replaced, since everything these calls need is in the message.
const systemPrompt =
  'You help a reviewer read a pull request. Everything you need is in the message; you have no tools but the answer tool.'

// The answers' shapes, which the user can't change. Files are referred to by their number in the prompt, which
// is much less to write than their paths.
const summarySchema = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'integer' }, summary: { type: 'string' } },
        required: ['file', 'summary'],
      },
    },
  },
  required: ['files'],
}

const groupSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'integer' }, description: 'The numbers of its files' },
          tags: {
            type: 'array',
            items: { enum: guideTags },
            description: '"generated": its files are made by a tool, not written by hand',
          },
        },
        required: ['title', 'files'],
      },
    },
  },
  required: ['groups'],
}

const describeSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'integer' }, note: { type: 'string' } },
        required: ['file', 'note'],
      },
    },
  },
  required: ['description', 'files'],
}

// ADR 0010. Diffs go in the prompts, cut to fileLines lines each. Files needing a summary are cut into batches of
// runs in path order, so a batch tends to be one folder. A group is described from its diffs up to groupLines
// lines; its other files from their summaries.
// ponytail: fixed sizes, guessed from #5311; make them settings if other PRs want different ones.
const fileLines = 300
const batchFiles = 25
const batchLines = 1200
const groupLines = 3000
const parallel = 16

export async function getGuideSettings(db: Db): Promise<GuideSettings> {
  const rows = await db.selectFrom('settings').select(['key', 'value']).where('key', 'in', ['guide.prompt', 'guide.model', 'guide.summary-model']).execute()
  const get = (key: string) => rows.find((r) => r.key === key)?.value
  return {
    prompt: get('guide.prompt') ?? defaultPrompt,
    model: get('guide.model') ?? '',
    summaryModel: get('guide.summary-model') ?? 'haiku',
    defaultPrompt,
  }
}

export async function setGuideSettings(db: Db, s: GuideSettingsChange) {
  const set = (key: string, value: string) =>
    db
      .insertInto('settings')
      .values({ key, value })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
      .execute()
  // Saving the default prompt stores nothing, so a later change to the default reaches the user.
  if (!s.prompt.trim() || s.prompt.trim() === defaultPrompt) await db.deleteFrom('settings').where('key', '=', 'guide.prompt').execute()
  else await set('guide.prompt', s.prompt.trim())
  await set('guide.model', s.model.trim())
  await set('guide.summary-model', s.summaryModel.trim())
}

const columns = [
  'id',
  'workspace_id as workspaceId',
  'merge_base as mergeBase',
  'head',
  'kind',
  'model',
  'groups',
  'created_at as createdAt',
  'started_at as startedAt',
  'finished_at as finishedAt',
] as const
const fromRow = <R extends { groups: string }>(r: R): Omit<R, 'groups'> & { groups: GuideGroup[] } => ({ ...r, groups: JSON.parse(r.groups) })

// The workspace's latest guide: to all changes from this merge base, or to one commit. One to all changes from
// another merge base (the PR was rebased or its base moved) doesn't match the file diffs any more, so it isn't shown.
// ponytail: a commit guide stays even if a rebase drops the commit from the PR; check it's still in listCommits if so.
export async function getGuide(db: Db, workspaceId: number, mergeBase: string): Promise<Guide | null> {
  const row = await db
    .selectFrom('guides')
    .select(columns)
    .where('workspace_id', '=', workspaceId)
    .where((eb) => eb.or([eb('kind', '=', 'commit'), eb('merge_base', '=', mergeBase)]))
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ? fromRow(row) : null
}

// Guides being made, by workspace, so opening the Guide tab again waits for the same one and hears its progress.
type Run = { result: Promise<GuideResult>; progress: GuideProgress; listeners: Set<(p: GuideProgress) => void> }
const making = new Map<number, Run>()

// Asks Claude Code for a new guide to the workspace's diff and stores it. Takes a while (tens of seconds, minutes
// for a big PR); the guide is stored and reported once grouped, and filled in as its groups are described.
export function createGuide(
  db: Db,
  workspaceId: number,
  mergeBase: string,
  head: string,
  kind: Guide['kind'],
  onProgress: (p: GuideProgress) => void,
): Promise<GuideResult> {
  let run = making.get(workspaceId)
  if (!run) {
    const r: Run = { result: null!, progress: { phase: 'summarising', done: 0, total: 0, guide: null }, listeners: new Set() }
    const report = (p: GuideProgress) => {
      r.progress = p
      for (const l of r.listeners) l(p)
    }
    r.result = make(db, workspaceId, mergeBase, head, kind, report)
      .catch((e): GuideResult => ({ status: 'error', message: (e as Error).message }))
      .finally(() => making.delete(workspaceId))
    making.set(workspaceId, (run = r))
  }
  run.listeners.add(onProgress)
  onProgress(run.progress)
  return run.result
}

const changedLines = (f: ChangedFile) => Math.min(f.additions + f.deletions, fileLines)

async function make(
  db: Db,
  workspaceId: number,
  mergeBase: string,
  head: string,
  kind: Guide['kind'],
  report: (p: GuideProgress) => void,
): Promise<GuideResult> {
  const startedAt = new Date()
  const cwd = await openedWorktree(db, workspaceId)
  const changed = await listChangedFiles(db, workspaceId, mergeBase, head)
  if (changed.status !== 'ok') return { status: 'error', message: changed.message }
  const files = changed.files
  if (!files.length) return { status: 'error', message: 'No changes to guide' }
  const settings = await getGuideSettings(db)
  const number = new Map(files.map((f, i) => [f.path, i + 1]))
  const line = (f: ChangedFile) => `${number.get(f.path)}. ${f.status} +${f.additions} -${f.deletions} ${f.path}`
  // Each file's diff, read once and cut to fileLines lines.
  const diffs = new Map<string, Promise<string>>()
  const diffOf = (f: ChangedFile) => {
    let d = diffs.get(f.path)
    if (!d) {
      d = readFileDiff(db, workspaceId, mergeBase, f, head).then(
        (text) => {
          const lines = text.split('\n')
          return lines.length <= fileLines ? text : `${lines.slice(0, fileLines).join('\n')}\n… ${lines.length - fileLines} more lines`
        },
        (e) => `(couldn't read the diff: ${(e as Error).message})`,
      )
      diffs.set(f.path, d)
    }
    return d
  }
  const withDiff = async (f: ChangedFile) => `### ${line(f)}\n${await diffOf(f)}`

  // 1. Summarise: a sentence about each file, a batch per agent, several at once. A summary is kept while its
  // file diff is unchanged, so Regenerate and a PR that moved on only summarise what's new. A failed batch leaves
  // its files unsummarised.
  const fingerprints = await diffFingerprints(db, workspaceId, mergeBase, files.map((f) => f.path), head)
  const summaries = new Map<string, string>()
  const cached = await db
    .selectFrom('file_summaries')
    .select(['path', 'fingerprint', 'summary'])
    .where('workspace_id', '=', workspaceId)
    .execute()
  for (const c of cached) if (fingerprints.get(c.path) === c.fingerprint) summaries.set(c.path, c.summary)
  const todo = files.filter((f) => !summaries.has(f.path))
  const batches: ChangedFile[][] = []
  for (const f of todo) {
    const last = batches[batches.length - 1]
    const lines = last?.reduce((n, g) => n + changedLines(g), 0) ?? 0
    if (!last || last.length >= batchFiles || lines + changedLines(f) > batchLines) batches.push([f])
    else last.push(f)
  }
  const store = (path: string, fingerprint: string, summary: string) =>
    db
      .insertInto('file_summaries')
      .values({ workspace_id: workspaceId, path, fingerprint, summary })
      .onConflict((oc) => oc.columns(['workspace_id', 'path']).doUpdateSet({ fingerprint, summary }))
      .execute()
  let summaryModel: string | null = null
  let summarised = 0
  report({ phase: 'summarising', done: 0, total: batches.length, guide: null })
  await inParallel(batches, parallel, async (batch) => {
    const prompt = [
      "You are summarising part of a pull request for a reviewer. For each file below, write one short sentence saying what changed in it (and why, if the diff shows it). Don't review; be brief. Answer with each file's number; in the summaries, name files by path, never by number.",
      `Files (number, status, lines added and removed, path), each with its diff:\n\n${(await Promise.all(batch.map(withDiff))).join('\n\n')}`,
    ].join('\n\n')
    const out = await ask(cwd, prompt, summarySchema, settings.summaryModel, false).catch(() => null)
    const answers = (out?.answer as { files?: { file: number; summary: string }[] } | undefined)?.files ?? []
    for (const a of answers) {
      const f = batch.find((g) => number.get(g.path) === a.file)
      if (!f) continue
      summaries.set(f.path, String(a.summary))
      await store(f.path, fingerprints.get(f.path)!, String(a.summary))
    }
    summaryModel ??= out?.model ?? null
    report({ phase: 'summarising', done: ++summarised, total: batches.length, guide: null })
  })
  const summarisedAt = new Date()

  // 2. Group: one agent sorts all files into titled groups from the summaries, answering with file numbers only.
  report({ phase: 'grouping', done: 0, total: 1, guide: null })
  const listed = files.map((f) => (summaries.has(f.path) ? `${line(f)}: ${summaries.get(f.path)}` : line(f)))
  const grouped = await ask(
    cwd,
    [
      settings.prompt,
      "First, sort the files into groups and put the groups in reading order. Give each group only its title and its files' numbers; descriptions and notes are written later, a group at a time.",
      `Changed files (number, status, lines added and removed, path, and a summary of the change):\n${listed.join('\n')}`,
    ].join('\n\n'),
    groupSchema,
    settings.model,
  )
  const answer = (grouped.answer as { groups?: { title: string; files: number[]; tags?: string[] }[] } | undefined)?.groups
  if (!answer) return { status: 'error', message: 'Claude Code gave no guide' }
  // Keep only numbers of changed files, each in its first group, and drop groups left empty. Files the agent left
  // out go in a last group of their own.
  const seen = new Set<number>()
  const groups: GuideGroup[] = answer
    .map((g) => ({
      title: String(g.title),
      description: '',
      paths: g.files.filter((n) => n >= 1 && n <= files.length && !seen.has(n) && seen.add(n)).map((n) => files[n - 1].path),
      tags: guideTags.filter((t) => g.tags?.includes(t)),
    }))
    .filter((g) => g.paths.length)
  const rest = files.filter((_, i) => !seen.has(i + 1)).map((f) => f.path)
  if (rest.length) groups.push({ title: 'Other changes', description: '', paths: rest })
  groups.sort(lastIfGenerated)
  const model = [grouped.model ?? (settings.model || 'unknown'), summaryModel && `summaries by ${summaryModel}`]
    .filter(Boolean)
    .join(', ')
  let guide: Guide = fromRow(
    await db
      .insertInto('guides')
      .values({
        workspace_id: workspaceId,
        merge_base: mergeBase,
        head,
        kind,
        model,
        groups: JSON.stringify(groups),
        created_at: new Date().toISOString(),
        started_at: startedAt.toISOString(),
      })
      .returning(columns)
      .executeTakeFirstOrThrow(),
  )
  const groupedAt = new Date()

  // 3. Describe: an agent per group, several at once, writes its description and a note on each file, from the
  // group's diffs. Each is stored and reported as it arrives. A failed group is left without a description.
  const byPath = new Map(files.map((f) => [f.path, f]))
  const titles = groups.map((g, i) => `${i + 1}. ${g.title}`).join('\n')
  let described = 0
  report({ phase: 'describing', done: 0, total: groups.length, guide })
  await inParallel(
    groups.map((_, i) => i),
    parallel,
    async (i) => {
      const group = groups[i]
      let budget = groupLines
      const parts = await Promise.all(
        group.paths.map((p) => {
          const f = byPath.get(p)!
          const inline = budget > 0
          budget -= changedLines(f)
          return inline ? withDiff(f) : Promise.resolve(`### ${line(f)} (diff left out${summaries.has(p) ? `; summary: ${summaries.get(p)}` : ''})`)
        }),
      )
      const prompt = [
        settings.prompt,
        `The files are already sorted into these groups, in reading order:\n${titles}`,
        `Now write group ${i + 1}, "${group.title}": its description, and a note on each of its files. Answer with each file's number; in the description and notes, name files by path, never by number: the reader doesn't see the numbers.`,
        `Its files (number, status, lines added and removed, path), each with its diff:\n\n${parts.join('\n\n')}`,
      ].join('\n\n')
      const out = await ask(cwd, prompt, describeSchema, settings.model).catch(() => null)
      const d = out?.answer as { description?: string; files?: { file: number; note: string }[] } | undefined
      if (d?.description) {
        const notes: Record<string, string> = {}
        for (const n of d.files ?? []) {
          const p = files[n.file - 1]?.path
          if (p && group.paths.includes(p)) notes[p] = String(n.note)
        }
        guide = { ...guide, groups: guide.groups.map((g, j) => (j === i ? { ...g, description: String(d.description), notes } : g)) }
        await db.updateTable('guides').set({ groups: JSON.stringify(guide.groups) }).where('id', '=', guide.id).execute()
      }
      report({ phase: 'describing', done: ++described, total: groups.length, guide })
    },
  )
  const finishedAt = new Date()
  await db.updateTable('guides').set({ finished_at: finishedAt.toISOString() }).where('id', '=', guide.id).execute()
  guide = { ...guide, finishedAt: finishedAt.toISOString() }
  const s = (a: Date, b: Date) => `${Math.round((b.getTime() - a.getTime()) / 1000)} s`
  console.log(
    `guide ${guide.id}: ${files.length} files, ${batches.length} batches (${files.length - todo.length} summaries reused) in ${s(startedAt, summarisedAt)}, grouped in ${s(summarisedAt, groupedAt)}, ${groups.length} groups described in ${s(groupedAt, finishedAt)}; ${s(startedAt, finishedAt)} in all`,
  )
  return { status: 'ok', guide }
}

// Generated groups go last, the rest keep their order (sort is stable). The Guide tab sorts the same way.
const lastIfGenerated = (a: { tags?: GuideTag[] }, b: { tags?: GuideTag[] }) =>
  Number(!!a.tags?.includes('generated')) - Number(!!b.tags?.includes('generated'))

// Runs fn on every item, at most n at once.
async function inParallel<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}

// One one-shot run with an answer schema (ADR 0018); resolves with the answer and the model the session ran on.
// One turn, no tools (ADR 0010): the diffs are in the prompt. No MCP servers but the answer tool, and Claude Code's
// system prompt replaced, so each call doesn't pay for tool definitions and instructions it won't use. thinking: false
// for summaries, one sentence per file read straight off the diff, where thinking cost about as many tokens as the
// answer.
export function ask(cwd: string, prompt: string, answer: object, model: string, thinking = true) {
  return run('claude', { cwd, prompt, answer, model, thinking, instructions: systemPrompt, tools: 'none', persist: false })
}
