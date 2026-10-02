import { createHash } from "node:crypto";
import { match, P } from "ts-pattern";
import type { Db } from "./db";
import { liveEntries, type ReviewEntry } from "./entries.ts";
import { listPostable, type PostableThread, unposted } from "./pull-requests.ts";
import { aheadIsOff, getSummarySettings, type Job, startJob } from "./jobs.ts";
import {
  byAgent,
  conclusionInstructions,
  conclusionsPrompt,
  parseConclusions,
  reviewRoots,
  type ToConclude,
} from "./thread-context.ts";
import { getWorkspaceRepo } from "./workspaces.ts";

// Submit Review's draft (ADR 0037): the threads a review takes, each with its conclusion (glossary), for the user to
// pick from and edit before it goes to the agent, the clipboard or GitHub.

// A thread in the draft. entries: how many it has. conclusion: where it ended up, "" with nothing to say (a resolve
// alone). written: by the summary model, rather than the user's own words (their one comment, or their edit). pending: the model is still
// writing it; conclusion is the user's last comment until then. toAgent: Send to Agent and Copy as Prompt take it
// (open, and the user's). post: what Post to GitHub does with it, null if nothing (no PR, or all of it is on GitHub
// already).
export type DraftThread = {
  threadId: number;
  path: string | null;
  lines: string;
  body: string;
  entries: number;
  conclusion: string;
  written: boolean;
  pending: boolean;
  toAgent: boolean;
  post: Pick<PostableThread, "placement" | "resolve"> | null;
};
// error: why the summary model wrote nothing; the conclusions are then the user's own last comments.
export type ReviewDraft = { threads: DraftThread[]; error: string | null };

// A conclusion is stored in thread_conclusions under the fingerprint of the entries it was written from, as a file
// summary is under its file diff's: a thread that changed has a new one and is concluded again, and the user's edit
// of the old one goes with it.
const fingerprintOf = (thread: Pick<ReviewEntry, "id" | "body">[]) =>
  createHash("sha256")
    .update(JSON.stringify(thread.map((e) => [e.id, e.body])))
    .digest("hex");
const store = (db: Db, threadId: number, fingerprint: string, conclusion: string, model: string) =>
  db
    .insertInto("thread_conclusions")
    .values({
      thread_id: threadId,
      fingerprint,
      conclusion,
      model,
      edited: Number(model === "you"),
      created_at: new Date().toISOString(),
    })
    .onConflict((oc) =>
      oc.column("thread_id").doUpdateSet((eb) => ({
        fingerprint: eb.ref("excluded.fingerprint"),
        conclusion: eb.ref("excluded.conclusion"),
        model: eb.ref("excluded.model"),
        edited: eb.ref("excluded.edited"),
        created_at: eb.ref("excluded.created_at"),
      })),
    )
    .execute();

// The user's edit of a thread's conclusion in Submit Review: kept until the thread changes.
export async function saveConclusion(db: Db, threadId: number, conclusion: string) {
  const thread = await db
    .selectFrom("entries")
    .select(["id", "body"])
    .where((eb) => eb.or([eb("id", "=", threadId), eb("parent_id", "=", threadId)]))
    .orderBy("id")
    .execute();
  if (thread.length) await store(db, threadId, fingerprintOf(thread), conclusion, "you");
}

// The threads a job is concluding, by thread and fingerprint: done once written or given up on, by which job.
type Run = { job: Job | null; error: string | null };
const writing = new Map<string, { done: Promise<void>; run: Run }>();

const linesOf = (e: ReviewEntry) =>
  match(e)
    .with({ section: P.number.select() }, (section) => `§ ${section + 1}`)
    .when(
      (e) => e.startLine === e.endLine,
      () => `${e.startLine}`,
    )
    .otherwise(() => `${e.startLine}–${e.endLine}`);

type Asking = {
  key: string;
  threadId: number;
  fingerprint: string;
  name: string;
  from: ToConclude;
};

// A job (ADR 0038) of one run, for the threads nobody is concluding yet.
async function write(db: Db, workspaceId: number, asking: Asking[], why: Job["why"]) {
  const mine = asking.filter((a) => !writing.has(a.key));
  if (!mine.length) return;
  const run: Run = { job: null, error: null };
  const release = new Map<string, () => void>();
  for (const a of mine)
    writing.set(a.key, { done: new Promise<void>((r) => release.set(a.key, r)), run });
  const settled = (a: Asking) => {
    const resolve = release.get(a.key);
    if (!resolve) return;
    release.delete(a.key);
    writing.delete(a.key);
    resolve();
  };
  try {
    run.job = await startJob<Asking>(db, {
      kind: "conclusions",
      workspaceId,
      why,
      base: "",
      head: "",
      total: asking.length,
      reused: asking.length - mine.length,
      items: mine,
      name: (a) => a.name,
      batches: (items) => (items.length ? [items] : []),
      ask: async (items, ask) => {
        const text = await ask(
          conclusionsPrompt(items.map((a) => a.from)),
          conclusionInstructions,
          items,
        );
        return new Map(
          [...parseConclusions(text, items.length)].map(([n, comment]) => [items[n - 1], comment]),
        );
      },
      save: (a, conclusion, by) => store(db, a.threadId, a.fingerprint, conclusion, by),
      settled,
    });
  } catch (e) {
    run.error = (e as Error).message;
    mine.forEach(settled);
  }
}

