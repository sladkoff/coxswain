import {
  type ChatEntry,
  formatComment,
  formatReview,
  listAgentSessions,
  type Permission,
  runTurn,
  startAgentSession,
  stopTurn,
  type TurnResult,
} from "./agents";
import type { Db } from "./db";
import { readTexts } from "./git";

// ADR 0015: a workspace's entries (glossary): notes, questions and answers, threaded by parent_id; and the agent's
// explanations and findings, which belong to a guide too (guideId, ADR 0023).
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
  guideId: number | null;
  path: string | null;
  side: "old" | "new" | null;
  startLine: number | null;
  endLine: number | null;
  code: string | null;
  base: string | null;
  head: string | null;
  createdAt: string;
  resolvedAt: string | null; // on a thread's first entry: when it was resolved
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
  "guide_id as guideId",
  "path",
  "side",
  "start_line as startLine",
  "end_line as endLine",
  "code",
  "base",
  "head",
  "created_at as createdAt",
  "resolved_at as resolvedAt",
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
      guide_id: null,
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

function describe(
  a: Pick<ReviewEntry, "path" | "side" | "startLine" | "endLine" | "code"> &
    Partial<Pick<ReviewEntry, "base" | "head">>,
): string {
  const lines =
    a.startLine === a.endLine ? `line ${a.startLine}` : `lines ${a.startLine}-${a.endLine}`;
  const at = (sha: string) => `commit ${sha.slice(0, 7)}`;
  const where =
    a.side === "old"
      ? `removed, as at ${a.base ? at(a.base) : "the merge base"}`
      : a.head
        ? `as at ${at(a.head)}`
        : "as in the worktree then";
  const fence = "`".repeat(
    Math.max(3, ...[...(a.code ?? "").matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
  return `\`${a.path}\` ${lines} (${where}):\n${fence}\n${a.code}\n${fence}`;
}

// The workspace's current agent session, the agent pane's: the latest, or a new one if it has none. Questions are
// turns in it, so the agent pane shows them and the agent keeps one context.
async function currentSession(db: Db, workspaceId: number): Promise<string> {
  const last =
    (await listAgentSessions(db, workspaceId)).at(-1) ?? (await startAgentSession(db, workspaceId));
  return last.agentSessionId;
}

// Entries the agent wrote, not the user.
const byAgent = (e: Pick<ReviewEntry, "kind">) =>
  e.kind === "answer" || e.kind === "explanation" || e.kind === "finding";

const where = (e: Pick<ReviewEntry, "path" | "startLine" | "endLine">) =>
  `${e.path}:${e.startLine === e.endLine ? e.startLine : `${e.startLine}–${e.endLine}`}`;

// What the agent session hasn't seen of the question's thread, to go after it: the anchor, unless an earlier question
// in the thread carried it, what the agent wrote if the thread began as its explanation or finding (it may have been
// another session), and the notes written in the thread since its last question.
function unseen(
  question: Omit<ReviewEntry, "state">,
  thread: Omit<ReviewEntry, "state">[],
): string {
  if (question.path) return `About ${describe(question)}`;
  const asked = thread.findLast((e) => e.kind === "question");
  const notes = thread.filter((e) => e.kind === "note" && e.id > (asked?.id ?? 0));
  const about = !asked && thread[0]?.path ? [`About ${describe(thread[0])}`] : [];
  const yours =
    !asked && thread[0] && byAgent(thread[0])
      ? [`You wrote there, in a guide: ${thread[0].body}`]
      : [];
  return [...about, ...yours, ...notes.map((n) => `Earlier in the thread: ${n.body}`)].join("\n\n");
}

// Adds a question and sends it to the workspace's agent session as a comment, streaming the reply; the agent's text
// becomes an answer entry in the question's thread. Returns the question once saved and the session it went to, and
// the turn's result when it ends.
export async function askQuestion(
  db: Db,
  e: NewEntry,
  onChat: (threadId: number, entry: ChatEntry, agentSessionId: string) => void,
  onPermission: (threadId: number, p: Permission) => Promise<string | null>,
): Promise<{ question: ReviewEntry; agentSessionId: string; turn: Promise<TurnResult> }> {
  return ask(db, await addEntry(db, "question", e), onChat, onPermission);
}

// A thread's *Send to agent*: its latest note becomes a question and is asked, with the notes before it since the
// last question. Null when there's no such note (the agent has seen the thread).
export async function sendThread(
  db: Db,
  threadId: number,
  onChat: (threadId: number, entry: ChatEntry, agentSessionId: string) => void,
  onPermission: (threadId: number, p: Permission) => Promise<string | null>,
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
  return ask(db, { ...note, kind: "question" }, onChat, onPermission);
}

async function ask(
  db: Db,
  question: Omit<ReviewEntry, "state">,
  onChat: (threadId: number, entry: ChatEntry, agentSessionId: string) => void,
  onPermission: (threadId: number, p: Permission) => Promise<string | null>,
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
  const texts = new Map<number | undefined, string>(); // by entry id, as they stream
  const turn = runTurn(db, agentSessionId, formatComment(comment, unseen(question, thread)), {
    onEntry: (c) => {
      if (c.kind === "text") texts.set(c.id, c.text);
      onChat(threadId, c, agentSessionId);
    },
    onPermission: (p) => onPermission(threadId, p),
  }).then(async (result) => {
    if (result.status === "ok" && texts.size)
      await addEntry(db, "answer", {
        workspaceId: question.workspaceId,
        body: [...texts.values()].join("\n\n"),
        parentId: threadId,
      });
    return result;
  });
  return { question: { ...question, state: "current" }, agentSessionId, turn };
}

export async function stopQuestion(db: Db, workspaceId: number) {
  const last = (await listAgentSessions(db, workspaceId)).at(-1);
  if (last) await stopTurn(db, last.agentSessionId);
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
  return { threads: roots.length, prompt: formatReview(roots.length, prompt) };
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
  return runTurn(db, agentSessionId, prompt, handlers(agentSessionId));
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
