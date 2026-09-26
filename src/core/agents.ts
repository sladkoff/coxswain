import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { delimiter, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type { Db } from './db'
import { worktreePath } from './git'
import { getWorkspaceRepo } from './workspaces'

// ADR 0018: every agent run is a session over the Agent Client Protocol, in one adapter process per agent. An agent
// session in L4, a question, a guide step and a wrap-up differ only in the options their session is opened with.
export type AgentSession = { id: number; workspaceId: number; agentSessionId: string; createdAt: string }

// One line of the chat: something the user said, text the agent wrote, or a tool the agent used.
export type ChatEntry = { kind: 'user' | 'text' | 'tool'; text: string }

export type TurnResult = { status: 'ok' } | { status: 'error'; message: string }

// A tool use the agent asks the user to approve (ADR 0018), with the options the agent offers: allow once, always,
// reject.
export type Permission = { id: string; title: string; options: { id: string; name: string; kind: string }[] }

// What coxswain means, not what an agent calls it. tools 'none': no tools, no MCP servers but the answer tool.
// instructions: a system prompt in place of the agent's own. persist false: a one-shot run, not kept in the agent's
// session list. mode 'auto': the agent's classifier decides what would ask (ADR 0013); 'ask': the user decides.
// answer: a JSON schema; the run resolves with the first answer that fits. session: carry on this agent session.
export type RunOptions = {
  cwd: string
  prompt: string
  session?: string
  model?: string
  tools?: 'all' | 'none'
  instructions?: string
  thinking?: boolean
  persist?: boolean
  mode?: 'auto' | 'ask'
  answer?: object
}
// onPermission resolves with the option picked, or null to cancel. Without it, every request is rejected.
export type RunHandlers = {
  onEntry?: (entry: ChatEntry) => void
  onPermission?: (p: Permission) => Promise<string | null>
}
export type RunResult = { sessionId: string; answer: unknown; model: string | null }

export type Agent = 'claude'

// Each agent is a record: how its adapter starts, and a run's options as its session/new _meta and permission modes.
const agents: Record<Agent, { start: () => { command: string; args: string[]; env: NodeJS.ProcessEnv }; meta: (o: RunOptions) => object; modes: Record<'auto' | 'ask', string> }> = {
  claude: {
    // Electron runs the adapter as Node. The user's own `claude` (ADR 0018, 5), not the one bundled with the SDK.
    start: () => ({
      command: process.execPath,
      args: [require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CLAUDE_CODE_EXECUTABLE: claudeOnPath() },
    }),
    // Names checked against the adapter's OPTION_REBUILDS_SESSION (0.81.2). The model isn't here: the adapter
    // prefers the user's settings over it, so it's set as a config option once the session is open.
    meta: (o) => ({
      claudeCode: {
        options: {
          // Agents the user runs (another Electron app, say) mustn't inherit Electron-as-Node from the adapter.
          env: { ELECTRON_RUN_AS_NODE: '' },
          ...(o.tools === 'none' && { tools: [], strictMcpConfig: true }),
          ...(o.instructions && { systemPrompt: o.instructions }),
          ...(o.thinking === false && { thinking: { type: 'disabled' } }),
          ...(o.persist === false && { persistSession: false }),
          ...(o.answer && { allowedTools: ['mcp__coxswain__answer'] }),
        },
      },
    }),
    modes: { auto: 'auto', ask: 'default' },
  },
}

// ponytail: PATH as the app got it, like `gh`; a login shell's PATH if coxswain is started from the Dock.
function claudeOnPath(): string {
  const found = (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'claude')).find(existsSync)
  if (!found) throw new Error('Claude Code (claude) is not installed or not on PATH')
  return found
}

// An adapter process and the sessions open in it. Started when first needed, kept while the app runs; one that
// exits is started again by the next run, which resumes its session there.
type Adapter = { child: ChildProcess; agent: acp.ClientContext; open: Set<string> }
const adapters = new Map<Agent, Promise<Adapter>>()
// Each running session's handlers, for the updates and permission requests the adapter sends.
const listening = new Map<string, Listener>()
type Listener = { update: (u: acp.SessionUpdate) => void; handlers: RunHandlers }
// Permission requests waiting for the user, by id.
const pending = new Map<string, { sessionId: string; resolve: (optionId: string | null) => void }>()

