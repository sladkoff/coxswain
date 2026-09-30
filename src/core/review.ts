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
import {
  addEntry,
  columns,
  fresh,
  listEntries,
  type NewEntry,
  type ReviewEntry,
  type Row,
} from "./entries.ts";
import { anchored, byAgent, describe, fence, unseen } from "./thread-context.ts";
import { currentMergeBase } from "./git";

export { addNote, listEntries, type NewEntry, type ReviewEntry } from "./entries.ts";

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

const where = (e: Pick<ReviewEntry, "path" | "startLine" | "endLine" | "viewId" | "section">) =>
  e.section != null
    ? `view ${e.viewId} § ${e.section + 1}`
    : `${e.path}:${e.startLine === e.endLine ? e.startLine : `${e.startLine}–${e.endLine}`}`;

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
  question: Row,
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
  const comment = {
    threadId,
    where: anchored(root) ? where(root) : "the review",
    body: question.body,
  };
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
  return { question: fresh({ ...question, agentSessionId }), agentSessionId, turn };
}

// A thread's Stop: its question comes off the queue, or the turn answering it stops. Nothing if it has none going.
export async function stopQuestion(db: Db, threadId: number) {
  const agentSessionId = asking.get(threadId);
  if (agentSessionId) await stopComment(db, agentSessionId, threadId);
}

// Every thread of the workspace, as one message for the agent pane's session: where each points, the code, and its
// comments and answers in order, then what to do with them. An explanation or finding the user didn't reply to isn't
// part of their review, nor is a resolved thread. An outdated one goes with what its lines read now.
function reviewPrompt(entries: ReviewEntry[]): { threads: number; prompt: string } {
  const replied = new Set(entries.filter((e) => e.parentId && !byAgent(e)).map((e) => e.parentId));
  const roots = entries.filter(
    (e) => anchored(e) && !e.parentId && !e.resolvedAt && (!byAgent(e) || replied.has(e.id)),
  );
  const parts = roots.map((root, i) => {
    const thread = [root, ...entries.filter((e) => e.parentId === root.id)];
    const lines = thread.map((e) => `${byAgent(e) ? "You" : "Me"}: ${e.body}`);
    const changed = root.state === "outdated" ? `\n${since(root)}` : "";
    return `${i + 1}. On ${describe(root)}${changed}\n${lines.join("\n")}`;
  });
  const prompt = `Here's my review of this worktree's changes so far: every thread, with where it points and the code as it was
then, in order. "Me" is me, "You" is your earlier answers. Work through them: make the changes my comments ask for,
answer what's still open, and tell me briefly what you did for each and what you left.\n\n${parts.join("\n\n")}`;
  return { threads: roots.length, prompt };
}

// An outdated thread's lines have changed since, maybe for it: what they read now, for the agent to check first.
const since = (e: ReviewEntry) =>
  e.section != null
    ? "This section of the view has been rewritten since. Check whether the comment still applies before acting on it."
    : e.now == null
      ? "These lines have changed since. Check whether the comment still applies before acting on it."
      : `These lines have changed since${e.now ? `; they now read:\n${fence(e.now)}` : " and are gone."} Check whether the comment still applies before acting on it.`;

// The workspace's entries in the live diff, as the review prompt describes them.
async function liveEntries(db: Db, workspaceId: number): Promise<ReviewEntry[]> {
  const mergeBase = currentMergeBase(workspaceId);
  if (!mergeBase) throw new Error("Open the workspace first");
  return listEntries(db, workspaceId, mergeBase, mergeBase);
}

// The review message sendReview sends, to paste elsewhere. Null with no threads.
export async function reviewPromptText(db: Db, workspaceId: number): Promise<string | null> {
  const { threads, prompt } = reviewPrompt(await liveEntries(db, workspaceId));
  return threads ? prompt : null;
}

// Sends every thread to the workspace's current agent session at once (see reviewPrompt), streaming the reply.
// handlers: made for the session it goes to, so the reply can stream to the agent pane showing it.
export async function sendReview(
  db: Db,
  workspaceId: number,
  handlers: (agentSessionId: string) => Parameters<typeof runTurn>[3],
): Promise<TurnResult> {
  const { threads, prompt } = reviewPrompt(await liveEntries(db, workspaceId));
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
