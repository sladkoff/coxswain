import {
  type ChatEntry,
  formatCheck,
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
import { emit } from "./events.ts";
import {
  addEntry,
  columns,
  fresh,
  liveEntries,
  type NewEntry,
  type ReviewEntry,
  type Row,
} from "./entries.ts";
import {
  anchored,
  describe,
  fence,
  isComment,
  reviewRoots,
  unseen,
  who,
} from "./thread-context.ts";
import { type Check, githubGraphql, readJobLog } from "./github";
import {
  dropThread,
  inConversation,
  marker,
  oneAtATime,
  prOf,
  resolveOnGitHub,
  withHeader,
} from "./pull-requests.ts";

export { addNote, listEntries, type NewEntry, type ReviewEntry } from "./entries.ts";

// Each write emits entries for its workspace (ADR 0038), so whatever shows the thread refetches.
const changedIn = (row: { workspace_id: number } | undefined) =>
  row && emit({ workspaceId: row.workspace_id, what: "entries" });

// A change to the user's comments on GitHub; throws what went wrong, so the change isn't made here either.
async function onGitHub(query: string, variables: Record<string, unknown>) {
  const r = await githubGraphql(query, variables);
  if (r.status === "ok") return;
  throw new Error(
    r.status === "error" ? r.message : "Sign in to GitHub with gh to change it there too",
  );
}

// A posted comment's mutations: on a review thread, or in the PR's conversation (inConversation).
const mutations = (e: { github_url: string | null }) =>
  inConversation({ githubUrl: e.github_url })
    ? {
        edit: `mutation($id: ID!, $body: String!) { updateIssueComment(input: {id: $id, body: $body}) { clientMutationId } }`,
        remove: `mutation($id: ID!) { deleteIssueComment(input: {id: $id}) { clientMutationId } }`,
      }
    : {
        edit: `mutation($id: ID!, $body: String!) { updatePullRequestReviewComment(input: {
          pullRequestReviewCommentId: $id, body: $body }) { clientMutationId } }`,
        remove: `mutation($id: ID!) { deletePullRequestReviewComment(input: {id: $id}) { clientMutationId } }`,
      };

// What a posted comment's text becomes on GitHub: in the PR's conversation, after what coxswain put before it, as it
// is there now (withHeader).
async function onGitHubAs(
  e: { github_id: string | null; github_url: string | null },
  text: string,
) {
  if (!inConversation({ githubUrl: e.github_url })) return text;
  const now = await githubGraphql<{ node: { body: string } | null }>(
    `query($id: ID!) { node(id: $id) { ... on IssueComment { body } } }`,
    { id: e.github_id },
  );
  if (now.status !== "ok")
    throw new Error(
      now.status === "error" ? now.message : "Sign in to GitHub with gh to change it there too",
    );
  const body = now.data.node?.body ?? "";
  const at = body.indexOf(marker);
  return at < 0 ? text : withHeader(body.slice(0, at).trim(), text);
}

// A comment already posted is edited on GitHub too, in its workspace's turn with reads of GitHub (oneAtATime).
export async function editEntry(db: Db, id: number, body: string) {
  const e = await db
    .selectFrom("entries")
    .select(["kind", "github_id", "github_url", "workspace_id"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (e?.kind === "note" && e.github_id)
    return oneAtATime(e.workspace_id, async () => {
      await onGitHub(mutations(e).edit, {
        id: e.github_id,
        body: await onGitHubAs(e, body.trim()),
      });
      await edit(db, id, body);
    });
  await edit(db, id, body);
}
const edit = async (db: Db, id: number, body: string) =>
  changedIn(
    await db
      .updateTable("entries")
      .set({ body: body.trim() })
      .where("id", "=", id)
      .returning("workspace_id")
      .executeTakeFirst(),
  );

// Resolves a thread (its first entry), or reopens it.
// With Post to GitHub on (getPostComments), a thread on GitHub is resolved or reopened there at once, first: a failure
// there leaves it as it was here. Otherwise that waits for Submit Review.
export async function resolveThread(db: Db, id: number, resolved: boolean) {
  const root = await db
    .selectFrom("entries")
    .select(["workspace_id", "github_thread_id", "github_resolved"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (
    root?.github_thread_id &&
    root.github_resolved !== Number(resolved) &&
    (await getPostComments(db))
  )
    return oneAtATime(root.workspace_id, async () => {
      const done = await resolveOnGitHub(
        db,
        { id, githubThreadId: root.github_thread_id },
        resolved,
      );
      if (done.status !== "ok")
        throw new Error(
          done.status === "error"
            ? done.message
            : "Sign in to GitHub with gh to resolve it there too",
        );
      await resolveHere(db, id, resolved);
    });
  await resolveHere(db, id, resolved);
}
const resolveHere = async (db: Db, id: number, resolved: boolean) =>
  changedIn(
    await db
      .updateTable("entries")
      .set({ resolved_at: resolved ? new Date().toISOString() : null })
      .where("id", "=", id)
      .returning("workspace_id")
      .executeTakeFirst(),
  );

// One of the user's comments, deleted on GitHub too if it was posted (one already gone there is deleted here all the
// same). The first of a thread takes what came from GitHub with it here (dropThread): GitHub keeps a thread with
// replies, and the next read brings what's left back as a thread of its own; the user's unposted notes stay.
export async function deleteComment(db: Db, id: number) {
  const e = await db
    .selectFrom("entries")
    .select(["workspace_id", "parent_id", "github_id", "github_url"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!e) return;
  await oneAtATime(e.workspace_id, async () => {
    if (e.github_id) await deleteOnGitHub(e);
    if (e.parent_id === null) await dropThread(db, id);
    else await db.deleteFrom("entries").where("id", "=", id).execute();
  });
  emit({ workspaceId: e.workspace_id, what: "entries" });
}
const deleteOnGitHub = (e: { github_id: string | null; github_url: string | null }) =>
  onGitHub(mutations(e).remove, { id: e.github_id }).catch((err: Error) => {
    if (!/Could not resolve to a node/.test(err.message)) throw err;
  });

// A thread's comments already posted are deleted on GitHub too, replies first; others' replies stay there.
export async function deleteEntry(db: Db, id: number) {
  const root = await db
    .selectFrom("entries")
    .select("workspace_id")
    .where("id", "=", id)
    .executeTakeFirst();
  if (root) return oneAtATime(root.workspace_id, () => remove(db, id));
}
// One already gone from GitHub is deleted here all the same.
async function remove(db: Db, id: number) {
  const posted = await db
    .selectFrom("entries")
    .select(["github_id", "github_url"])
    .where((eb) => eb.or([eb("id", "=", id), eb("parent_id", "=", id)]))
    .where("kind", "=", "note")
    .where("github_id", "is not", null)
    .orderBy("id", "desc")
    .execute();
  for (const p of posted) await deleteOnGitHub(p);
  changedIn(
    await db
      .deleteFrom("entries")
      .where("id", "=", id)
      .returning("workspace_id")
      .executeTakeFirst(),
  );
}

// The workspace's current agent session, the agent pane's: the one last used, or a new one if it has none. Questions are
// turns in it, so the agent pane shows them and the agent keeps one context.
export async function currentSession(db: Db, workspaceId: number): Promise<string> {
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
  if (e.parentId && (await inCommentThread(db, e.parentId)))
    throw new Error("A comment thread doesn't go to the agent");
  return ask(db, await addEntry(db, "question", e), onChat, onPermission, onQueued);
}

const inCommentThread = async (db: Db, threadId: number) => {
  const root = await db
    .selectFrom("entries")
    .select("kind")
    .where("id", "=", threadId)
    .executeTakeFirst();
  return !!root && isComment(root);
};

// An agent thread's *Send to agent*: its latest note becomes a question and is asked, with the notes before it since
// the last question. Null when there's no such note (the agent has seen the thread), or on a comment thread.
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
  if (note?.kind !== "note" || (await inCommentThread(db, threadId))) return null;
  await db.updateTable("entries").set({ kind: "question" }).where("id", "=", note.id).execute();
  return ask(db, { ...note, kind: "question" }, onChat, onPermission, onQueued);
}

// The session each thread's question went to, while it waits or runs there: what a thread's Stop stops.
const asking = new Map<number, string>();
export const isAsking = (threadId: number) => asking.has(threadId);

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

// Every open comment thread of the workspace, as one message for the agent pane's session: where each points, the code,
// and its comments in order, then what to do with them. Agent threads aren't part of the review, nor is a resolved
// thread. An outdated one goes with what its lines read now. threadIds: from Submit Review, only the threads picked
// there.
function reviewPrompt(
  entries: ReviewEntry[],
  threadIds?: number[],
): { threads: number; prompt: string } {
  const picked = threadIds && new Set(threadIds);
  const roots = reviewRoots(entries).filter((e) => !picked || picked.has(e.id));
  const parts = roots.map((root, i) => {
    const thread = [root, ...entries.filter((e) => e.parentId === root.id)];
    const lines = thread.map((e) => `${who(e)}: ${e.body}`);
    const changed = root.state === "outdated" ? `\n${since(root)}` : "";
    return `${i + 1}. On ${describe(root)}${changed}\n${lines.join("\n")}`;
  });
  const prompt = `Here's my review of this worktree's changes so far: every thread, with where it points and the code as it was
then, in order. "Me" is me, "@name" a reviewer on GitHub. Work through them: make the changes the comments ask for,
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

// The review message sendReview sends, to paste elsewhere. Null with no threads.
export async function reviewPromptText(
  db: Db,
  workspaceId: number,
  threadIds?: number[],
): Promise<string | null> {
  const { threads, prompt } = reviewPrompt(await liveEntries(db, workspaceId), threadIds);
  return threads ? prompt : null;
}

// Sends every thread to the workspace's current agent session at once (see reviewPrompt), streaming the reply.
// handlers: made for the session it goes to, so the reply can stream to the agent pane showing it.
export async function sendReview(
  db: Db,
  workspaceId: number,
  handlers: (agentSessionId: string) => Parameters<typeof runTurn>[3],
  threadIds?: number[],
): Promise<TurnResult> {
  const { threads, prompt } = reviewPrompt(await liveEntries(db, workspaceId), threadIds);
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
  emit({ what: "settings" });
}

// Whether a new comment is posted to GitHub at once, rather than collected for Submit Review: the composer's Post to
// GitHub checkbox. Global.
export async function getPostComments(db: Db): Promise<boolean> {
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", "comment.post")
    .executeTakeFirst();
  return row?.value === "true";
}

export async function setPostComments(db: Db, post: boolean) {
  const value = String(post);
  await db
    .insertInto("settings")
    .values({ key: "comment.post", value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
  emit({ what: "settings" });
}

// A failed check, to the workspace's current agent session: its name and what it says, and for a GitHub Actions job
// the end of its log, to find out why and fix it. handlers: made for the session it goes to, as sendReview's.
export async function sendCheck(
  db: Db,
  workspaceId: number,
  check: Check,
  handlers: (agentSessionId: string) => Parameters<typeof runTurn>[3],
): Promise<TurnResult> {
  const w = await prOf(db, workspaceId);
  const log = check.jobId !== null ? await readJobLog(w.owner, w.name, check.jobId) : null;
  const ending =
    log?.status === "ok"
      ? `The end of its log:\n${fence(log.log)}`
      : `Its log couldn't be read here${check.url ? `; it's at ${check.url}` : ""}.`;
  const prompt = `The check "${check.name}" fails on this PR's head on GitHub${check.detail ? `: ${check.detail}` : "."}

${ending}

Find out why it fails, and fix it if the cause is in this branch's changes. Tell me briefly what you found and did.`;
  const agentSessionId = await currentSession(db, workspaceId);
  return runTurn(db, agentSessionId, formatCheck(check.name, prompt), handlers(agentSessionId));
}
