import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { delimiter, join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Db } from "./db";
import { type Commit, worktreePath } from "./git";
import { snapshotOf } from "./snapshot";
import { SessionStates } from "./session-state";
import { viewTools } from "./views";
import { getWorkspaceRepo } from "./workspaces";

// ADR 0018: every agent run is a session over the Agent Client Protocol, in one adapter process per agent.
export type AgentSession = {
  id: number;
  workspaceId: number;
  agent: Agent;
  agentSessionId: string;
  createdAt: string;
  title: string | null;
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
// (ADR 0023). picks: the model and effort to set, the user's (agentPicks). oneShot: a system prompt for a run with no
// tools that isn't kept (askOnce).
type RunOptions = {
  cwd: string;
  prompt: string;
  session?: string;
  mcp?: acp.McpServer[];
  picks?: Picks;
  oneShot?: string;
};
// onPermission resolves with the option picked, or null to cancel. Without it, every request is rejected.
type RunHandlers = {
  onEntry?: (entry: ChatEntry) => void;
  onPermission?: (p: Permission) => Promise<string | null>;
};

export type Agent = "claude" | "codex";

// What the composer picks for an agent's sessions, as the adapter's session config options of that category.
export type Pick = "model" | "effort";
type Picks = Partial<Record<Pick, string>>;
const category: Record<Pick, string> = { model: "model", effort: "thought_level" };

// Each agent is a record: how its adapter starts, a run's options as its session/new _meta, its auto mode's ID, and
// picks it gets when the user has made none.
const agents: Record<
  Agent,
  {
    start: () => { command: string; args: string[]; env: NodeJS.ProcessEnv };
    meta: (o: RunOptions) => object;
    auto: string;
    picks: Picks;
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
    // A one-shot run replaces Claude Code's system prompt, has no tools, doesn't think and isn't kept in its session list.
    meta: (o) => ({
      ...(o.mcp?.length && { systemPrompt: { append: paneContext } }),
      ...(o.oneShot && { systemPrompt: o.oneShot }),
      claudeCode: {
        options: {
          // Agents the user runs (another Electron app, say) mustn't inherit Electron-as-Node from the adapter.
          env: { ELECTRON_RUN_AS_NODE: "" },
          ...(o.mcp?.length && { allowedTools: ["mcp__coxswain"] }),
          ...(o.oneShot && {
            tools: [],
            strictMcpConfig: true,
            thinking: { type: "disabled" },
            persistSession: false,
          }),
        },
      },
    }),
    auto: "auto",
    // Left to itself the adapter resolves the user's settings model, and some aliases differently from Claude Code
    // ("opus[1m]" became Opus 4.8, not 5.5, in 0.81.2), so Claude Code's own default is picked.
    // ponytail: so a model in the user's settings is ignored; resolve it like Claude Code if someone relies on it.
    picks: { model: "default" },
  },
  codex: {
    // The user's own `codex`, like claude. Instructions go in as Codex config, for every session: all are the pane's.
    // Commands Codex runs mustn't inherit Electron-as-Node either.
    start: () => ({
      command: process.execPath,
      args: [require.resolve("@agentclientprotocol/codex-acp/dist/index.js")],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        CODEX_PATH: onPath("codex", "Codex"),
        CODEX_CONFIG: JSON.stringify({
          developer_instructions: paneContext,
          shell_environment_policy: { exclude: ["ELECTRON_RUN_AS_NODE"] },
        }),
      },
    }),
    meta: () => ({}),
    // "Approve for me": Codex's reviewer decides what would ask, like Claude Code's auto mode (ADR 0013).
    auto: "agent",
    picks: {},
  },
};

// Appended to Claude Code's system prompt in the agent pane (ADR 0023), so the agent knows where it is and what its
// coxswain tools are for; the tools' own descriptions and results say how to use them.
const paneContext = `You are running inside coxswain, a desktop app for exploring code, reviewing changes and building features. The user sees
the diff beside this chat. Messages starting with [Comment on …] or [Review · …] are review comments they sent you from
the diff: make the change asked for, or answer the question. The mcp__coxswain tools put views on the canvas beside the
diff (start_view, write_section, remove_section, list_views, file_summaries): a guide through the changes, or a view of one aspect (the data model, a data flow, or
anything the user asks to see), in markdown with diagrams, embedded source files and file diffs, even without changes; explanations of lines
(add_explanation); and, when they ask for a review, findings on lines (add_finding). Use them, and your review skills,
when the user asks for a guide, a review, or to trace, explain or visualise code, with or without changes. A message
that starts "For … only (start_view with base … and head …)" is about that part of the changes: pass those to start_view.`;

