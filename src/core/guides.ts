import type { McpTool } from './agents'
import type { Db } from './db'
import { type ChangedFile, listChangedFiles, openedBefore, openWorktree, readTexts } from './git'

// ADR 0023: a guide (glossary) is made by the agent pane's session with the tools below. It's pinned to base → head,
// the merge base → the PR head when it was started, and holds its guide groups; its explanations and findings are
// entries with its id. Every guide is kept.
// notes: a file note by path. tags: see guideTags.
export type GuideGroup = { title: string; description: string; paths: string[]; notes: Record<string, string>; tags: GuideTag[] }
// Tags the agent can put on a group (glossary). generated: files made by a tool, not written by hand; the group is
// low-lighted and comes last.
export const guideTags = ['generated'] as const
export type GuideTag = (typeof guideTags)[number]
export type Guide = { id: number; workspaceId: number; base: string; head: string; groups: GuideGroup[]; createdAt: string }

const columns = ['id', 'workspace_id as workspaceId', 'base', 'head', 'groups', 'created_at as createdAt'] as const
const fromRow = <R extends { groups: string }>(r: R): Omit<R, 'groups'> & { groups: GuideGroup[] } => ({ ...r, groups: JSON.parse(r.groups) })

// The workspace's guides, newest first.
export async function listGuides(db: Db, workspaceId: number): Promise<Guide[]> {
  const rows = await db.selectFrom('guides').select(columns).where('workspace_id', '=', workspaceId).orderBy('id', 'desc').execute()
  return rows.map(fromRow)
}

// Told when a tool changed a workspace's guide or its entries, so the UI refetches them while the agent works.
const listeners = new Set<(workspaceId: number) => void>()
export function onGuideChange(listener: (workspaceId: number) => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const tell = (workspaceId: number) => listeners.forEach((l) => l(workspaceId))

// The messages *Make a Guide* and *Make a Guide with Review* put in the agent pane's composer. How to guide is in
// start_guide's result, so a guide asked for in the agent's own words is made the same way.
export const guideRequest = (review: boolean) =>
  review
    ? "Make a guide to this PR's changes with coxswain's tools, and review them: add findings where you see bugs, risks or better ways."
    : "Make a guide to this PR's changes with coxswain's tools."

const howToGuide = `How to make the guide:
- Read the diffs, and the code around them where it helps.
- Sort the changed files into groups, each about one theme (a feature, a refactor, tests, configuration, ...), and add
  them with add_group in the order a reviewer should read them: the core change first, supporting changes after.
  Give each group a short title, a description of one to three sentences saying what the reviewer is looking at and
  what to check, and each file a note of one sentence saying what to look at in it. Every changed file goes in
  exactly one group. Put files made by a tool rather than written by hand (lockfiles, generated clients or models,
  snapshots, build output) in groups of their own, marked generated.
- Where lines need explaining (a subtle condition, why something moved, how pieces connect), add an explanation on
  them with add_explanation. Explain; don't judge. A few good ones beat many obvious ones.
- Only if the user asked for a review: add findings with add_finding on lines where you see a bug, a risk, a missing
  case or a better way. Otherwise add none.
- When you're done, say in a few lines what the PR does and how the guide is laid out. The guide shows in the app as
  you add to it; don't repeat it in the chat.`

// The files of a guide's range, to check the tools' paths against.
async function changedFiles(db: Db, g: Pick<Guide, 'workspaceId' | 'base' | 'head'>): Promise<ChangedFile[]> {
  const listed = await listChangedFiles(db, g.workspaceId, g.base, g.head)
  if (listed.status !== 'ok') throw new Error(listed.message)
  return listed.files
}

async function latestGuide(db: Db, workspaceId: number): Promise<Guide> {
  const row = await db.selectFrom('guides').select(columns).where('workspace_id', '=', workspaceId).orderBy('id', 'desc').limit(1).executeTakeFirst()
  if (!row) throw new Error('No guide yet: call start_guide first')
  return fromRow(row)
}

const anchorSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'The file, as listed by start_guide' },
    side: { enum: ['new', 'old'], description: '"new": lines of the file at the head; "old": removed lines, at the base' },
    start_line: { type: 'integer' },
    end_line: { type: 'integer' },
    body: { type: 'string', description: 'Markdown' },
  },
  required: ['path', 'side', 'start_line', 'end_line', 'body'],
}
type AnchorArgs = { path: string; side: 'new' | 'old'; start_line: number; end_line: number; body: string }