function adapter(name: Agent): Promise<Adapter> {
  let a = adapters.get(name)
  if (a) return a
  a = (async () => {
    const { command, args, env } = agents[name].start()
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'inherit'] })
    const conn = acp
      .client({ name: 'coxswain' })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) => askPermission(ctx.params))
      .onNotification(acp.methods.client.session.update, (ctx) => listening.get(ctx.params.sessionId)?.update(ctx.params.update))
      .connect(acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>))
    const gone = () => {
      if (adapters.get(name) === a) adapters.delete(name)
      conn.close(new Error(`The ${name} adapter stopped`))
    }
    child.on('exit', gone)
    child.on('error', gone)
    await conn.agent.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
    return { child, agent: conn.agent, open: new Set<string>() }
  })()
  a.catch(() => adapters.delete(name))
  adapters.set(name, a)
  return a
}

async function askPermission(p: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
  const ask = listening.get(p.sessionId)?.handlers.onPermission
  const reject = p.options.find((o) => o.kind === 'reject_once') ?? p.options.find((o) => o.kind.startsWith('reject'))
  if (!ask) return reject ? { outcome: { outcome: 'selected', optionId: reject.optionId } } : { outcome: { outcome: 'cancelled' } }
  const id = randomUUID()
  const optionId = await new Promise<string | null>((resolve) => {
    pending.set(id, { sessionId: p.sessionId, resolve })
    ask({ id, title: p.toolCall.title ?? 'Use a tool', options: p.options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })) }).then(resolve)
  })
  pending.delete(id)
  return optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }
}

// The user's pick for a permission request; null cancels it.
export function answerPermission(id: string, optionId: string | null) {
  pending.get(id)?.resolve(optionId)
}

// Turns a session's updates into chat entries. The last entry is held back until the next one starts, so streamed
// text arrives whole and a tool's title can still be filled in (its first update carries only the tool's kind).
function chat(onEntry: (e: ChatEntry) => void) {
  let last: (ChatEntry & { toolCallId?: string; name?: string | null }) | null = null
  const flush = () => {
    if (last && last.text.trim()) onEntry({ kind: last.kind, text: last.kind === 'tool' ? last.text : last.text.trim() })
    last = null
  }
  const update = (u: acp.SessionUpdate) => {
    // A subagent's updates carry the Agent call's id; L4 shows only the main thread, as before.
    if ((u as { _meta?: { claudeCode?: { parentToolUseId?: string } } })._meta?.claudeCode?.parentToolUseId) return
    if (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'user_message_chunk') {
      if (u.content.type !== 'text') return
      const kind = u.sessionUpdate === 'agent_message_chunk' ? 'text' : 'user'
      if (last?.kind !== kind) flush()
      last = { kind, text: (last?.text ?? '') + u.content.text }
    } else if (u.sessionUpdate === 'tool_call') {
      flush()
      last = { kind: 'tool', text: toolTitle(u), toolCallId: u.toolCallId, name: u.name }
    } else if (u.sessionUpdate === 'tool_call_update' && u.title && last?.toolCallId === u.toolCallId) {
      last = { ...last, text: toolTitle({ title: u.title, name: u.name ?? last.name }) }
    }
  }
  return { update, flush }
}

// e.g. "Read src/a.ts", "Bash git status". ponytail: tool results aren't shown; add them collapsed under the call.
function toolTitle(u: { title: string; name?: string | null }): string {
  const title = u.title.split('\n')[0].slice(0, 120)
  return u.name && !title.startsWith(u.name) ? `${u.name} ${title}` : title
}

