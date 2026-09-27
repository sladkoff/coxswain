import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { delimiter, join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Db } from "./db";
import { worktreePath } from "./git";
import { guideTools } from "./guides";
import { getWorkspaceRepo } from "./workspaces";

// ADR 0018: every agent run is a session over the Agent Client Protocol, in one adapter process per agent.
export type AgentSession = {
  id: number;
  workspaceId: number;
  agentSessionId: string;
  createdAt: string;
};

// One line of the chat: something the user said, text the agent wrote, or a tool the agent used. comment: the user's
// message was a comment sent from a thread, which the chat shows as a card.
// review: the message was every thread of the review at once, with how many. id: a streamed entry's; a later entry with
// the same id is the same one grown, and replaces it.
export type ChatEntry = {
  id?: number;
  kind: "user" | "text" | "tool";
  text: string;
  comment?: SentComment;
  review?: { threads: number };
};
export type SentComment = { threadId: number; where: string; body: string };

// A comment sent to the agent session, as its prompt: a header line the chat knows it by, the comment, then what the
// agent needs to answer it. ponytail: the transcript is the agent's, so the card is read back from the prompt's text;
// store sent comments by session and turn if the header ever gets in the way.
const commentHeader = /^\[Comment on (.+) · thread #(\d+)\]\n/;
export const formatComment = (c: SentComment, context: string) =>
  `[Comment on ${c.where} · thread #${c.threadId}]\n${c.body}${context ? `\n\n---\n${context}` : ""}`;
// A whole review sent at once, likewise known by its header line.
const reviewHeader = /^\[Review · (\d+) threads?\]\n/;
export const formatReview = (threads: number, body: string) =>
  `[Review · ${threads} thread${threads === 1 ? "" : "s"}]\n${body}`;

function withComment(entry: ChatEntry): ChatEntry {
  if (entry.kind !== "user") return entry;
  const r = reviewHeader.exec(entry.text);
  if (r) return { ...entry, review: { threads: Number(r[1]) } };
  const m = commentHeader.exec(entry.text);
  if (!m) return entry;
  const body = entry.text.slice(m[0].length).split("\n\n---\n")[0];
  return { ...entry, comment: { threadId: Number(m[2]), where: m[1], body } };
}

export type TurnResult = { status: "ok" } | { status: "error"; message: string };

// A tool use the agent asks the user to approve (ADR 0018), with the options the agent offers: allow once, always,
// reject.
export type Permission = {
  id: string;
  title: string;
  options: { id: string; name: string; kind: string }[];
};

// session: carry on this agent session. mcp: MCP servers the session gets: coxswain's tools for the agent pane
// (ADR 0023).
type RunOptions = {
  cwd: string;
  prompt: string;
  session?: string;
  mcp?: acp.McpServer[];
};
// onPermission resolves with the option picked, or null to cancel. Without it, every request is rejected.
type RunHandlers = {
  onEntry?: (entry: ChatEntry) => void;
  onPermission?: (p: Permission) => Promise<string | null>;
};

export type Agent = "claude";

// Each agent is a record: how its adapter starts, a run's options as its session/new _meta, and its auto mode's ID.
const agents: Record<
  Agent,
  {
    start: () => { command: string; args: string[]; env: NodeJS.ProcessEnv };
    meta: (o: RunOptions) => object;
    auto: string;
  }
> = {
  claude: {
    // Electron runs the adapter as Node. The user's own `claude` (ADR 0018, 5), not the one bundled with the SDK.
    start: () => ({
      command: process.execPath,
      args: [require.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js")],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CLAUDE_CODE_EXECUTABLE: claudeOnPath() },
    }),
    // Names checked against the adapter's OPTION_REBUILDS_SESSION (0.81.2).
    meta: (o) => ({
      claudeCode: {
        options: {
          // Agents the user runs (another Electron app, say) mustn't inherit Electron-as-Node from the adapter.
          env: { ELECTRON_RUN_AS_NODE: "" },
          ...(o.mcp?.length && { allowedTools: ["mcp__coxswain"] }),
        },
      },
    }),
    auto: "auto",
  },
};

// ponytail: PATH as the app got it, like `gh`; a login shell's PATH if coxswain is started from the Dock.
export function claudeOnPath(): string {
  const found = (process.env.PATH ?? "")
    .split(delimiter)
    .map((dir) => join(dir, "claude"))
    .find(existsSync);
  if (!found) throw new Error("Claude Code (claude) is not installed or not on PATH");
  return found;
}

// An adapter process and the sessions open in it. Started when first needed, kept while the app runs; one that
// exits is started again by the next run, which resumes its session there.
type Adapter = { child: ChildProcess; agent: acp.ClientContext; open: Set<string> };
const adapters = new Map<Agent, Promise<Adapter>>();
// Each running session's handlers, for the updates and permission requests the adapter sends.
const listening = new Map<string, Listener>();
type Listener = { update: (u: acp.SessionUpdate) => void; handlers: RunHandlers };
// Permission requests waiting for the user, by id.
const pending = new Map<
  string,
  { sessionId: string; resolve: (optionId: string | null) => void }
>();

function adapter(name: Agent): Promise<Adapter> {
  let a = adapters.get(name);
  if (a) return a;
  a = (async () => {
    const { command, args, env } = agents[name].start();
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "inherit"] });
    const conn = acp
      .client({ name: "coxswain" })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) => askPermission(ctx.params))
      .onNotification(acp.methods.client.session.update, (ctx) =>
        listening.get(ctx.params.sessionId)?.update(ctx.params.update),
      )
      .connect(
        acp.ndJsonStream(
          Writable.toWeb(child.stdin!),
          Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
        ),
      );
    const gone = () => {
      if (adapters.get(name) === a) adapters.delete(name);
      conn.close(new Error(`The ${name} adapter stopped`));
    };
    child.on("exit", gone);
    child.on("error", gone);
    await conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    return { child, agent: conn.agent, open: new Set<string>() };
  })();
  a.catch(() => adapters.delete(name));
  adapters.set(name, a);
  return a;
}

