import {
  type ChatEntry,
  formatComment,
  formatReview,
  listAgentSessions,
  type Permission,
  runTurn,
  startAgentSession,
  stopComment,
  type TurnResult,
} from "./agents";
import type { Db } from "./db";
import { byAgent, describe, unseen } from "./thread-context.ts";
import { readTexts } from "./git";

// ADR 0015: a workspace's entries (glossary): notes, questions and answers, threaded by parent_id; and the agent's
// explanations and findings, which belong to a view too (viewId, ADR 0023).
// An entry's anchor is a line range of a file; side 'old' is the merge base (removed lines in a diff), 'new' the
// worktree. code: the lines as they were, since line numbers drift as the worktree changes. No anchor: it floats.
// base, head: the range of the view it was written in (ADR 0015); head null is the worktree (the live diff).
type Anchor = {
  path: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  code: string;
  base: string;
  head: string | null;
};

export type ReviewEntry = {
  id: number;
  workspaceId: number;
  kind: "note" | "question" | "answer" | "explanation" | "finding";
  body: string;
  parentId: number | null; // the thread's first entry, for replies, follow-ups and answers
  viewId: number | null;
  path: string | null;
  side: "old" | "new" | null;
  startLine: number | null;
  endLine: number | null;
  code: string | null;
  base: string | null;
  head: string | null;
  createdAt: string;
  resolvedAt: string | null; // on a thread's first entry: when it was resolved
  agentSessionId: string | null; // a question: the agent session it went to
  // In the view it was listed for (ADR 0015): current if its lines still read as its code; outdated if not. A reply
  // or answer takes its thread's. Floating entries are current.
  state: "current" | "outdated";
};

// A note or question from the user: anchored, or a follow-up in a thread (parentId).
export type NewEntry = { workspaceId: number; body: string; anchor?: Anchor; parentId?: number };

const columns = [
  "id",
  "workspace_id as workspaceId",
  "kind",
  "body",
  "parent_id as parentId",
  "view_id as viewId",
  "path",
  "side",
  "start_line as startLine",
  "end_line as endLine",
  "code",
  "base",
  "head",
  "created_at as createdAt",
  "resolved_at as resolvedAt",
  "agent_session_id as agentSessionId",
] as const;

// Every entry of the workspace, in order.
// ponytail: every entry the workspace ever had; page or archive them if workspaces collect hundreds.
const workspaceEntries = (db: Db, workspaceId: number): Promise<Omit<ReviewEntry, "state">[]> =>
  db
    .selectFrom("entries")
    .select(columns)
    .where("workspace_id", "=", workspaceId)
    .orderBy("id")
    .execute();

// The workspace's entries, with their state in the view of base → head (the worktree without head).
export async function listEntries(
  db: Db,
  workspaceId: number,
  base: string,
  head?: string,
): Promise<ReviewEntry[]> {
  const rows = await workspaceEntries(db, workspaceId);
  const anchored = rows.filter((e) => e.path && !e.parentId);
  const paths = (side: "old" | "new") => [
    ...new Set(anchored.filter((e) => e.side === side).map((e) => e.path!)),
  ];
  const [oldTexts, newTexts] = await Promise.all([
    readTexts(db, workspaceId, paths("old"), base),
    readTexts(db, workspaceId, paths("new"), head),
  ]);
  const current = (e: Omit<ReviewEntry, "state">) => {
    const text = (e.side === "old" ? oldTexts : newTexts).get(e.path!) ?? "";
    return (
      text
        .split("\n")
        .slice(e.startLine! - 1, e.endLine!)
        .join("\n") === e.code
    );
  };
  const state = new Map(
    anchored.map((e) => [e.id, current(e) ? ("current" as const) : ("outdated" as const)]),
  );
  return rows.map((e) => ({ ...e, state: state.get(e.parentId ?? e.id) ?? "current" }));
}