// PATH as the app got it, like `gh` (a packaged app takes the login shell's, src/main/index.ts).
export const claudeOnPath = () => onPath("claude", "Claude Code");
function onPath(command: string, name: string): string {
  const found = (process.env.PATH ?? "")
    .split(delimiter)
    .map((dir) => join(dir, command))
    .find(existsSync);
  if (!found) throw new Error(`${name} (${command}) is not installed or not on PATH`);
  return found;
}

// An adapter process and the sessions open in it. Started when first needed, kept while the app runs; one that
// exits is started again by the next run, which resumes its session there.
type Adapter = { child: ChildProcess; agent: acp.ClientContext; open: Set<string> };
const adapters = new Map<Agent, Promise<Adapter>>();
// Each running session's handlers, for the updates and permission requests the adapter sends.
const listening = new Map<string, Listener>();
type Listener = { update: (u: acp.SessionUpdate) => void; handlers: RunHandlers };
// Told when an agent names one of its sessions.
const titleListeners = new Set<(sessionId: string, title: string) => void>();
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
      .onNotification(acp.methods.client.session.update, (ctx) => {
        const u = ctx.params.update;
        // Claude Code names a session a moment after its first turn ends, when no run listens any more.
        if (u.sessionUpdate === "session_info_update" && u.title)
          titleListeners.forEach((l) => l(ctx.params.sessionId, u.title!));
        listening.get(ctx.params.sessionId)?.update(u);
      })
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
  sessionStates.permission(p.sessionId, null);
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

// Each open session's config options as the adapter last sent them, and each agent's latest: the choices the composer
// offers.
const configs = new Map<string, acp.SessionConfigOption[]>();
const latest = new Map<Agent, acp.SessionConfigOption[]>();
// A one-shot run's aren't the latest: its model isn't the composer's.
const configOf = (
  name: Agent,
  sessionId: string,
  config: acp.SessionConfigOption[],
  isLatest = true,
) => {
  configs.set(sessionId, config);
  if (isLatest) latest.set(name, config);
};

// Opens a session for a run: a new one, or the given one, resumed if this adapter process hasn't got it open. Sets the
// picks, model first (the effort levels depend on it), and auto mode: the agent decides what would ask (ADR 0013).
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
  config ??= configs.get(sessionId);
  if (config) configOf(name, sessionId, config, !o.oneShot);
  for (const pick of ["model", "effort"] as const) {
    const value = o.picks?.[pick] ?? agents[name].picks[pick];
    const option: acp.SessionConfigOption | undefined = config?.find(
      (c) => c.category === category[pick],
    );
    if (!value || option?.type !== "select") continue;
    const picked = pickOf(choicesOf(option), value, !!o.oneShot);
    if (!picked || option.currentValue === picked) continue;
    const set: acp.SetSessionConfigOptionResponse = await a.agent.request(
      acp.methods.agent.session.setConfigOption,
      { sessionId, configId: option.id, value: picked },
    );
    config = set.configOptions;
    configOf(name, sessionId, set.configOptions, !o.oneShot);
  }
  await a.agent.request(acp.methods.agent.session.setMode, {
    sessionId,
    modeId: agents[name].auto,
  });
  return { a, sessionId };
}

type Choice = { value: string; name: string };
// The choice with that value; for a one-shot run also the first whose value has it in it, since Claude Code lists
// full model IDs ("claude-haiku-4-5") and a summary model is asked for by family ("haiku").
const pickOf = (choices: Choice[], value: string, byFamily: boolean) =>
  (
    choices.find((x) => x.value === value) ??
    (byFamily ? choices.find((x) => x.value.includes(value)) : undefined)
  )?.value;
const choicesOf = (o: acp.SessionConfigOption & { type: "select" }): Choice[] =>
  o.options
    .flatMap((x) => ("options" in x ? x.options : [x]))
    .map((x) => ({
      value: x.value,
      name:
        x.value === "default" && x.description ? `${modelName(x.description)} (default)` : x.name,
    }));