// Opens a session for a run: a new one, or the given one, resumed if this adapter process hasn't got it open. Sets
// its model and permission mode.
async function openSession(name: Agent, o: RunOptions, mcpServers: acp.McpServer[]): Promise<{ a: Adapter; sessionId: string; model: string | null }> {
  const a = await adapter(name)
  const params = { cwd: o.cwd, mcpServers, _meta: agents[name].meta(o) as Record<string, unknown> }
  let config: acp.SessionConfigOption[] | null | undefined
  let sessionId = o.session ?? ''
  if (!sessionId) ({ sessionId, configOptions: config } = await a.agent.request(acp.methods.agent.session.new, params))
  else if (!a.open.has(sessionId)) ({ configOptions: config } = await a.agent.request(acp.methods.agent.session.resume, { ...params, sessionId }))
  a.open.add(sessionId)
  let model: string | null = null
  const models = config?.find((c) => c.category === 'model')
  if (models?.type === 'select') {
    const options = models.options.flatMap((x) => ('options' in x ? x.options : [x]))
    // The model's own ID, which Claude Code's "default" option has only in its description.
    const id = (value: string) => (value === 'default' && options.find((x) => x.value === value)?.description) || value
    // Without a model, the agent's own default. Left to itself the adapter resolves the user's settings model, and
    // some aliases differently from Claude Code ("opus[1m]" became Opus 4.8, not 5.5, in 0.81.2).
    // ponytail: so a model in the user's settings is ignored; resolve it like Claude Code if someone relies on it.
    const wanted = o.model || (options.some((x) => x.value === 'default') ? 'default' : '')
    model = id(models.currentValue)
    if (wanted) {
      const want = wanted.toLowerCase()
      // Exactly, then in part.
      const picked =
        options.find((x) => x.value === wanted || x.description === wanted) ??
        options.find((x) => `${x.value} ${x.name}`.toLowerCase().includes(want))
      if (!picked) throw new Error(`${name} has no model "${wanted}"`)
      if (picked.value !== models.currentValue)
        await a.agent.request(acp.methods.agent.session.setConfigOption, { sessionId, configId: models.id, value: picked.value })
      model = id(picked.value)
    }
  }
  if (o.mode) await a.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: agents[name].modes[o.mode] })
  return { a, sessionId, model }
}

// Opens a session without a turn, for an agent session whose ID is stored before its first message.
export async function newSession(name: Agent, o: Omit<RunOptions, 'prompt' | 'session'>): Promise<string> {
  return (await openSession(name, { ...o, prompt: '' }, [])).sessionId
}

// Runs one turn: sends the prompt and streams the reply as chat entries until the turn ends. With an answer schema,
// resolves with the first answer that fits and ends the turn there; a turn that ends without one fails. One-shot
// runs (persist false) close their session after.
export async function run(name: Agent, o: RunOptions, handlers: RunHandlers = {}): Promise<RunResult> {
  const answer = o.answer ? answerTool(o.answer) : null
  try {
    const mcpServers: acp.McpServer[] = answer ? [{ type: 'http', name: 'coxswain', url: await answer.url(), headers: [] }] : []
    const prompt = answer ? `${o.prompt}\n\nGive your answer by calling the \`answer\` tool.` : o.prompt
    const { a, sessionId, model } = await openSession(name, o, mcpServers)
    const { update, flush } = chat(handlers.onEntry ?? (() => {}))
    listening.set(sessionId, { update, handlers })
    try {
      const turn = a.agent.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: prompt }] })
      const answered = answer ? await Promise.race([answer.value.then((v) => ({ v })), turn.then(() => null)]) : null
      if (answered) {
        await a.agent.notify(acp.methods.agent.session.cancel, { sessionId })
        await turn.catch(() => {})
        return { sessionId, answer: answered.v, model }
      }
      const { stopReason } = await turn
      if (stopReason === 'cancelled') throw new Error('Stopped')
      if (answer) throw new Error(`${name} gave no answer`)
      if (stopReason === 'refusal') throw new Error(`${name} refused`)
      return { sessionId, answer: undefined, model }
    } finally {
      flush()
      listening.delete(sessionId)
      for (const [id, p] of pending) if (p.sessionId === sessionId) p.resolve(null)
      if (o.persist === false) {
        a.open.delete(sessionId)
        a.agent.request(acp.methods.agent.session.close, { sessionId }).catch(() => {})
      }
    }
  } finally {
    answer?.done()
  }
}

// Stops a session's turn; its run ends with 'Stopped'.
export async function cancel(name: Agent, sessionId: string) {
  const a = await adapters.get(name)?.catch(() => null)
  await a?.agent.notify(acp.methods.agent.session.cancel, { sessionId })
}

