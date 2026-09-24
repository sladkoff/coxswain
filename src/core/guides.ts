import { type ChildProcess, spawn } from 'node:child_process'
import type { DatabaseSync } from 'node:sqlite'
import { type ChangedFile, listChangedFiles, openedWorktree } from './git'

// A guide (glossary): the workspace's file diffs in groups, each about one theme, with a title and a short
// description of what the reviewer is looking at. Made by Claude Code, which reads the diff itself; stored, since nobody else has it.
export type GuideGroup = { title: string; description: string; paths: string[] }
// model: the model that made it, as Claude Code reported it. mergeBase: the diff it was made from.
export type Guide = { id: number; workspaceId: number; mergeBase: string; model: string; groups: GuideGroup[]; createdAt: string }
export type GuideResult = { status: 'ok'; guide: Guide } | { status: 'error'; message: string }
// How far making a guide has got: batches summarised of all (0 of 0 for a small PR, which skips summarising),
// how many are summarised at once, and whether the files are being grouped.
export type GuideProgress = { summarised: number; batches: number; parallel: number; grouping: boolean }

// The guide prompt and models can be changed in Settings. model groups the files; summaryModel summarises batches of
// files first when a PR is big. An empty model means Claude Code's own default.
export type GuideSettings = { prompt: string; model: string; summaryModel: string; defaultPrompt: string }
export type GuideSettingsChange = Omit<GuideSettings, 'defaultPrompt'>

const defaultPrompt = `You are helping a reviewer read a pull request. Sort its changed files into groups, each about one theme
(a feature, a refactor, tests, configuration, ...), in the order a reviewer should read them: the core change
first, supporting changes after. Give each group a short title and a description of one to three sentences
saying what the reviewer is looking at and what to check. Every changed file goes in exactly one group.`

// The answer's shape, which the user can't change.
const schema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Changed file paths, exactly as listed' },
        },
        required: ['title', 'description', 'paths'],
      },
    },
  },
  required: ['groups'],
}

const summarySchema = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, summary: { type: 'string' } },
        required: ['path', 'summary'],
      },
    },
  },
  required: ['files'],
}

// A PR with more than one batch is summarised batch by batch in parallel first, then grouped from the summaries.
// Batches are runs of files in path order, so a batch tends to be one folder.
// ponytail: fixed sizes and no cache; summaries are made again on every Regenerate. Cache them by
// diffFingerprint if regenerating big PRs is slow.
const batchFiles = 40
const batchLines = 2000
const parallel = 8

export function getGuideSettings(db: DatabaseSync): GuideSettings {
  const get = (key: string) =>
    (db.prepare('select value from settings where key = ?').get(key) as { value: string } | undefined)?.value
  return {
    prompt: get('guide.prompt') ?? defaultPrompt,
    model: get('guide.model') ?? '',
    summaryModel: get('guide.summary-model') ?? 'haiku',
    defaultPrompt,
  }
}

export function setGuideSettings(db: DatabaseSync, s: GuideSettingsChange) {
  const set = db.prepare(
    'insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
  )
  // Saving the default prompt stores nothing, so a later change to the default reaches the user.
  if (!s.prompt.trim() || s.prompt.trim() === defaultPrompt) db.prepare("delete from settings where key = 'guide.prompt'").run()
  else set.run('guide.prompt', s.prompt.trim())
  set.run('guide.model', s.model.trim())
  set.run('guide.summary-model', s.summaryModel.trim())
}

const columns = 'id, workspace_id as workspaceId, merge_base as mergeBase, model, groups, created_at as createdAt'
type Row = Omit<Guide, 'groups'> & { groups: string }
const fromRow = (r: Row): Guide => ({ ...r, groups: JSON.parse(r.groups) })

// The latest guide to the workspace's diff from this merge base. One from another merge base (the PR was rebased
// or its base moved) doesn't match the file diffs any more, so it isn't shown.
export function getGuide(db: DatabaseSync, workspaceId: number, mergeBase: string): Guide | null {
  const row = db
    .prepare(`select ${columns} from guides where workspace_id = ? and merge_base = ? order by id desc limit 1`)
    .get(workspaceId, mergeBase) as Row | undefined
  return row ? fromRow(row) : null
}

// Guides being made, by workspace, so opening the Guide tab again waits for the same one and hears its progress.
type Run = { result: Promise<GuideResult>; progress: GuideProgress; listeners: Set<(p: GuideProgress) => void> }
const making = new Map<number, Run>()
const children = new Set<ChildProcess>()

// Asks Claude Code for a new guide to the workspace's diff and stores it. Takes a while (tens of seconds, minutes
// for a big PR).
export function createGuide(
  db: DatabaseSync,
  workspaceId: number,
  mergeBase: string,
  onProgress: (p: GuideProgress) => void,
): Promise<GuideResult> {
  let run = making.get(workspaceId)
  if (!run) {
    const r: Run = { result: null!, progress: { summarised: 0, batches: 0, parallel, grouping: false }, listeners: new Set() }
    const report = (p: GuideProgress) => {
      r.progress = p
      for (const l of r.listeners) l(p)
    }
    r.result = make(db, workspaceId, mergeBase, report)
      .catch((e): GuideResult => ({ status: 'error', message: (e as Error).message }))
      .finally(() => making.delete(workspaceId))
    making.set(workspaceId, (run = r))
  }
  run.listeners.add(onProgress)
  onProgress(run.progress)
  return run.result
}