// Claude Code's default model option says only "Default (recommended)"; its description is the model it resolves to,
// by ID when the list has no name for it: "claude-opus-5-5" is shown as "Opus 5.5".
// ponytail: guesses the name from the ID's shape; the adapter's own display name if it ever sends one.
function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(.*)$/.exec(id);
  if (!m) return id;
  const [, family, major, minor, rest] = m;
  return `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}${rest.replace(/^-\d{8}/, "")}`;
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

// ADR 0029: one run of a file summary job, in a session of its own that's closed after: no tools or MCP servers, and
// instructions in place of Claude Code's system prompt (Codex keeps its own, with the pane's). model: "" the agent's
// default. Resolves with the reply's text and the model it ran on, by the agent's name for it. Rejects with fatal set
// when trying again can't help: the agent isn't installed, or doesn't offer the model.
export async function askOnce(
  name: Agent,
  o: { cwd: string; prompt: string; model: string; instructions: string; signal: AbortSignal },
): Promise<{ text: string; model: string | null }> {
  const fatal = (message: string) => Object.assign(new Error(message), { fatal: true });
  let opened: Awaited<ReturnType<typeof openSession>>;
  try {
    opened = await openSession(name, {
      cwd: o.cwd,
      prompt: o.prompt,
      oneShot: o.instructions,
      picks: o.model ? { model: o.model } : {},
    });
  } catch (e) {
    const message = (e as Error).message;
    throw /not installed or not on PATH/.test(message) ? fatal(message) : e;
  }
  const { a, sessionId } = opened;
  let text = "";
  try {
    const option = configs.get(sessionId)?.find((c) => c.category === category.model);
    const choices = option?.type === "select" ? choicesOf(option) : [];
    if (o.model && choices.length && !pickOf(choices, o.model, true))
      throw fatal(
        `${name} has no model "${o.model}" (it has ${choices.map((c) => c.value).join(", ")}); pick another in Settings`,
      );
    const ranOn =
      option?.type === "select"
        ? (choices.find((c) => c.value === option.currentValue)?.name ??
          String(option.currentValue))
        : null;
    listening.set(sessionId, {
      update: (u) => {
        if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text")
          text += u.content.text;
      },
      handlers: {},
    });
    const stop = () => void cancel(name, sessionId);
    if (o.signal.aborted) stop();
    o.signal.addEventListener("abort", stop, { once: true });
    try {
      const { stopReason } = await a.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: o.prompt }],
      });
      if (stopReason === "cancelled") throw new Error("Stopped");
      if (stopReason === "refusal") throw new Error(`${name} refused`);
    } finally {
      o.signal.removeEventListener("abort", stop);
    }
    return { text, model: ranOn };
  } finally {
    listening.delete(sessionId);
    configs.delete(sessionId);
    a.open.delete(sessionId);
    a.agent.request(acp.methods.agent.session.close, { sessionId }).catch(() => {});
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
    const { configOptions } = await a.agent.request(acp.methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers: mcp,
      _meta: agents[name].meta({ cwd, prompt: "", mcp }) as Record<string, unknown>,
    });
    a.open.add(sessionId);
    if (configOptions) configOf(name, sessionId, configOptions);
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
  toolsets.set(path, viewTools(db, workspaceId));
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
  "agent",
  "agent_session_id as agentSessionId",
  "created_at as createdAt",
  "title",
] as const;

// Stores the title an agent gives a session (Claude Code generates one after the first turn) and tells the listener the
// session's workspace. The title replaces the first-message one runTurn gave it.
export function onSessionTitle(db: Db, listener: (workspaceId: number) => void) {
  const save = async (sessionId: string, title: string) => {
    const row = await db
      .updateTable("agent_sessions")
      .set({ title })
      .where("agent_session_id", "=", sessionId)
      .returning("workspace_id")
      .executeTakeFirst();
    if (row) listener(row.workspace_id);
  };
  const l = (sessionId: string, title: string) => void save(sessionId, title).catch(() => {});
  titleListeners.add(l);
  return () => void titleListeners.delete(l);
}