// A session's history as chat entries, replayed by session/load.
export async function history(name: Agent, sessionId: string, cwd: string): Promise<ChatEntry[]> {
  const a = await adapter(name)
  const entries: ChatEntry[] = []
  const { update, flush } = chat((e) => entries.push(e))
  const running = listening.get(sessionId)
  if (running) return [] // a turn is streaming it; it's read again when the turn ends
  listening.set(sessionId, { update, handlers: {} })
  try {
    await a.agent.request(acp.methods.agent.session.load, { sessionId, cwd, mcpServers: [], _meta: agents[name].meta({ cwd, prompt: '' }) as Record<string, unknown> })
    a.open.add(sessionId)
    flush()
    return entries
  } finally {
    listening.delete(sessionId)
  }
}

export async function stopAgents() {
  for (const a of adapters.values()) a.then((x) => x.child.kill(), () => {})
  server?.then((s) => s.close(), () => {})
}

// ADR 0018, 2: answer tools. One localhost HTTP MCP server for the app, a path per run, each path with a single
// tool, `answer`, whose input schema is the run's. It speaks just enough MCP (Streamable HTTP, JSON responses) for
// that one tool.
const answering = new Map<string, { schema: object; resolve: (v: unknown) => void }>()
let server: Promise<Server> | undefined

function answerTool(schema: object) {
  const path = randomUUID()
  let resolve!: (v: unknown) => void
  const value = new Promise<unknown>((r) => (resolve = r))
  answering.set(path, { schema, resolve })
  return {
    value,
    url: async () => `http://127.0.0.1:${((await answerServer()).address() as AddressInfo).port}/${path}`,
    done: () => answering.delete(path),
  }
}

function answerServer(): Promise<Server> {
  server ??= new Promise((resolve, reject) => {
    const s = createServer(async (req, res) => {
      const run = answering.get(req.url?.slice(1) ?? '')
      if (!run) return void res.writeHead(404).end()
      if (req.method !== 'POST') return void res.writeHead(405).end()
      let body = ''
      for await (const chunk of req) body += chunk
      let msg: { id?: string | number; method?: string; params?: { protocolVersion?: string; arguments?: unknown } }
      try {
        msg = JSON.parse(body)
      } catch {
        return void res.writeHead(400).end()
      }
      if (msg.id === undefined) return void res.writeHead(202).end() // a notification
      const reply = (r: { result: object } | { error: { code: number; message: string } }) =>
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...r }))
      if (msg.method === 'initialize')
        return reply({ result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'coxswain', version: '0' } } })
      if (msg.method === 'ping') return reply({ result: {} })
      if (msg.method === 'tools/list')
        return reply({ result: { tools: [{ name: 'answer', description: 'Give your answer. Call it once, with the whole answer.', inputSchema: run.schema }] } })
      if (msg.method === 'tools/call') {
        const problem = mismatch(run.schema, msg.params?.arguments)
        if (!problem) run.resolve(msg.params?.arguments)
        const text = problem ? `The answer doesn't fit: ${problem}. Call answer again with all of it.` : 'Answer received.'
        return reply({ result: { isError: !!problem, content: [{ type: 'text', text }] } })
      }
      reply({ error: { code: -32601, message: `No method ${msg.method}` } })
    })
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  return server
}