async function askPermission(
  p: acp.RequestPermissionRequest,
): Promise<acp.RequestPermissionResponse> {
  const ask = listening.get(p.sessionId)?.handlers.onPermission;
  const reject =
    p.options.find((o) => o.kind === "reject_once") ??
    p.options.find((o) => o.kind.startsWith("reject"));
  if (!ask)
    return reject
      ? { outcome: { outcome: "selected", optionId: reject.optionId } }
      : { outcome: { outcome: "cancelled" } };
  const id = randomUUID();
  const optionId = await new Promise<string | null>((resolve) => {
    pending.set(id, { sessionId: p.sessionId, resolve });
    ask({
      id,
      title: p.toolCall.title ?? "Use a tool",
      options: p.options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
    }).then(resolve);
  });
  pending.delete(id);
  return optionId
    ? { outcome: { outcome: "selected", optionId } }
    : { outcome: { outcome: "cancelled" } };
}

// The user's pick for a permission request; null cancels it.
export function answerPermission(id: string, optionId: string | null) {
  pending.get(id)?.resolve(optionId);
}

// Turns a session's updates into chat entries, streamed: each update sends the entry it grows again, under the same id,
// so text shows as it's written and a tool's title fills in (its first update carries only the tool's kind).
let nextEntry = 0;
function chat(onEntry: (e: ChatEntry) => void) {
  let last: (ChatEntry & { toolCallId?: string; name?: string | null }) | null = null;
  const emit = (e: typeof last) => {
    last = e;
    if (e?.text.trim())
      onEntry({ id: e.id, kind: e.kind, text: e.kind === "tool" ? e.text : e.text.trim() });
  };
  return (u: acp.SessionUpdate) => {
    // A subagent's updates carry the Agent call's id; L4 shows only the main thread, as before.
    if (
      (u as { _meta?: { claudeCode?: { parentToolUseId?: string } } })._meta?.claudeCode
        ?.parentToolUseId
    )
      return;
    if (u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "user_message_chunk") {
      if (u.content.type !== "text") return;
      const kind = u.sessionUpdate === "agent_message_chunk" ? "text" : "user";
      const text = last?.kind === kind ? last.text : "";
      emit({ id: last?.kind === kind ? last.id : nextEntry++, kind, text: text + u.content.text });
    } else if (u.sessionUpdate === "tool_call") {
      emit({
        id: nextEntry++,
        kind: "tool",
        text: toolTitle(u),
        toolCallId: u.toolCallId,
        name: u.name,
      });
    } else if (
      u.sessionUpdate === "tool_call_update" &&
      u.title &&
      last?.toolCallId === u.toolCallId
    ) {
      emit({ ...last, text: toolTitle({ title: u.title, name: u.name ?? last.name }) });
    }
  };
}