// A session's title until its agent names it: its first message's first line, without a comment's or review's header.
// Codex names a session only when the user does, so its sessions keep this one.
export const firstMessageTitle = (prompt: string) =>
  (
    prompt
      .replace(commentHeader, "")
      .replace(reviewHeader, "")
      .split("\n")
      .find((l) => l.trim()) ?? ""
  )
    .trim()
    .slice(0, 80);

// The workspace's agent sessions in the agent pane, oldest first; the last one is the current one, which questions go
// to too (ADR 0021).
export function listAgentSessions(db: Db, workspaceId: number): Promise<AgentSession[]> {
  return db
    .selectFrom("agent_sessions")
    .select(columns)
    .where("workspace_id", "=", workspaceId)
    .orderBy("id")
    .execute() as Promise<AgentSession[]>;
}

// The agent picks the session ID (ADR 0018, 6). agent: the one picked for it, kept for the next new session; without
// it, the one picked last.
// ponytail: an agent session that never got a message can't be resumed after a restart (Claude Code has no transcript
// for it), so its first message then fails; start a new session in its place if that happens in practice.
export async function startAgentSession(
  db: Db,
  workspaceId: number,
  agent?: Agent,
): Promise<AgentSession> {
  if (agent) await saveSetting(db, "agent", agent);
  agent ??= await newSessionAgent(db);
  const cwd = await readyWorktree(db, workspaceId);
  const id = await newSession(agent, {
    cwd,
    mcp: await paneTools(db, workspaceId),
    picks: await agentPicks(db, agent),
  });
  await sessionStates.read(id, async () => []);
  return db
    .insertInto("agent_sessions")
    .values({
      workspace_id: workspaceId,
      agent,
      agent_session_id: id,
      created_at: new Date().toISOString(),
    })
    .returning(columns)
    .executeTakeFirstOrThrow() as Promise<AgentSession>;
}

// The agent a new session gets unless another is picked: the one picked last.
export async function newSessionAgent(db: Db): Promise<Agent> {
  return (await setting(db, "agent")) === "codex" ? "codex" : "claude";
}

// An agent session's workspace and agent. Sessions run in their workspace's worktree, which opening the workspace
// creates (ADR 0008).
async function sessionOf(db: Db, agentSessionId: string): Promise<{ id: number; agent: Agent }> {
  const row = await db
    .selectFrom("agent_sessions")
    .select(["workspace_id as id", "agent"])
    .where("agent_session_id", "=", agentSessionId)
    .executeTakeFirst();
  if (!row) throw new Error(`No agent session ${agentSessionId}`);
  return row as { id: number; agent: Agent };
}

export async function agentSessionWorkspace(db: Db, agentSessionId: string): Promise<number> {
  return (await sessionOf(db, agentSessionId)).id;
}

// The composer's picks for an agent: each with the choices the agent offers and the current one. Every session of the
// agent runs on them, set as each turn starts. The choices are the agent's latest session's; before it has one, a
// session opened in the workspace to ask, and closed.
// ponytail: the effort levels are the latest session's model's; a model picked before a session starts shows the old
// levels until then, and a level the new model hasn't is skipped.
export type AgentPicks = Partial<Record<Pick, { current: string; choices: Choice[] }>>;
export async function listAgentPicks(
  db: Db,
  workspaceId: number,
  agent: Agent,
): Promise<AgentPicks> {
  const picks = await agentPicks(db, agent);
  if (!latest.has(agent)) {
    const cwd = await readyWorktree(db, workspaceId);
    const { a, sessionId } = await openSession(agent, { cwd, prompt: "", picks });
    configs.delete(sessionId);
    a.open.delete(sessionId);
    await a.agent.request(acp.methods.agent.session.close, { sessionId }).catch(() => {});
  }
  const result: AgentPicks = {};
  for (const pick of ["model", "effort"] as const) {
    const option = latest.get(agent)?.find((c) => c.category === category[pick]);
    if (option?.type !== "select") continue;
    const choices = choicesOf(option);
    const value = picks[pick] ?? agents[agent].picks[pick];
    const current = choices.some((x) => x.value === value) ? value! : String(option.currentValue);
    result[pick] = { current, choices };
  }
  return result;
}

// The user's pick of model or effort for an agent's sessions, from the next turn on.
export function setAgentPick(db: Db, agent: Agent, pick: Pick, value: string) {
  return saveSetting(db, `agent.${agent}.${pick}`, value);
}