const line = (f: ChangedFile) => `${f.status}\t+${f.additions} -${f.deletions}\t${f.path}`

async function make(
  db: DatabaseSync,
  workspaceId: number,
  mergeBase: string,
  report: (p: GuideProgress) => void,
): Promise<GuideResult> {
  const cwd = openedWorktree(db, workspaceId)
  const changed = await listChangedFiles(db, workspaceId, mergeBase)
  if (changed.status !== 'ok') return { status: 'error', message: changed.message }
  if (!changed.files.length) return { status: 'error', message: 'No changes to guide' }
  const settings = getGuideSettings(db)
  // No diff in the prompts: each agent reads the diffs it needs itself.
  const howToRead = `Read a file's diff with \`git diff --no-ext-diff ${mergeBase} -- <path>\`. An empty diff means a new, untracked file: read the file itself.`

  const batches: ChangedFile[][] = [[]]
  for (const f of changed.files) {
    const last = batches[batches.length - 1]
    const lines = last.reduce((n, g) => n + g.additions + g.deletions, 0)
    if (last.length && (last.length >= batchFiles || lines + f.additions + f.deletions > batchLines)) batches.push([f])
    else last.push(f)
  }
  // Map: a line about each file, a batch per agent, several at once. A failed batch leaves its files unsummarised.
  const summaries = new Map<string, string>()
  let summaryModel: string | null = null
  const mapped = batches.length > 1 ? batches.length : 0
  let summarised = 0
  report({ summarised, batches: mapped, parallel, grouping: false })
  if (mapped)
    await inParallel(batches, parallel, async (batch) => {
      const prompt = [
        'You are summarising part of a pull request for a reviewer. For each file below, write one short sentence saying what changed in it (and why, if the diff shows it). Don\'t review; be brief.',
        howToRead,
        `Files (status, lines added and removed, path):\n${batch.map(line).join('\n')}`,
      ].join('\n\n')
      const out = await runClaude(cwd, prompt, summarySchema, settings.summaryModel).catch(() => null)
      const files = (out?.structured as { files?: { path: string; summary: string }[] } | undefined)?.files ?? []
      for (const f of files) summaries.set(f.path, String(f.summary))
      summaryModel ??= out?.model ?? null
      report({ summarised: ++summarised, batches: mapped, parallel, grouping: false })
    })
  report({ summarised, batches: mapped, parallel, grouping: true })

  // Reduce: one agent groups all files, from the summaries when there are any.
  const listed = changed.files.map((f) => (summaries.has(f.path) ? `${line(f)}: ${summaries.get(f.path)}` : line(f)))
  const prompt = [
    settings.prompt,
    howToRead,
    `Changed files (status, lines added and removed, path${summaries.size ? ', and a summary of the change' : ''}):\n${listed.join('\n')}`,
  ].join('\n\n')
  const out = await runClaude(cwd, prompt, schema, settings.model)
  const groups = (out.structured as { groups?: GuideGroup[] } | undefined)?.groups
  if (!groups) return { status: 'error', message: 'Claude Code gave no guide' }

  // Keep only paths that are changed files, each in its first group, and drop groups left empty.
  const seen = new Set<string>()
  const known = new Set(changed.files.map((f) => f.path))
  const clean = groups
    .map((g) => ({
      title: String(g.title),
      description: String(g.description),
      paths: g.paths.filter((p) => known.has(p) && !seen.has(p) && seen.add(p)),
    }))
    .filter((g) => g.paths.length)
  const model = [out.model ?? (settings.model || 'unknown'), summaryModel && `summaries by ${summaryModel}`].filter(Boolean).join(', ')
  const row = db
    .prepare(
      `insert into guides (workspace_id, merge_base, model, groups, created_at) values (?, ?, ?, ?, ?) returning ${columns}`,
    )
    .get(workspaceId, mergeBase, model, JSON.stringify(clean), new Date().toISOString()) as Row
  return { status: 'ok', guide: fromRow(row) }
}

// Runs fn on every item, at most n at once.
async function inParallel<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}

// One `claude -p` with a JSON schema; resolves with its structured output and the model that did most of the work.
// ponytail: relies on PATH to find `claude`, like runTurn.
// Read-only: the only commands allowed are git's read commands. No MCP servers: a guide doesn't need them, and
// their tool definitions alone can overflow a small model's context.
async function runClaude(cwd: string, prompt: string, schema: object, model: string) {
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--strict-mcp-config']
  args.push('--tools', 'Read,Grep,Glob,Bash', '--allowedTools', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git log:*)')
  if (model) args.push('--model', model)
  const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  children.add(child)
  child.stdin.end(prompt) // on stdin: a long file list doesn't fit in the arguments
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stderr += d))
  const code = await new Promise<number | null>((done, fail) => {
    child.on('error', (e) =>
      fail((e as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('Claude Code (claude) is not installed or not on PATH') : e),
    )
    child.on('close', done)
  }).finally(() => children.delete(child))

  let out: { is_error?: boolean; result?: string; structured_output?: unknown; modelUsage?: Record<string, { outputTokens?: number }> }
  try {
    out = JSON.parse(stdout)
  } catch {
    throw new Error(stderr.trim() || `claude exited with ${code}`)
  }
  if (out.is_error) throw new Error(out.result || 'Claude Code failed')
  const usage = Object.entries(out.modelUsage ?? {}).sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0))
  return { structured: out.structured_output, model: usage[0]?.[0] ?? null }
}

export function stopGuides() {
  for (const child of children) child.kill()
}