// e.g. "Read src/a.ts", "Bash git status". ponytail: tool results aren't shown; add them collapsed under the call.
function toolTitle(u: { title: string; name?: string | null }): string {
  const title = u.title.split("\n")[0].slice(0, 120);
  return u.name && !title.startsWith(u.name) ? `${u.name} ${title}` : title;
}

// Opens a session for a run: a new one, or the given one, resumed if this adapter process hasn't got it open. Sets
// Claude Code's default model and auto mode: the agent's classifier decides what would ask (ADR 0013).
async function openSession(name: Agent, o: RunOptions): Promise<{ a: Adapter; sessionId: string }> {
  const a = await adapter(name);
  const params = {
    cwd: o.cwd,
    mcpServers: o.mcp ?? [],
    _meta: agents[name].meta(o) as Record<string, unknown>,
  };
  let config: acp.SessionConfigOption[] | null | undefined;
  let sessionId = o.session ?? "";
  if (!sessionId)
    ({ sessionId, configOptions: config } = await a.agent.request(
      acp.methods.agent.session.new,
      params,
    ));
  else if (!a.open.has(sessionId))
    ({ configOptions: config } = await a.agent.request(acp.methods.agent.session.resume, {
      ...params,
      sessionId,
    }));
  a.open.add(sessionId);
  // Left to itself the adapter resolves the user's settings model, and some aliases differently from Claude Code
  // ("opus[1m]" became Opus 4.8, not 5.5, in 0.81.2), so Claude Code's own default is picked.
  // ponytail: so a model in the user's settings is ignored; resolve it like Claude Code if someone relies on it.
  const models = config?.find((c) => c.category === "model");
  if (models?.type === "select" && models.currentValue !== "default") {
    const options = models.options.flatMap((x) => ("options" in x ? x.options : [x]));
    if (options.some((x) => x.value === "default"))
      await a.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: models.id,
        value: "default",
      });
  }
  await a.agent.request(acp.methods.agent.session.setMode, {
    sessionId,
    modeId: agents[name].auto,
  });
  return { a, sessionId };
}

// Opens a session without a turn, for an agent session whose ID is stored before its first message.
export async function newSession(
  name: Agent,
  o: Omit<RunOptions, "prompt" | "session">,
): Promise<string> {
  return (await openSession(name, { ...o, prompt: "" })).sessionId;
}

// Runs one turn: sends the prompt and streams the reply as chat entries until the turn ends.
export async function run(name: Agent, o: RunOptions, handlers: RunHandlers = {}): Promise<void> {
  const { a, sessionId } = await openSession(name, o);
  const update = chat(handlers.onEntry ?? (() => {}));
  listening.set(sessionId, { update, handlers });
  try {
    const { stopReason } = await a.agent.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: o.prompt }],
    });
    if (stopReason === "cancelled") throw new Error("Stopped");
    if (stopReason === "refusal") throw new Error(`${name} refused`);
  } finally {
    listening.delete(sessionId);
    for (const p of pending.values()) if (p.sessionId === sessionId) p.resolve(null);
  }
}

// Stops a session's turn; its run ends with 'Stopped'.
async function cancel(name: Agent, sessionId: string) {
  const a = await adapters.get(name)?.catch(() => null);
  await a?.agent.notify(acp.methods.agent.session.cancel, { sessionId });
}