// The draft as it is now, and the conclusions still to write.
async function build(db: Db, workspaceId: number) {
  const entries = await liveEntries(db, workspaceId);
  const hasPr = (await getWorkspaceRepo(db, workspaceId)).prNumber !== null;
  const postable = new Map(
    (hasPr ? await listPostable(db, workspaceId) : []).map((p) => [p.threadId, p]),
  );
  const toAgent = new Set(reviewRoots(entries).map((e) => e.id));
  const roots = entries.filter((e) => toAgent.has(e.id) || postable.has(e.id));
  const stored = new Map(
    (roots.length
      ? await db
          .selectFrom("thread_conclusions")
          .selectAll()
          .where(
            "thread_id",
            "in",
            roots.map((r) => r.id),
          )
          .execute()
      : []
    ).map((r) => [r.thread_id, r]),
  );
  const asking: Asking[] = [];
  const threads = roots.map((root): DraftThread => {
    const thread = [root, ...entries.filter((e) => e.parentId === root.id)];
    // What the conclusion is of: the whole thread, or what's new here on one from GitHub.
    const fresh = root.githubThreadId ? thread.filter(unposted) : thread;
    const own = fresh.length === 1 && !byAgent(fresh[0]);
    const fingerprint = fingerprintOf(thread.toSorted((a, b) => a.id - b.id));
    const key = `${root.id}:${fingerprint}`;
    // What's stored for the thread as it is now, the user's edit of their one comment too.
    const has = stored.get(root.id)?.fingerprint === fingerprint ? stored.get(root.id) : undefined;
    const pending = fresh.length > 0 && !own && !has;
    if (pending)
      asking.push({
        key,
        threadId: root.id,
        fingerprint,
        name: `${root.path ?? "View"}:${linesOf(root)}`,
        from: {
          root,
          thread,
          ...(root.githubThreadId && { fresh: new Set(fresh.map((e) => e.id)) }),
        },
      });
    return {
      threadId: root.id,
      path: root.path,
      lines: linesOf(root),
      body: root.body,
      entries: thread.length,
      conclusion:
        has?.conclusion ?? (own ? fresh[0].body : (fresh.findLast((e) => !byAgent(e))?.body ?? "")),
      written: !!has && !has.edited,
      pending,
      toAgent: toAgent.has(root.id),
      post: postable.get(root.id) ?? null,
    };
  });
  return { threads, asking };
}

// The draft, with a job started for the conclusions it lacks. wait: until they're written, or the job gave up.
// Without it the draft comes at once, its unwritten threads pending, for the dialog to show what there is.
export async function draftReview(
  db: Db,
  workspaceId: number,
  wait: boolean,
): Promise<ReviewDraft> {
  const first = await build(db, workspaceId);
  await write(db, workspaceId, first.asking, "submit");
  if (!wait || !first.asking.length) return { threads: first.threads, error: null };
  const runs = first.asking.flatMap((a) => writing.get(a.key) ?? []);
  await Promise.all(runs.map((r) => r.done));
  const { threads } = await build(db, workspaceId);
  return {
    threads: threads.map((t) => ({ ...t, pending: false })),
    error: threads.some((t) => t.pending)
      ? (runs.map((r) => r.run.error ?? r.run.job?.error).find(Boolean) ??
        "The summary model wrote no conclusion for some threads")
      : null,
  };
}

// Conclusions ahead (background.ts): once a workspace's threads have been still for a moment, those that changed are
// concluded, so Submit Review opens with them written. A thread an agent is answering waits: its answer changes it.
// ponytail: every changed thread costs a model run, whether the review is submitted or not; work ahead can be turned
// off in Settings.
const stillFor = 3000;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
export function concludeAhead(
  db: Db,
  workspaceId: number,
  answering: (threadId: number) => boolean,
) {
  clearTimeout(timers.get(workspaceId));
  timers.set(
    workspaceId,
    setTimeout(async () => {
      timers.delete(workspaceId);
      try {
        if (aheadIsOff(await getSummarySettings(db))) return;
        const { asking } = await build(db, workspaceId);
        await write(
          db,
          workspaceId,
          asking.filter((a) => !answering(a.threadId)),
          "ahead",
        );
      } catch {
        // The workspace isn't open, or is gone: the dialog asks again when it opens.
      }
    }, stillFor),
  );
}