async function agentPicks(db: Db, agent: Agent): Promise<Picks> {
  const [model, effort] = await Promise.all(
    (["model", "effort"] as const).map((p) => setting(db, `agent.${agent}.${p}`)),
  );
  return { ...(model && { model }), ...(effort && { effort }) };
}

async function setting(db: Db, key: string): Promise<string | undefined> {
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  return row?.value;
}

async function saveSetting(db: Db, key: string, value: string) {
  await db
    .insertInto("settings")
    .values({ key, value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
}

async function readyWorktree(db: Db, workspaceId: number): Promise<string> {
  const w = await getWorkspaceRepo(db, workspaceId);
  const cwd = worktreePath(w.owner, w.name, w);
  if (!existsSync(join(cwd, ".git"))) throw new Error("The worktree is not ready yet");
  return cwd;
}

// The core owns the live projection, independently of any pane or IPC invocation.
const sessionStates = new SessionStates();
export const onSessionState = sessionStates.subscribe.bind(sessionStates);
export const readAgentState = (db: Db, agentSessionId: string) =>
  sessionStates.read(agentSessionId, async () => {
    const { id: workspaceId, agent } = await sessionOf(db, agentSessionId);
    const entries = await history(
      agent,
      agentSessionId,
      await readyWorktree(db, workspaceId),
      await paneTools(db, workspaceId),
    );
    return entries.map(withComment);
  });

// Sends one message in an agent session and streams the reply as chat entries until the turn ends.
export async function runTurn(
  db: Db,
  agentSessionId: string,
  prompt: string,
  handlers: RunHandlers,
): Promise<TurnResult> {
  try {
    await readAgentState(db, agentSessionId);
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
  if (!sessionStates.start(agentSessionId))
    return { status: "error", message: "A turn is already running" };
  const streaming: RunHandlers = {
    onEntry: (entry) => {
      sessionStates.entry(agentSessionId, entry);
      handlers.onEntry?.(entry);
    },
    onPermission: (permission) => {
      sessionStates.permission(agentSessionId, permission);
      return handlers.onPermission?.(permission) ?? Promise.resolve(null);
    },
  };
  let result: TurnResult = { status: "ok" };
  streaming.onEntry?.(withComment({ kind: "user", text: prompt }));
  try {
    const { id: workspaceId, agent } = await sessionOf(db, agentSessionId);
    const cwd = await readyWorktree(db, workspaceId);
    await db
      .updateTable("agent_sessions")
      .set({ title: firstMessageTitle(prompt) || null })
      .where("agent_session_id", "=", agentSessionId)
      .where("title", "is", null)
      .execute();
    // ADR 0028: the worktree before and after, for the turn's diff. A stopped or failed turn may have changed it too.
    const before = await snapshotOf(cwd).catch(() => null);
    try {
      await run(
        agent,
        {
          cwd,
          prompt,
          session: agentSessionId,
          mcp: await paneTools(db, workspaceId),
          picks: await agentPicks(db, agent),
        },
        streaming,
      );
    } finally {
      const after = before && (await snapshotOf(cwd).catch(() => null));
      if (after && after !== before)
        await db
          .insertInto("turns")
          .values({
            workspace_id: workspaceId,
            before,
            after,
            title: firstMessageTitle(prompt) || "Turn",
            created_at: new Date().toISOString(),
          })
          .execute();
    }
  } catch (e) {
    result = { status: "error", message: (e as Error).message };
  } finally {
    sessionStates.finish(agentSessionId, result);
  }
  return result;
}

// The workspace's agent turns that changed its worktree, newest first, each as a commit from its before to its after.
// ponytail: two sessions' turns running at once in one workspace each get both's changes.
export async function listTurns(db: Db, workspaceId: number): Promise<Commit[]> {
  const rows = await db
    .selectFrom("turns")
    .select(["before", "after", "title", "created_at"])
    .where("workspace_id", "=", workspaceId)
    .orderBy("id", "desc")
    .execute();
  return rows.map((r) => ({
    sha: r.after,
    parent: r.before,
    subject: r.title,
    turn: r.created_at,
  }));
}

export async function stopTurn(db: Db, agentSessionId: string) {
  return cancel((await sessionOf(db, agentSessionId)).agent, agentSessionId);
}