// Why value doesn't fit schema, or null if it does.
// ponytail: checks only what our schemas use (type, properties, required, items, enum); a validator library if they
// grow.
type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: readonly unknown[] }
export function mismatch(s: Schema, v: unknown, at = 'answer'): string | null {
  if (s.enum && !s.enum.includes(v)) return `${at} must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`
  if (s.type === 'object') {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${at} must be an object`
    const o = v as Record<string, unknown>
    for (const k of s.required ?? []) if (!(k in o)) return `${at}.${k} is missing`
    for (const [k, p] of Object.entries(s.properties ?? {})) {
      const m = k in o ? mismatch(p, o[k], `${at}.${k}`) : null
      if (m) return m
    }
  } else if (s.type === 'array') {
    if (!Array.isArray(v)) return `${at} must be an array`
    for (const [i, x] of v.entries()) {
      const m = mismatch(s.items ?? {}, x, `${at}[${i}]`)
      if (m) return m
    }
  } else if (s.type === 'integer' ? !Number.isInteger(v) : s.type && typeof v !== s.type) {
    return `${at} must be ${s.type === 'integer' ? 'an integer' : `a ${s.type}`}`
  }
  return null
}

// L4's agent sessions: every tool, in auto mode (ADR 0013); what auto mode would block asks the user.
const agentSessionOptions = { tools: 'all', mode: 'auto' } as const

const columns = ['id', 'workspace_id as workspaceId', 'agent_session_id as agentSessionId', 'created_at as createdAt'] as const

// The workspace's agent sessions in L4, oldest first; the last one is the current one. A review round's session for
// its questions isn't listed (ADR 0011).
export function listAgentSessions(db: Db, workspaceId: number): Promise<AgentSession[]> {
  return db
    .selectFrom('agent_sessions')
    .select(columns)
    .where('workspace_id', '=', workspaceId)
    .where('review_round_id', 'is', null)
    .orderBy('id')
    .execute()
}

// The agent picks the session ID (ADR 0018, 6).
// ponytail: an agent session that never got a message can't be resumed after a restart (Claude Code has no transcript
// for it), so its first message then fails; start a new session in its place if that happens in practice.
export async function startAgentSession(db: Db, workspaceId: number): Promise<AgentSession> {
  const cwd = await readyWorktree(db, workspaceId)
  const id = await newSession('claude', { cwd, ...agentSessionOptions })
  return db
    .insertInto('agent_sessions')
    .values({ workspace_id: workspaceId, agent: 'claude', agent_session_id: id, created_at: new Date().toISOString() })
    .returning(columns)
    .executeTakeFirstOrThrow()
}

// Agent sessions run in their workspace's worktree, which opening the workspace creates (ADR 0008).
export async function agentSessionWorkspace(db: Db, agentSessionId: string): Promise<number> {
  const row = await db
    .selectFrom('agent_sessions')
    .select('workspace_id as id')
    .where('agent_session_id', '=', agentSessionId)
    .executeTakeFirst()
  if (!row) throw new Error(`No agent session ${agentSessionId}`)
  return row.id
}

export async function readyWorktree(db: Db, workspaceId: number): Promise<string> {
  const { owner, name } = await getWorkspaceRepo(db, workspaceId)
  const cwd = worktreePath(owner, name, workspaceId)
  if (!existsSync(join(cwd, '.git'))) throw new Error('The worktree is not ready yet')
  return cwd
}

// A session made before ADR 0018 loads by its stored ID too: it is Claude Code's. One never sent a message has no
// history to load.
export async function readTranscript(db: Db, agentSessionId: string): Promise<ChatEntry[]> {
  try {
    return await history('claude', agentSessionId, await readyWorktree(db, await agentSessionWorkspace(db, agentSessionId)))
  } catch {
    return []
  }
}

const running = new Set<string>()

// Sends one message in an agent session and streams the reply as chat entries until the turn ends.
export async function runTurn(
  db: Db,
  agentSessionId: string,
  prompt: string,
  options: Pick<RunOptions, 'tools' | 'mode'>,
  handlers: RunHandlers,
): Promise<TurnResult> {
  if (running.has(agentSessionId)) return { status: 'error', message: 'A turn is already running' }
  running.add(agentSessionId)
  try {
    const cwd = await readyWorktree(db, await agentSessionWorkspace(db, agentSessionId))
    handlers.onEntry?.({ kind: 'user', text: prompt })
    await run('claude', { cwd, prompt, session: agentSessionId, ...options }, handlers)
    return { status: 'ok' }
  } catch (e) {
    return { status: 'error', message: (e as Error).message }
  } finally {
    running.delete(agentSessionId)
  }
}

export function runAgentTurn(db: Db, agentSessionId: string, prompt: string, handlers: RunHandlers) {
  return runTurn(db, agentSessionId, prompt, agentSessionOptions, handlers)
}

export function stopTurn(agentSessionId: string) {
  return cancel('claude', agentSessionId)
}