// A session's history as chat entries, replayed by session/load. mcp: as for a run; the session stays open with them.
async function history(
  name: Agent,
  sessionId: string,
  cwd: string,
  mcp: acp.McpServer[] = [],
): Promise<ChatEntry[]> {
  const a = await adapter(name);
  const entries = new Map<number | undefined, ChatEntry>();
  const update = chat((e) => entries.set(e.id, e));
  const running = listening.get(sessionId);
  if (running) return []; // a turn is streaming it; it's read again when the turn ends
  listening.set(sessionId, { update, handlers: {} });
  try {
    await a.agent.request(acp.methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers: mcp,
      _meta: agents[name].meta({ cwd, prompt: "", mcp }) as Record<string, unknown>,
    });
    a.open.add(sessionId);
    return [...entries.values()];
  } finally {
    listening.delete(sessionId);
  }
}

export async function stopAgents() {
  for (const a of adapters.values())
    a.then(
      (x) => x.child.kill(),
      () => {},
    );
  server?.then(
    (s) => s.close(),
    () => {},
  );
}

// An MCP tool coxswain serves. call returns the tool's text for the agent; throwing makes it an error the agent reads.
// Arguments are checked against inputSchema before call.
export type McpTool = {
  name: string;
  description: string;
  inputSchema: object;
  call: (args: never) => Promise<string>;
};

// ADR 0023: coxswain's tools. One localhost HTTP MCP server for the app, a path per workspace with the agent pane's
// tools. It speaks just enough MCP (Streamable HTTP, JSON responses) for tools.
const toolsets = new Map<string, McpTool[]>();
let server: Promise<Server> | undefined;

const serverUrl = async (path: string) =>
  `http://127.0.0.1:${((await toolServer()).address() as AddressInfo).port}/${path}`;

// The agent pane's tools for a workspace (ADR 0023), at a path that stays the same while the app runs, since a session
// keeps the URL it was opened with.
async function paneTools(db: Db, workspaceId: number): Promise<acp.McpServer[]> {
  const path = `workspace/${workspaceId}`;
  toolsets.set(path, guideTools(db, workspaceId));
  return [{ type: "http", name: "coxswain", url: await serverUrl(path), headers: [] }];
}

function toolServer(): Promise<Server> {
  server ??= new Promise((resolve, reject) => {
    const s = createServer(async (req, res) => {
      const tools = toolsets.get(req.url?.slice(1) ?? "");
      if (!tools) return void res.writeHead(404).end();
      if (req.method !== "POST") return void res.writeHead(405).end();
      let body = "";
      for await (const chunk of req) body += chunk;
      let msg: {
        id?: string | number;
        method?: string;
        params?: { protocolVersion?: string; name?: string; arguments?: unknown };
      };
      try {
        msg = JSON.parse(body);
      } catch {
        return void res.writeHead(400).end();
      }
      if (msg.id === undefined) return void res.writeHead(202).end(); // a notification
      const reply = (r: { result: object } | { error: { code: number; message: string } }) =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...r }));
      if (msg.method === "initialize")
        return reply({
          result: {
            protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "coxswain", version: "0" },
          },
        });
      if (msg.method === "ping") return reply({ result: {} });
      if (msg.method === "tools/list")
        return reply({
          result: {
            tools: tools.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          },
        });
      if (msg.method === "tools/call") {
        const tool = tools.find((t) => t.name === msg.params?.name);
        const args = msg.params?.arguments ?? {};
        const problem = !tool
          ? `No tool ${msg.params?.name}`
          : mismatch(tool.inputSchema, args, "input");
        const text = problem
          ? `${problem}. Call ${msg.params?.name} again with all of it.`
          : await tool!.call(args as never).catch((e: Error) => ({ error: e.message }));
        const isError = !!problem || typeof text !== "string";
        return reply({
          result: {
            isError,
            content: [{ type: "text", text: typeof text === "string" ? text : text.error }],
          },
        });
      }
      reply({ error: { code: -32601, message: `No method ${msg.method}` } });
    });
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  return server;
}

