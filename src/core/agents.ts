import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { DatabaseSync } from 'node:sqlite'
import { formatAsk } from './comments'
import { worktreePath } from './git'
import { getWorkspaceRepo } from './workspaces'

// ADR 0007: an agent session is Claude Code run as `claude -p`, one process per turn, resumed by its session ID.
export type AgentSession = { id: number; workspaceId: number; agentSessionId: string; createdAt: string }

// One line of the chat: something the user said, text the agent wrote, or a tool the agent used.
export type ChatEntry = { kind: 'user' | 'text' | 'tool'; text: string }

export type TurnResult = { status: 'ok' } | { status: 'error'; message: string }

const columns = 'id, workspace_id as workspaceId, agent_session_id as agentSessionId, created_at as createdAt'

// The workspace's agent sessions in L4, oldest first; the last one is the current one. Those asked from a
// comment belong to its thread and aren't listed.
export function listAgentSessions(db: DatabaseSync, workspaceId: number): AgentSession[] {
  return db
    .prepare(`select ${columns} from agent_sessions where workspace_id = ? and comment_id is null order by id`)
    .all(workspaceId) as AgentSession[]
}

export function startAgentSession(db: DatabaseSync, workspaceId: number): AgentSession {
  return db
    .prepare(
      `insert into agent_sessions (workspace_id, agent, agent_session_id, created_at) values (?, 'claude', ?, ?)
       returning ${columns}`,
    )
    .get(workspaceId, randomUUID(), new Date().toISOString()) as AgentSession
}

// An agent session in a comment's thread, asked about that comment. Its first turn is the comment itself.
export function startCommentSession(db: DatabaseSync, commentId: number): AgentSession {
  const session = db
    .prepare(
      `insert into agent_sessions (workspace_id, agent, agent_session_id, created_at, comment_id)
       select workspace_id, 'claude', ?, ?, id from comments where id = ?
       returning ${columns}`,
    )
    .get(randomUUID(), new Date().toISOString(), commentId) as AgentSession | undefined
  if (!session) throw new Error(`No comment ${commentId}`)
  return session
}

// Agent sessions run in their workspace's worktree, which opening the workspace creates (ADR 0008).
function agentWorktree(db: DatabaseSync, agentSessionId: string): string {
  const row = db.prepare('select workspace_id as id from agent_sessions where agent_session_id = ?').get(agentSessionId) as
    | { id: number }
    | undefined
  if (!row) throw new Error(`No agent session ${agentSessionId}`)
  const { owner, name } = getWorkspaceRepo(db, row.id)
  return worktreePath(owner, name, row.id)
}

// Claude Code keeps each transcript at ~/.claude/projects/<cwd, flattened>/<session ID>.jsonl.
// Searching for the file name avoids depending on how the cwd is flattened.
function transcriptPath(agentSessionId: string): string | undefined {
  const root = join(homedir(), '.claude', 'projects')
  try {
    for (const dir of readdirSync(root)) {
      if (readdirSync(join(root, dir)).includes(`${agentSessionId}.jsonl`))
        return join(root, dir, `${agentSessionId}.jsonl`)
    }
  } catch {}
  return undefined
}

// The same message shape appears in the transcript file and in `--output-format stream-json`.
type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown> }
type Line = { type?: string; isMeta?: boolean; message?: { content?: string | Block[] } }

function entriesOf(line: Line): ChatEntry[] {
  const content = line.message?.content
  if (line.isMeta || !content) return []
  if (line.type === 'user')
    return typeof content === 'string'
      ? [{ kind: 'user', text: content }]
      : content.filter((b) => b.type === 'text').map((b) => ({ kind: 'user', text: b.text ?? '' }))
  if (line.type !== 'assistant' || typeof content === 'string') return []
  return content.flatMap((b): ChatEntry[] => {
    if (b.type === 'text') return [{ kind: 'text', text: b.text ?? '' }]
    if (b.type === 'tool_use') return [{ kind: 'tool', text: toolSummary(b) }]
    return []
  })
}

// e.g. "Read src/a.ts", "Bash git status". ponytail: tool results aren't shown; add them collapsed under the call.
function toolSummary(b: Block): string {
  const arg = Object.values(b.input ?? {}).find((v) => typeof v === 'string') as string | undefined
  return arg ? `${b.name} ${arg.split('\n')[0].slice(0, 120)}` : String(b.name)
}

export function readTranscript(agentSessionId: string): ChatEntry[] {
  const path = transcriptPath(agentSessionId)
  if (!path) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((l) => {
      try {
        return entriesOf(JSON.parse(l))
      } catch {
        return []
      }
    })
}

const running = new Map<string, ChildProcess>()

// Sends one message, with any comments put in front of it (an ask), and streams the agent's reply as chat
// entries until the turn ends.
// ponytail: relies on PATH to find `claude`, like `gh`; and permission prompts aren't surfaced, so
// only file edits in the worktree are pre-approved (ADR 0008); other tools that need approval, like most Bash
// commands, are refused. Add --permission-prompt-tool to ask the user.
export function runTurn(
  db: DatabaseSync,
  agentSessionId: string,
  message: string,
  commentIds: number[],
  onEntry: (entry: ChatEntry) => void,
): Promise<TurnResult> {
  if (running.has(agentSessionId)) return Promise.resolve({ status: 'error', message: 'A turn is already running' })
  const cwd = agentWorktree(db, agentSessionId)
  if (!existsSync(join(cwd, '.git'))) return Promise.resolve({ status: 'error', message: 'The worktree is not ready yet' })
  const prompt = formatAsk(db, commentIds, message)
  const session = transcriptPath(agentSessionId) ? ['--resume', agentSessionId] : ['--session-id', agentSessionId]
  const child = spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', ...session], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  running.set(agentSessionId, child)
  onEntry({ kind: 'user', text: prompt })

  let error: string | undefined
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  createInterface({ input: child.stdout }).on('line', (l) => {
    try {
      const line = JSON.parse(l)
      if (line.type === 'result' && line.is_error) error = line.result ?? line.subtype
      // The user's own message is already shown; stream-json only echoes tool results as user lines.
      if (line.type === 'assistant') entriesOf(line).forEach(onEntry)
    } catch {}
  })

  return new Promise((resolve) => {
    child.on('error', (e) => {
      running.delete(agentSessionId)
      const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
      resolve({ status: 'error', message: missing ? 'Claude Code (claude) is not installed or not on PATH' : e.message })
    })
    child.on('close', (code, signal) => {
      running.delete(agentSessionId)
      if (signal) resolve({ status: 'error', message: 'Stopped' })
      else if (error || code) resolve({ status: 'error', message: error ?? (stderr.trim() || `claude exited with ${code}`) })
      else resolve({ status: 'ok' })
    })
  })
}

export function stopTurn(agentSessionId: string) {
  running.get(agentSessionId)?.kill()
}

export function stopAllTurns() {
  for (const child of running.values()) child.kill()
}
