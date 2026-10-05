import { match, P } from "ts-pattern";
import type { Db } from "./db";
import { emit } from "./events.ts";
import { columns, liveEntries, type ReviewEntry, type Row } from "./entries.ts";
import { listPostable, type PostableThread, unposted } from "./pull-requests.ts";
import { startJob } from "./jobs.ts";
import { reviewRoots, summaryInstructions, summaryPrompt } from "./thread-context.ts";
import { getWorkspaceRepo } from "./workspaces.ts";

// Submit Review's draft (ADR 0037): the comment threads a review takes, for the user to pick from before they go to the
// agent, the clipboard or GitHub. Comments go as the user wrote them.

// A comment thread in the draft. entries: how many it has. comments: the user's not on GitHub yet, which Post to
// GitHub posts as they are. toAgent: Send to Agent and Copy as Prompt take it (open). post: what Post to GitHub does
// with it, null if nothing (no PR, or all of it is on GitHub already).
export type DraftThread = {
  threadId: number;
  path: string | null;
  lines: string;
  body: string;
  entries: number;
  comments: Pick<ReviewEntry, "id" | "body">[];
  toAgent: boolean;
  post: Pick<PostableThread, "placement" | "resolve"> | null;
};

const linesOf = (e: ReviewEntry) =>
  match(e)
    .with({ section: P.number.select() }, (section) => `§ ${section + 1}`)
    .when(
      (e) => e.startLine === e.endLine,
      () => `${e.startLine}`,
    )
    .otherwise(() => `${e.startLine}–${e.endLine}`);

export async function draftReview(db: Db, workspaceId: number): Promise<DraftThread[]> {
  const entries = await liveEntries(db, workspaceId);
  const hasPr = (await getWorkspaceRepo(db, workspaceId)).prNumber !== null;
  const postable = new Map(
    (hasPr ? await listPostable(db, workspaceId) : []).map((p) => [p.threadId, p]),
  );
  const toAgent = new Set(reviewRoots(entries).map((e) => e.id));
  return entries
    .filter((e) => toAgent.has(e.id) || postable.has(e.id))
    .map((root) => {
      const thread = [root, ...entries.filter((e) => e.parentId === root.id)];
      return {
        threadId: root.id,
        path: root.path,
        lines: linesOf(root),
        body: root.body,
        entries: thread.length,
        comments: thread.filter((e) => e.kind === "note" && unposted(e)),
        toAgent: toAgent.has(root.id),
        post: postable.get(root.id) ?? null,
      };
    });
}

// An agent thread's Summarize as Comment: the comment it comes to, from the summary model, for the user to edit. A job
// (ADR 0038) of one item, so it shows in Activity and is retried; the user waits on it.
export async function summarizeThread(db: Db, threadId: number): Promise<string> {
  const thread = await db
    .selectFrom("entries")
    .select(columns)
    .where((eb) => eb.or([eb("id", "=", threadId), eb("parent_id", "=", threadId)]))
    .orderBy("id")
    .execute();
  const root = thread[0];
  if (!root) throw new Error("The thread is gone");
  let comment: string | null = null;
  const done = new Promise<void>((resolve) =>
    startJob<Row>(db, {
      kind: "conclusions",
      workspaceId: root.workspaceId,
      why: "comment",
      base: "",
      head: "",
      total: 1,
      reused: 0,
      items: [root],
      name: (e) =>
        `${e.path ?? "View"}:${linesOf({ ...e, state: "current", shown: true, now: null })}`,
      batches: (items) => [items],
      ask: async (items, ask) => {
        const text = (await ask(summaryPrompt(root, thread), summaryInstructions, items)).trim();
        return new Map(text ? [[root, text]] : []);
      },
      save: async (_, text) => void (comment = text),
      settled: () => resolve(),
    }).catch(() => resolve()),
  );
  await done;
  if (comment === null) throw new Error("The summary model wrote nothing; see Activity");
  return comment;
}

// A new comment thread on the lines or passage of another thread: what Summarize as Comment adds. Resolves with its id.
export async function addCommentAt(db: Db, threadId: number, body: string): Promise<number> {
  if (!body.trim()) throw new Error("A comment needs text");
  const root = await db
    .selectFrom("entries")
    .selectAll()
    .where("id", "=", threadId)
    .executeTakeFirstOrThrow();
  const added = await db
    .insertInto("entries")
    .values({
      workspace_id: root.workspace_id,
      kind: "note",
      body: body.trim(),
      parent_id: null,
      view_id: root.view_id,
      path: root.path,
      side: root.side,
      start_line: root.start_line,
      end_line: root.end_line,
      code: root.code,
      base: root.base,
      head: root.head,
      revision: root.revision,
      section: root.section,
      quote_at: root.quote_at,
      created_at: new Date().toISOString(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  emit({ workspaceId: root.workspace_id, what: "entries" });
  return added.id;
}