// An explanation or finding on lines of the latest guide's range, with the code it's on (ADR 0015).
async function addOnLines(db: Db, workspaceId: number, kind: 'explanation' | 'finding', a: AnchorArgs): Promise<string> {
  const guide = await latestGuide(db, workspaceId)
  const file = (await changedFiles(db, guide)).find((f) => f.path === a.path)
  if (!file) throw new Error(`${a.path} isn't changed in the guide's range`)
  const [start, end] = [a.start_line, a.end_line].sort((x, y) => x - y)
  const commit = a.side === 'old' ? guide.base : guide.head
  const readPath = a.side === 'old' ? (file.previousPath ?? a.path) : a.path
  const text = (await readTexts(db, workspaceId, [readPath], commit)).get(readPath)
  if (text == null) throw new Error(`${a.path} has no ${a.side} side`)
  const lines = text.split('\n')
  if (start < 1 || end > lines.length) throw new Error(`${a.path} has ${lines.length} lines on the ${a.side} side`)
  if (!a.body.trim()) throw new Error('body is empty')
  await db
    .insertInto('entries')
    .values({
      workspace_id: workspaceId,
      kind,
      body: a.body.trim(),
      parent_id: null,
      guide_id: guide.id,
      path: a.path,
      side: a.side,
      start_line: start,
      end_line: end,
      code: lines.slice(start - 1, end).join('\n'),
      base: guide.base,
      head: guide.head,
      created_at: new Date().toISOString(),
    })
    .execute()
  tell(workspaceId)
  return `Added the ${kind} on ${a.path}:${start}${end > start ? `-${end}` : ''}.`
}

// The agent pane's tools for a workspace (ADR 0023).
export function guideTools(db: Db, workspaceId: number): McpTool[] {
  return [
    {
      name: 'start_guide',
      description:
        "Start a new guide to the PR's changes in coxswain, the app the user reads them in. The guide shows the changed files in groups, in reading order, with explanations on lines. Returns the range the guide is pinned to, the changed files and how to make the guide.",
      inputSchema: { type: 'object', properties: {} },
      call: async () => {
        const at = (await openedBefore(db, workspaceId)) ?? (await openWorktree(db, workspaceId))
        if (at.status !== 'ok') throw new Error('message' in at ? at.message : `GitHub: ${at.status}`)
        const files = await changedFiles(db, { workspaceId, base: at.mergeBase, head: at.head })
        if (!files.length) throw new Error('The PR has no changes to guide')
        const { id } = await db
          .insertInto('guides')
          .values({ workspace_id: workspaceId, base: at.mergeBase, head: at.head, created_at: new Date().toISOString() })
          .returning('id')
          .executeTakeFirstOrThrow()
        tell(workspaceId)
        const listed = files.map((f) => `${f.status} +${f.additions} -${f.deletions} ${f.previousPath ? `${f.previousPath} -> ` : ''}${f.path}`)
        return [
          `Guide ${id} started. It's pinned to ${at.mergeBase} (the merge base) → ${at.head} (the PR head); local changes aren't in it.`,
          `Read a diff with \`git diff ${at.mergeBase} ${at.head} -- <path>\`. Line numbers are the file's at the head (side "new") or, for removed lines, at the base (side "old").`,
          `Changed files (status, lines added and removed, path):\n${listed.join('\n')}`,
          howToGuide,
        ].join('\n\n')
      },
    },
    {
      name: 'add_group',
      description: 'Add a group of changed files to the guide, after the groups added so far. Call start_guide first.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string', description: 'One to three sentences, markdown' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, note: { type: 'string', description: 'One sentence: what to look at in it' } },
              required: ['path', 'note'],
            },
          },
          generated: { type: 'boolean', description: 'Its files are made by a tool, not written by hand' },
        },
        required: ['title', 'description', 'files'],
      },
      call: async (g: { title: string; description: string; files: { path: string; note: string }[]; generated?: boolean }) => {
        const guide = await latestGuide(db, workspaceId)
        const changed = (await changedFiles(db, guide)).map((f) => f.path)
        const grouped = new Set(guide.groups.flatMap((x) => x.paths))
        for (const f of g.files) {
          if (!changed.includes(f.path)) throw new Error(`${f.path} isn't changed in the guide's range`)
          if (grouped.has(f.path)) throw new Error(`${f.path} is already in a group`)
          grouped.add(f.path)
        }
        if (!g.files.length) throw new Error('A group needs files')
        const group: GuideGroup = {
          title: g.title,
          description: g.description,
          paths: g.files.map((f) => f.path),
          notes: Object.fromEntries(g.files.map((f) => [f.path, f.note])),
          tags: g.generated ? ['generated'] : [],
        }
        await db
          .updateTable('guides')
          .set({ groups: JSON.stringify([...guide.groups, group]) })
          .where('id', '=', guide.id)
          .execute()
        tell(workspaceId)
        const left = changed.filter((p) => !grouped.has(p))
        return left.length ? `Added. ${left.length} files in no group yet: ${left.join(', ')}` : 'Added. Every changed file is in a group.'
      },
    },
    {
      name: 'add_explanation',
      description: 'Explain lines of a changed file in the guide: what they do and why, to help the user read them. Call start_guide first.',
      inputSchema: anchorSchema,
      call: (a: AnchorArgs) => addOnLines(db, workspaceId, 'explanation', a),
    },
    {
      name: 'add_finding',
      description:
        'Add a review finding on lines of a changed file in the guide: a bug, risk, missing case or better way. Only when the user asked for a review. Call start_guide first.',
      inputSchema: anchorSchema,
      call: (a: AnchorArgs) => addOnLines(db, workspaceId, 'finding', a),
    },
  ]
}
