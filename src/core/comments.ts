import type { DatabaseSync } from 'node:sqlite'

// A local comment (glossary): written in coxswain on a line range of a file, for agents.
// side: 'old' is the merge base (removed lines in a diff), 'new' is the worktree.
// code: the lines as they were when commented, since line numbers drift as the worktree changes.
// ponytail: anchored by line numbers only, so comments drift after edits; outdated tracking is glossary open question 2.
export type Comment = {
  id: number
  workspaceId: number
  path: string
  side: 'old' | 'new'
  startLine: number
  endLine: number
  code: string
  body: string
  createdAt: string
  sentAt: string | null
}

export type NewComment = Pick<Comment, 'workspaceId' | 'path' | 'side' | 'startLine' | 'endLine' | 'code' | 'body'>

const columns = `id, workspace_id as workspaceId, path, side, start_line as startLine, end_line as endLine, code, body,
  created_at as createdAt, sent_at as sentAt`

export function listComments(db: DatabaseSync, workspaceId: number): Comment[] {
  return db.prepare(`select ${columns} from comments where workspace_id = ? order by id`).all(workspaceId) as Comment[]
}

export function addComment(db: DatabaseSync, c: NewComment): Comment {
  if (c.side !== 'old' && c.side !== 'new') throw new Error(`Not a side: ${c.side}`)
  if (!c.body.trim()) throw new Error('A comment needs text')
  const [start, end] = [c.startLine, c.endLine].sort((a, b) => a - b)
  return db
    .prepare(
      `insert into comments (workspace_id, path, side, start_line, end_line, code, body, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?) returning ${columns}`,
    )
    .get(c.workspaceId, c.path, c.side, start, end, c.code, c.body.trim(), new Date().toISOString()) as Comment
}

export function deleteComment(db: DatabaseSync, id: number) {
  db.prepare('delete from comments where id = ?').run(id)
}

// The prompt of an ask: the comments with where they point and the code they're about, then the user's message.
// Marks the comments as sent.
export function formatAsk(db: DatabaseSync, commentIds: number[], message: string): string {
  if (!commentIds.length) return message
  const byId = db.prepare(`select ${columns} from comments where id = ?`)
  const comments = commentIds.map((id) => byId.get(id) as Comment | undefined).filter((c) => c !== undefined)
  const sent = db.prepare('update comments set sent_at = ? where id = ?')
  const now = new Date().toISOString()
  for (const c of comments) sent.run(now, c.id)
  const parts = comments.map((c) => {
    const lines = c.startLine === c.endLine ? `line ${c.startLine}` : `lines ${c.startLine}-${c.endLine}`
    const where = c.side === 'old' ? 'removed by the PR, as at its merge base' : 'as in the worktree when commented'
    const fence = '`'.repeat(Math.max(3, ...[...c.code.matchAll(/`+/g)].map((m) => m[0].length + 1)))
    return `Comment on \`${c.path}\` ${lines} (${where}):\n${fence}\n${c.code}\n${fence}\n${c.body}`
  })
  return [...parts, message.trim()].filter(Boolean).join('\n\n')
}