function addEntry(
  db: Db,
  kind: ReviewEntry["kind"],
  e: NewEntry,
): Promise<Omit<ReviewEntry, "state">> {
  if (!e.body.trim()) throw new Error(`A ${kind} needs text`);
  const a = e.anchor;
  if (a && a.side !== "old" && a.side !== "new") throw new Error(`Not a side: ${a.side}`);
  const [start, end] = a ? [a.startLine, a.endLine].sort((x, y) => x - y) : [null, null];
  return db
    .insertInto("entries")
    .values({
      workspace_id: e.workspaceId,
      kind,
      body: e.body.trim(),
      parent_id: e.parentId ?? null,
      view_id: null,
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
    .executeTakeFirstOrThrow();
}

// A new entry is current in the view it was written in.
export async function addNote(db: Db, e: NewEntry): Promise<ReviewEntry> {
  return { ...(await addEntry(db, "note", e)), state: "current" };
}

export async function editEntry(db: Db, id: number, body: string) {
  await db.updateTable("entries").set({ body: body.trim() }).where("id", "=", id).execute();
}

// Resolves a thread (its first entry), or reopens it.
export async function resolveThread(db: Db, id: number, resolved: boolean) {
  await db
    .updateTable("entries")
    .set({ resolved_at: resolved ? new Date().toISOString() : null })
    .where("id", "=", id)
    .execute();
}

export async function deleteEntry(db: Db, id: number) {
  await db.deleteFrom("entries").where("id", "=", id).execute();
}

// The workspace's current agent session, the agent pane's: the one last used, or a new one if it has none. Questions are
// turns in it, so the agent pane shows them and the agent keeps one context.
async function currentSession(db: Db, workspaceId: number): Promise<string> {
  const last =
    (await listAgentSessions(db, workspaceId)).find((s) => s.current) ??
    (await startAgentSession(db, workspaceId));
  return last.agentSessionId;
}

const where = (e: Pick<ReviewEntry, "path" | "startLine" | "endLine">) =>
  `${e.path}:${e.startLine === e.endLine ? e.startLine : `${e.startLine}–${e.endLine}`}`;

// Adds a question and sends it to the workspace's agent session as a comment, streaming the reply; the agent's text
// becomes an answer entry in the question's thread. Returns the question once saved and the session it went to, and
// the turn's result when it ends.
export async function askQuestion(
  db: Db,
  e: NewEntry,
  onChat: (threadId: number, entry: ChatEntry, agentSessionId: string) => void,
  onPermission: (threadId: number, p: Permission) => Promise<string | null>,
  onQueued: (threadId: number) => void,
): Promise<{ question: ReviewEntry; agentSessionId: string; turn: Promise<TurnResult> }> {
  return ask(db, await addEntry(db, "question", e), onChat, onPermission, onQueued);
}

// A thread's *Send to agent*: its latest note becomes a question and is asked, with the notes before it since the
// last question. Null when there's no such note (the agent has seen the thread).
export async function sendThread(
  db: Db,
  threadId: number,
  onChat: (threadId: number, entry: ChatEntry, agentSessionId: string) => void,
  onPermission: (threadId: number, p: Permission) => Promise<string | null>,
  onQueued: (threadId: number) => void,
): Promise<{ question: ReviewEntry; agentSessionId: string; turn: Promise<TurnResult> } | null> {
  const note = await db
    .selectFrom("entries")
    .select(columns)
    .where((eb) => eb.or([eb("id", "=", threadId), eb("parent_id", "=", threadId)]))
    .where("kind", "in", ["note", "question"])
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (note?.kind !== "note") return null;
  await db.updateTable("entries").set({ kind: "question" }).where("id", "=", note.id).execute();
  return ask(db, { ...note, kind: "question" }, onChat, onPermission, onQueued);
}

// The session each thread's question went to, while it waits or runs there: what a thread's Stop stops.
const asking = new Map<number, string>();

// A question the agent never saw, because it was taken off the queue, becomes a note again: the thread can be sent
// once more, and the notes since the last question still go with it.
async function ask(
  db: Db,
  question: Omit<ReviewEntry, "state">,
  onChat: (threadId: number, entry: ChatEntry, agentSessionId: string) => void,
  onPermission: (threadId: number, p: Permission) => Promise<string | null>,
  onQueued: (threadId: number) => void,
): Promise<{ question: ReviewEntry; agentSessionId: string; turn: Promise<TurnResult> }> {
  const threadId = question.parentId ?? question.id;
  const thread = await db
    .selectFrom("entries")
    .select(columns)
    .where((eb) => eb.or([eb("id", "=", threadId), eb("parent_id", "=", threadId)]))
    .where("id", "<", question.id)
    .orderBy("id")
    .execute();
  const root = thread[0] ?? question;
  const agentSessionId = await currentSession(db, question.workspaceId);
  const comment = { threadId, where: root.path ? where(root) : "the review", body: question.body };
  const prompt = formatComment(comment, unseen(question, thread, agentSessionId));
  await db
    .updateTable("entries")
    .set({ agent_session_id: agentSessionId })
    .where("id", "=", question.id)
    .execute();
  const texts = new Map<number | undefined, string>(); // by entry id, as they stream
  asking.set(threadId, agentSessionId);
  const turn = runTurn(db, agentSessionId, prompt, {
    onEntry: (c) => {
      if (c.kind === "text") texts.set(c.id, c.text);
      onChat(threadId, c, agentSessionId);
    },
    onPermission: (p) => onPermission(threadId, p),
    onQueued: () => onQueued(threadId),
  })
    .then(async (result) => {
      if (result.status === "ok" && texts.size)
        await addEntry(db, "answer", {
          workspaceId: question.workspaceId,
          body: [...texts.values()].join("\n\n"),
          parentId: threadId,
        });
      if (result.status === "unsent")
        await db
          .updateTable("entries")
          .set({ kind: "note", agent_session_id: null })
          .where("id", "=", question.id)
          .execute();
      return result;
    })
    .finally(() => asking.delete(threadId));
  return { question: { ...question, agentSessionId, state: "current" }, agentSessionId, turn };
}

// A thread's Stop: its question comes off the queue, or the turn answering it stops. Nothing if it has none going.
export async function stopQuestion(db: Db, threadId: number) {
  const agentSessionId = asking.get(threadId);
  if (agentSessionId) await stopComment(db, agentSessionId, threadId);
}

// Every thread of the workspace, as one message for the agent pane's session: where each points, the code, and its
// comments and answers in order, then what to do with them. An explanation or finding the user didn't reply to isn't
// part of their review, nor is a resolved thread.
function reviewPrompt(entries: Omit<ReviewEntry, "state">[]): { threads: number; prompt: string } {
  const replied = new Set(entries.filter((e) => e.parentId && !byAgent(e)).map((e) => e.parentId));
  const roots = entries.filter(
    (e) => e.path && !e.parentId && !e.resolvedAt && (!byAgent(e) || replied.has(e.id)),
  );
  const parts = roots.map((root, i) => {
    const thread = [root, ...entries.filter((e) => e.parentId === root.id)];
    const lines = thread.map((e) => `${byAgent(e) ? "You" : "Me"}: ${e.body}`);
    return `${i + 1}. On ${describe(root)}\n${lines.join("\n")}`;
  });
  const prompt = `Here's my review of this worktree's changes so far: every thread, with where it points and the code as it was
then, in order. "Me" is me, "You" is your earlier answers. Work through them: make the changes my comments ask for,
answer what's still open, and tell me briefly what you did for each and what you left.\n\n${parts.join("\n\n")}`;
  return { threads: roots.length, prompt };
}

// The review message sendReview sends, to paste elsewhere. Null with no threads.
export async function reviewPromptText(db: Db, workspaceId: number): Promise<string | null> {
  const { threads, prompt } = reviewPrompt(await workspaceEntries(db, workspaceId));
  return threads ? prompt : null;
}

// Sends every thread to the workspace's current agent session at once (see reviewPrompt), streaming the reply.
// handlers: made for the session it goes to, so the reply can stream to the agent pane showing it.
export async function sendReview(
  db: Db,
  workspaceId: number,
  handlers: (agentSessionId: string) => Parameters<typeof runTurn>[3],
): Promise<TurnResult> {
  const { threads, prompt } = reviewPrompt(await workspaceEntries(db, workspaceId));
  if (!threads) return { status: "error", message: "No threads to send" };
  const agentSessionId = await currentSession(db, workspaceId);
  return runTurn(db, agentSessionId, formatReview(threads, prompt), handlers(agentSessionId));
}

// Where a new comment goes, the composer's Comment/Agent toggle: to the agent (a question) or not (a note). Global.
export async function getCommentToAgent(db: Db): Promise<boolean> {
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", "comment.to-agent")
    .executeTakeFirst();
  return row?.value === "true";
}

export async function setCommentToAgent(db: Db, toAgent: boolean) {
  const value = String(toAgent);
  await db
    .insertInto("settings")
    .values({ key: "comment.to-agent", value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
}