// Why value doesn't fit schema, or null if it does.
// ponytail: checks only what our schemas use (type, properties, required, items, enum); a validator library if they
// grow.
type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: readonly unknown[];
};
function mismatch(s: Schema, v: unknown, at: string): string | null {
  if (s.enum && !s.enum.includes(v))
    return `${at} must be one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}`;
  if (s.type === "object") {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return `${at} must be an object`;
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) return `${at}.${k} is missing`;
    for (const [k, p] of Object.entries(s.properties ?? {})) {
      const m = k in o ? mismatch(p, o[k], `${at}.${k}`) : null;
      if (m) return m;
    }
  } else if (s.type === "array") {
    if (!Array.isArray(v)) return `${at} must be an array`;
    for (const [i, x] of v.entries()) {
      const m = mismatch(s.items ?? {}, x, `${at}[${i}]`);
      if (m) return m;
    }
  } else if (s.type === "integer" ? !Number.isInteger(v) : s.type && typeof v !== s.type) {
    return `${at} must be ${s.type === "integer" ? "an integer" : `a ${s.type}`}`;
  }
  return null;
}

const columns = [
  "id",
  "workspace_id as workspaceId",
  "agent_session_id as agentSessionId",
  "created_at as createdAt",
] as const;

// The workspace's agent sessions in the agent pane, oldest first; the last one is the current one, which questions go
// to too (ADR 0021).
export function listAgentSessions(db: Db, workspaceId: number): Promise<AgentSession[]> {
  return db
    .selectFrom("agent_sessions")
    .select(columns)
    .where("workspace_id", "=", workspaceId)
    .orderBy("id")
    .execute();
}

// The agent picks the session ID (ADR 0018, 6).
// ponytail: an agent session that never got a message can't be resumed after a restart (Claude Code has no transcript
// for it), so its first message then fails; start a new session in its place if that happens in practice.
export async function startAgentSession(db: Db, workspaceId: number): Promise<AgentSession> {
  const cwd = await readyWorktree(db, workspaceId);
  const id = await newSession("claude", { cwd, mcp: await paneTools(db, workspaceId) });
  return db
    .insertInto("agent_sessions")
    .values({
      workspace_id: workspaceId,
      agent: "claude",
      agent_session_id: id,
      created_at: new Date().toISOString(),
    })
    .returning(columns)
    .executeTakeFirstOrThrow();
}

// Agent sessions run in their workspace's worktree, which opening the workspace creates (ADR 0008).
export async function agentSessionWorkspace(db: Db, agentSessionId: string): Promise<number> {
  const row = await db
    .selectFrom("agent_sessions")
    .select("workspace_id as id")
    .where("agent_session_id", "=", agentSessionId)
    .executeTakeFirst();
  if (!row) throw new Error(`No agent session ${agentSessionId}`);
  return row.id;
}

async function readyWorktree(db: Db, workspaceId: number): Promise<string> {
  const { owner, name, prNumber } = await getWorkspaceRepo(db, workspaceId);
  const cwd = worktreePath(owner, name, prNumber);
  if (!existsSync(join(cwd, ".git"))) throw new Error("The worktree is not ready yet");
  return cwd;
}

// A session made before ADR 0018 loads by its stored ID too: it is Claude Code's. One never sent a message has no
// history to load.
export async function readTranscript(db: Db, agentSessionId: string): Promise<ChatEntry[]> {
  try {
    const workspaceId = await agentSessionWorkspace(db, agentSessionId);
    const entries = await history(
      "claude",
      agentSessionId,
      await readyWorktree(db, workspaceId),
      await paneTools(db, workspaceId),
    );
    return entries.map(withComment);
  } catch {
    return [];
  }
}

const running = new Set<string>();

// Sends one message in an agent session and streams the reply as chat entries until the turn ends.
export async function runTurn(
  db: Db,
  agentSessionId: string,
  prompt: string,
  handlers: RunHandlers,
): Promise<TurnResult> {
  if (running.has(agentSessionId)) return { status: "error", message: "A turn is already running" };
  running.add(agentSessionId);
  try {
    const workspaceId = await agentSessionWorkspace(db, agentSessionId);
    const cwd = await readyWorktree(db, workspaceId);
    handlers.onEntry?.(withComment({ kind: "user", text: prompt }));
    await run(
      "claude",
      { cwd, prompt, session: agentSessionId, mcp: await paneTools(db, workspaceId) },
      handlers,
    );
    return { status: "ok" };
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  } finally {
    running.delete(agentSessionId);
  }
}

export function stopTurn(agentSessionId: string) {
  return cancel("claude", agentSessionId);
}
