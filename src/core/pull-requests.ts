import { match, P } from "ts-pattern";
import type { Db } from "./db.ts";
import { listEntries, type ReviewEntry } from "./entries.ts";
import {
  type Forge,
  forgeOf,
  type ForgeProblem,
  type ForgeResult,
  type Posted,
  type Pr,
  type PostTarget,
  type PullRequestChange,
  type PullRequestList,
  type PullRequestRef,
  type PullRequestResult,
  type PullRequestTitles,
  type ReviewThread,
  type Verdict,
} from "./forge.ts";
import { currentHead, currentMergeBase, pinRevision, readFileDiff, readTexts } from "./git.ts";
import { fence, isComment, quote } from "./thread-context.ts";
import { forgeRepo, getProject } from "./projects.ts";
import { getWorkspaceRepo } from "./workspaces.ts";

// ADR 0037: a workspace's PR on its forge (ADR 0041). Reading it mirrors its review threads into the workspace's
// entries; posting sends picked threads back as one review. Nothing goes to the forge without the user asking.

// The workspace's PR, and the forge it's on.
export async function prOf(db: Db, workspaceId: number): Promise<{ pr: Pr; forge: Forge }> {
  const w = await getWorkspaceRepo(db, workspaceId);
  const repo = forgeRepo(w);
  if (w.prNumber === null || !repo) throw new Error("The workspace has no pull request");
  return { pr: { repo, number: w.prNumber }, forge: forgeOf(repo.forge) };
}

// A project's open PRs, to start a workspace from, and the title and state of some of them for the workspace rail.
export async function listPullRequests(db: Db, projectId: number): Promise<PullRequestList> {
  const repo = forgeRepo(await getProject(db, projectId));
  return repo ? forgeOf(repo.forge).listPullRequests(repo) : { status: "ok", pulls: [] };
}
export async function listPullRequestTitles(
  db: Db,
  projectId: number,
  numbers: number[],
): Promise<PullRequestTitles> {
  const repo = forgeRepo(await getProject(db, projectId));
  return repo
    ? forgeOf(repo.forge).listPullRequestTitles(repo, numbers)
    : { status: "ok", pulls: [] };
}

// What reads and changes a workspace's threads on its forge runs one at a time: a read mirrors the forge as it was when it
// asked, so one that overlapped a post would copy the posted comment in beside the entry it was posted from, or take
// that entry for one deleted there. A read holds its turn from asking to saving.
const turns = new Map<number, Promise<unknown>>();
export function oneAtATime<T>(workspaceId: number, fn: () => Promise<T>): Promise<T> {
  const mine = (turns.get(workspaceId) ?? Promise.resolve()).catch(() => {}).then(fn);
  turns.set(workspaceId, mine);
  void mine
    .finally(() => turns.get(workspaceId) === mine && turns.delete(workspaceId))
    .catch(() => {});
  return mine;
}

// The PR for its panel. Its review threads are mirrored into entries first; changed says whether that changed any.
export const readPullRequest = (db: Db, workspaceId: number) =>
  oneAtATime(workspaceId, () => read(db, workspaceId));
async function read(
  db: Db,
  workspaceId: number,
): Promise<{ pr: PullRequestResult; changed: boolean }> {
  const { pr: at, forge } = await prOf(db, workspaceId);
  const pr = await forge.getPullRequest(at);
  const mergeBase = currentMergeBase(workspaceId);
  // Threads are anchored in the worktree, so they wait until it's open.
  if (pr.status !== "ok" || !mergeBase) return { pr, changed: false };
  const seen = { viewer: pr.viewer, complete: true };
  const threads = await syncThreads(db, workspaceId, pr.threads, mergeBase, seen);
  const comments = await syncConversation(db, workspaceId, pr.comments, true);
  return { pr, changed: threads || comments };
}

const now = () => new Date().toISOString();

// Mirrors review threads into entries (ADR 0037): a thread's first comment becomes its first entry, on the lines it was
// written on, and the rest replies, each of kind 'comment', or 'note' when the viewer wrote it: the user's own comments
// are theirs to edit and delete wherever they wrote them. A comment posted from here is the entry it was posted from,
// so the replies of others land in the user's own thread. Text edited on the forge is updated here, a reply deleted there
// is deleted here; a resolve or reopen on the forge is taken over. A thread gone from the forge, or whose first comment is
// (a forge keeps a thread for its replies), is dropped here (dropThread), the next read mirroring what's left as a new
// one. Only from a complete read (complete), and replies only from a thread read in full.
export async function syncThreads(
  db: Db,
  workspaceId: number,
  threads: ReviewThread[],
  mergeBase: string,
  seen: { viewer?: string; complete?: boolean } = {},
): Promise<boolean> {
  const select = () =>
    db
      .selectFrom("entries")
      .select([
        "id",
        "kind",
        "body",
        "parent_id as parentId",
        "forge_id as forgeId",
        "forge_thread_id as forgeThreadId",
        "forge_resolved as forgeResolved",
      ])
      .where("workspace_id", "=", workspaceId)
      .where((eb) => eb.or([eb("forge_id", "is not", null), eb("forge_thread_id", "is not", null)]))
      .execute();
  let known = await select();
  let changed = false;
  const kindOf = (author: string) => (author === seen.viewer ? "note" : "comment");
  if (seen.complete) {
    const byId = new Map(threads.map((t) => [t.id, t]));
    const stale = known.filter((k) => {
      if (k.parentId !== null || !k.forgeThreadId) return false;
      const t = byId.get(k.forgeThreadId);
      return !t || (!!k.forgeId && t.comments[0]?.id !== k.forgeId);
    });
    for (const k of stale) await dropThread(db, k.id);
    if (stale.length) {
      known = await select();
      changed = true;
    }
  }
  const byForgeId = new Map(known.flatMap((k) => (k.forgeId ? [[k.forgeId, k]] : [])));
  for (const t of threads) {
    const [first, ...replies] = t.comments;
    if (!first) continue;
    let root =
      known.find((k) => k.forgeThreadId === t.id && k.parentId === null) ?? byForgeId.get(first.id);
    if (!root) {
      root = {
        ...(await mirrorThread(db, workspaceId, t, mergeBase, kindOf(first.author))),
        parentId: null,
      };
      changed = true;
    } else {
      const resolved = (root.forgeResolved === 1) !== t.resolved;
      const mine = root.kind === "comment" && kindOf(first.author) === "note";
      if (
        root.forgeThreadId !== t.id ||
        resolved ||
        mine ||
        (root.forgeId === first.id && root.body !== first.body)
      ) {
        await db
          .updateTable("entries")
          .set({
            forge_thread_id: t.id,
            forge_resolved: Number(t.resolved),
            ...(resolved && { resolved_at: t.resolved ? now() : null }),
            ...(root.forgeId === first.id && { body: first.body }),
            ...(mine && { kind: "note" as const }),
          })
          .where("id", "=", root.id)
          .execute();
        changed = true;
      }
    }
    for (const c of replies) {
      const row = byForgeId.get(c.id);
      const kind = row?.kind === "comment" ? kindOf(c.author) : row?.kind;
      if (row && row.body === c.body && row.kind === kind) continue;
      changed = true;
      if (row)
        await db
          .updateTable("entries")
          .set({ body: c.body, kind })
          .where("id", "=", row.id)
          .execute();
      else
        await db
          .insertInto("entries")
          .values({
            workspace_id: workspaceId,
            kind: kindOf(c.author),
            body: c.body,
            parent_id: root.id,
            view_id: null,
            path: null,
            side: null,
            start_line: null,
            end_line: null,
            code: null,
            base: null,
            head: null,
            revision: null,
            created_at: c.createdAt,
            author: c.author,
            forge_id: c.id,
            forge_url: c.url,
          })
          .execute();
    }
    if (!t.complete) continue;
    const there = new Set(t.comments.map((c) => c.id));
    const gone = known.filter((k) => k.parentId === root.id && k.forgeId && !there.has(k.forgeId));
    if (gone.length) {
      changed = true;
      await db
        .deleteFrom("entries")
        .where(
          "id",
          "in",
          gone.map((g) => g.id),
        )
        .execute();
    }
  }
  return changed;
}

// The comments posted from here in the PR's conversation, kept up with the forge: an edit there is taken over (the user's
// text, after coxswain's marker), and one deleted there is deleted here, its thread with it if it was the first
// (dropThread). Deletes only when the read got every comment. Others' comments
// stay in the PR panel's conversation: the forge doesn't thread them.
export async function syncConversation(
  db: Db,
  workspaceId: number,
  comments: { id: string; body: string }[],
  complete: boolean,
): Promise<boolean> {
  const posted = (
    await db
      .selectFrom("entries")
      .select([
        "id",
        "parent_id as parentId",
        "body",
        "forge_id as forgeId",
        "forge_url as forgeUrl",
      ])
      .where("workspace_id", "=", workspaceId)
      .where("forge_conversation", "=", 1)
      .execute()
  ).filter((e) => e.forgeId);
  const there = new Map(comments.map((c) => [c.id, textOf(c.body)]));
  let changed = false;
  for (const e of posted) {
    const text = there.get(e.forgeId!);
    if (text !== undefined && text !== e.body) {
      await db.updateTable("entries").set({ body: text }).where("id", "=", e.id).execute();
      changed = true;
    }
  }
  const gone = complete ? posted.filter((e) => !there.has(e.forgeId!)) : [];
  for (const e of gone)
    if (e.parentId === null) await dropThread(db, e.id);
    else await db.deleteFrom("entries").where("id", "=", e.id).execute();
  return changed || gone.length > 0;
}

// A thread gone from the forge, dropped here as it was there: what was on the forge goes, and the user's notes not posted yet
// stay, as a local thread on the same anchor with the first of them first.
export async function dropThread(db: Db, rootId: number) {
  const drafts = await db
    .selectFrom("entries")
    .select("id")
    .where("parent_id", "=", rootId)
    .where("kind", "=", "note")
    .where("forge_id", "is", null)
    .orderBy("id")
    .execute();
  if (drafts.length) {
    const root = await db
      .selectFrom("entries")
      .selectAll()
      .where("id", "=", rootId)
      .executeTakeFirstOrThrow();
    const [first, ...rest] = drafts;
    await db
      .updateTable("entries")
      .set({
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
      })
      .where("id", "=", first.id)
      .execute();
    if (rest.length)
      await db
        .updateTable("entries")
        .set({ parent_id: first.id })
        .where(
          "id",
          "in",
          rest.map((d) => d.id),
        )
        .execute();
  }
  await db.deleteFrom("entries").where("id", "=", rootId).execute();
}

// What coxswain puts before the user's text in a comment it posts in the PR's conversation (what it's about, or what it
// replies to), and how the text is told from it again: after the marker, hidden on the forge.
export const marker = "<!-- coxswain -->";
export const withHeader = (header: string, text: string) => `${header}\n\n${marker}\n${text}`;
export const textOf = (body: string) => {
  const at = body.indexOf(marker);
  return (at < 0 ? body : body.slice(at + marker.length)).trim();
};

// A thread's first entry, on its lines as they were where it was written: the new side at its comment's commit, the
// old side at the merge base. A commit the clone doesn't have leaves it without code, so it reads as outdated.
async function mirrorThread(
  db: Db,
  workspaceId: number,
  t: ReviewThread,
  mergeBase: string,
  kind: "note" | "comment",
) {
  const first = t.comments[0];
  const at = t.side === "old" ? mergeBase : t.commit;
  const revision = at && (await pinRevision(db, workspaceId, at).catch(() => null));
  const text = revision && (await readTexts(db, workspaceId, [t.path], revision)).get(t.path);
  const code = text
    ? text
        .split("\n")
        .slice(t.startLine! - 1, t.endLine!)
        .join("\n")
    : "";
  return db
    .insertInto("entries")
    .values({
      workspace_id: workspaceId,
      kind,
      body: first.body,
      parent_id: null,
      view_id: null,
      path: t.path,
      side: t.side,
      start_line: t.startLine!,
      end_line: t.endLine!,
      code,
      base: mergeBase,
      head: t.side === "new" ? t.commit : null,
      revision: text != null ? revision : null,
      created_at: first.createdAt,
      resolved_at: t.resolved ? now() : null,
      author: first.author,
      forge_id: first.id,
      forge_thread_id: t.id,
      forge_url: first.url,
      forge_resolved: Number(t.resolved),
    })
    .returning([
      "id",
      "kind",
      "body",
      "forge_id as forgeId",
      "forge_thread_id as forgeThreadId",
      "forge_resolved as forgeResolved",
    ])
    .executeTakeFirstOrThrow();
}

// The line ranges a file diff's hunks cover on each side, from `git diff` (3 lines of context, as forges show a PR):
// the lines a review comment can be on.
export function hunkRanges(diff: string): { old: [number, number][]; new: [number, number][] } {
  const ranges = { old: [] as [number, number][], new: [] as [number, number][] };
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [a, b, c, d] = [m[1], m[2] ?? "1", m[3], m[4] ?? "1"].map(Number);
    if (b) ranges.old.push([a, a + b - 1]);
    if (d) ranges.new.push([c, c + d - 1]);
  }
  return ranges;
}

// A comment thread with something to post, as Submit Review lists it. onForge: on a thread on the forge, where the
// comments since go as replies, and a resolve or reopen made here. placement: how its comments go. "lines": a thread
// on its lines, which are in the PR's diff. "reply": on its thread on the forge. "conversation": comments in the PR's
// conversation, since the forge has nowhere on the diff for them (a view's text, lines outside the PR's diff, lines not
// pushed or changed since), or since the thread is there already. null: nothing to say, only a resolve or reopen.
export type PostableThread = {
  threadId: number;
  path: string | null;
  lines: string;
  body: string;
  onForge: boolean;
  placement: "lines" | "reply" | "conversation" | null;
  resolve: boolean | null; // true: resolve it on the forge, false: reopen it, null: neither
};

const linesOf = (e: Pick<ReviewEntry, "startLine" | "endLine">) =>
  e.startLine === e.endLine ? `${e.startLine}` : `${e.startLine}–${e.endLine}`;
// An entry that isn't on the forge yet.
export const unposted = (e: ReviewEntry) => !e.forgeId && e.kind !== "comment";

// Every comment thread with something to post: one of the workspace's not on the forge yet (open), or one there with
// comments or a resolve since. Agent threads aren't posted. Its lines are taken in what's on the forge (ADR 0028), the
// PR's head.
export async function listPostable(
  db: Db,
  workspaceId: number,
  mergeBase = currentMergeBase(workspaceId),
  head = currentHead(workspaceId),
): Promise<PostableThread[]> {
  if (!mergeBase || !head) throw new Error("Open the workspace first");
  const entries = await listEntries(db, workspaceId, mergeBase, mergeBase, head);
  const resolvedThere = new Map(
    (
      await db
        .selectFrom("entries")
        .select(["id", "forge_resolved as resolved"])
        .where("workspace_id", "=", workspaceId)
        .where("forge_thread_id", "is not", null)
        .execute()
    ).map((r) => [r.id, r.resolved === 1]),
  );
  const hunks = new Map<string, ReturnType<typeof hunkRanges>>();
  const inDiff = async (e: ReviewEntry) => {
    if (!hunks.has(e.path!))
      hunks.set(
        e.path!,
        hunkRanges(
          await readFileDiff(db, workspaceId, mergeBase, head, {
            path: e.path!,
            previousPath: null,
          }),
        ),
      );
    return hunks.get(e.path!)![e.side!].some(([a, b]) => a <= e.startLine! && e.endLine! <= b);
  };
  const out: PostableThread[] = [];
  for (const root of entries.filter((e) => !e.parentId && (e.path || e.section != null))) {
    const replies = entries.filter((e) => e.parentId === root.id);
    // A comment posted at once is on the forge before the next read finds its thread.
    const onForge = !!root.forgeThreadId || !!root.forgeId;
    const fresh = (onForge ? replies : [root, ...replies]).filter(unposted);
    const resolve =
      root.forgeThreadId && !!root.resolvedAt !== resolvedThere.get(root.id)
        ? !!root.resolvedAt
        : null;
    if (!isComment(root) || (!onForge && root.resolvedAt)) continue;
    if (!fresh.length && resolve === null) continue;
    const onLines = root.section == null && root.shown && (await inDiff(root));
    out.push({
      threadId: root.id,
      path: root.path,
      lines: root.section != null ? `§ ${root.section + 1}` : linesOf(root),
      body: root.body,
      onForge,
      placement: match({
        onForge,
        fresh: fresh.length > 0,
        onLines,
        conversation: root.forgeConversation === 1,
      })
        .returnType<PostableThread["placement"]>()
        .with({ onForge: true, fresh: true, conversation: true }, () => "conversation")
        .with({ onForge: true, fresh: true }, () => "reply")
        .with({ onForge: true }, () => null)
        .with({ onLines: true }, () => "lines")
        .otherwise(() => "conversation"),
      resolve,
    });
  }
  return out;
}

// threads: the picked ones, by their first entries.
// addToPending: the user agreed to add to their review in progress on the forge, and submit it.
export type ReviewPost = {
  threads: number[];
  event: Verdict;
  body: string;
  addToPending?: boolean;
};
// What posting comes to: done; or, for Submit Review, a review of the user's in progress on the forge (with how many
// comments) that it would add to, so it asks first.
export type Posting = { status: "ok" } | { status: "pending"; comments: number } | ForgeProblem;

// What comments in the PR's conversation are about, before the first of them: a permalink to the lines (link) where
// the forge has them as they were and shows such a link as the code; else the code quoted.
const header = (root: ReviewEntry, link: string | null) =>
  match({ link, prose: root.section != null })
    .with({ link: P.string.select() }, (link) => link)
    .with({ prose: true }, () => quote(root.code ?? ""))
    .otherwise(
      () =>
        `\`${root.path}\`, ${root.startLine === root.endLine ? "line" : "lines"} ${linesOf(root)}${root.side === "old" ? " (removed)" : ""}:\n${fence(root.code ?? "")}`,
    );

// A permalink to an entry's lines on the forge: at the PR's head as the forge has it (prHead), or for removed lines the
// merge base; null where they aren't there unchanged (changed since, or not pushed), or it's on a view's text.
async function permalinkOf(
  db: Db,
  forge: Forge,
  pr: Pr,
  root: ReviewEntry,
  mergeBase: string,
  prHead: string,
): Promise<string | null> {
  if (root.section != null || !root.path) return null;
  const at = (
    await listEntries(db, root.workspaceId, mergeBase, mergeBase, prHead).catch(() => [])
  ).find((e) => e.id === root.id);
  if (!at?.shown) return null;
  return forge.permalink(pr.repo, root.side === "old" ? mergeBase : prHead, {
    path: root.path,
    side: root.side!,
    startLine: at.startLine!,
    endLine: at.endLine!,
  });
}

// Records an entry as posted: the comment it is on the forge, and for a thread's first one the thread.
const recorded = (
  db: Db,
  id: number,
  c: Posted,
  more: { threadId?: string | null; conversation?: boolean } = {},
) =>
  db
    .updateTable("entries")
    .set({
      forge_id: c.id,
      forge_url: c.url,
      ...(more.threadId && { forge_thread_id: more.threadId, forge_resolved: 0 }),
      ...(more.conversation && { forge_conversation: 1 }),
    })
    .where("id", "=", id)
    .execute();

// Comments in the PR's conversation, each recorded on its entry: the first with what it's about (aside) unless the
// thread is there already, the others in reply to it by its link.
async function inTheConversation(
  db: Db,
  forge: Forge,
  pr: Pr,
  target: PostTarget,
  root: ReviewEntry,
  comments: ReviewEntry[],
  about: string,
): Promise<ForgeResult> {
  let top = root.forgeUrl;
  for (const e of comments) {
    const said = await forge.comment(
      pr,
      target,
      withHeader(top ? `In reply to ${top}:` : about, e.body),
    );
    if (said.status !== "ok") return said;
    await recorded(db, e.id, said.comment, { conversation: true });
    top ??= said.comment.url;
  }
  return { status: "ok" };
}

// Posts the picked threads' comments as the user wrote them, in one review of the PR's head as last opened, then
// submits it with event and body: a new thread whose lines are in the PR's diff becomes a thread there, its first
// comment on the lines and the others replies; on a thread already on the forge each comment is a reply; the rest go
// as linked comments in the PR's conversation, as posting at once does. Then the resolves and reopens made here. Each
// comment posted records its comment on the forge, and a new thread its thread there, so the thread here is that one:
// edited, deleted and replied to in both. What got posted is recorded as it goes, so a failure halfway posts nothing
// twice; what the forge renumbers on submitting (GitLab's draft notes) is recorded again then. A review of the user's in
// progress on the forge is added to only with addToPending: without, it comes back as pending, for Submit Review to ask.
export const postReview = (db: Db, workspaceId: number, post: ReviewPost) =>
  oneAtATime(workspaceId, () => review(db, workspaceId, post));
async function review(db: Db, workspaceId: number, post: ReviewPost): Promise<Posting> {
  const { pr, forge } = await prOf(db, workspaceId);
  const [mergeBase, head] = [currentMergeBase(workspaceId), currentHead(workspaceId)];
  if (!mergeBase || !head) return { status: "error", message: "Open the workspace first" };
  const picked = new Set(post.threads);
  const listed = (await listPostable(db, workspaceId)).filter((t) => picked.has(t.threadId));
  const entries = await listEntries(db, workspaceId, mergeBase, mergeBase, head);
  const rootOf = (t: PostableThread) => entries.find((e) => e.id === t.threadId)!;
  // A thread's comments not on the forge yet, in order.
  const commentsOf = (t: PostableThread) =>
    [rootOf(t), ...entries.filter((e) => e.parentId === t.threadId)].filter(
      (e) => e.kind === "note" && unposted(e),
    );
  const saying = (placement: PostableThread["placement"]) =>
    listed.filter((t) => t.placement === placement && commentsOf(t).length);
  if (saying("reply").some((t) => !rootOf(t).forgeThreadId))
    return {
      status: "error",
      message: `A thread posted a moment ago isn't read back from ${forge.names.forge} yet; try again`,
    };
  const found = await forge.postTarget(pr);
  if (found.status !== "ok") return found;
  const { target } = found;
  // A review in progress is only seen by its author: one there is the user's, started on the forge or left by a post
  // that failed. It's added to only once the user said so.
  if (target.pending && !post.addToPending)
    return { status: "pending", comments: target.pending.comments };
  const body = post.body.trim();
  const reviewing =
    saying("lines").length > 0 ||
    saying("reply").length > 0 ||
    !!target.pending ||
    !!body ||
    post.event !== "COMMENT";
  if (!reviewing && listed.every((t) => t.resolve === null) && !saying("conversation").length)
    return { status: "error", message: "Nothing to post" };
  // Off the PR's diff: linked comments in its conversation, as posting at once does.
  for (const t of saying("conversation")) {
    const root = rootOf(t);
    const link = await permalinkOf(db, forge, pr, root, mergeBase, target.head);
    const said = await inTheConversation(
      db,
      forge,
      pr,
      target,
      root,
      commentsOf(t),
      header(root, link),
    );
    if (said.status !== "ok") return said;
  }
  if (reviewing) {
    const started = await forge.startReview(pr, target);
    if (started.status !== "ok") return started;
    const { review } = started;
    for (const t of saying("lines")) {
      const root = rootOf(t);
      const [first, ...rest] = commentsOf(t);
      const made = await review.thread(
        { path: root.path!, side: root.side!, startLine: root.startLine!, endLine: root.endLine! },
        first.body,
      );
      if (made.status !== "ok") return made;
      await recorded(db, first.id, made.comment, { threadId: made.threadId });
      if (review.repliesWait) continue;
      for (const e of rest) {
        const replied = await review.reply(made.threadId, e.body);
        if (replied.status !== "ok") return replied;
        await recorded(db, e.id, replied.comment);
      }
    }
    for (const t of saying("reply"))
      for (const e of commentsOf(t)) {
        const replied = await review.reply(rootOf(t).forgeThreadId!, e.body);
        if (replied.status !== "ok") return replied;
        await recorded(db, e.id, replied.comment);
      }
    const submitted = await review.submit(post.event, body);
    if (submitted.status !== "ok") return submitted;
    for (const r of submitted.rebound) {
      await db
        .updateTable("entries")
        .set({ forge_id: r.comment.id, forge_url: r.comment.url })
        .where("workspace_id", "=", workspaceId)
        .where("forge_id", "=", r.was)
        .execute();
      if (r.threadId)
        await db
          .updateTable("entries")
          .set({ forge_thread_id: r.threadId })
          .where("workspace_id", "=", workspaceId)
          .where("forge_id", "=", r.comment.id)
          .where("forge_thread_id", "is not", null)
          .execute();
    }
    // The replies that waited for their thread to be published, as replies to it now.
    if (review.repliesWait)
      for (const t of saying("lines")) {
        const [first, ...rest] = commentsOf(t);
        const root = await db
          .selectFrom("entries")
          .select(["forge_id", "forge_thread_id"])
          .where("id", "=", first.id)
          .executeTakeFirstOrThrow();
        for (const e of rest) {
          const replied = await forge.postReply(
            pr,
            { id: root.forge_thread_id ?? "", first: root.forge_id! },
            e.body,
          );
          if (replied.status !== "ok") return replied;
          await recorded(db, e.id, replied.comment);
        }
      }
  }
  for (const t of listed) {
    if (t.resolve === null) continue;
    const done = await resolveOnForge(db, forge, pr, rootOf(t), t.resolve);
    if (done.status !== "ok") return done;
  }
  return { status: "ok" };
}

// A thread resolved or reopened on the forge as it is here, recorded as what the forge has.
export async function resolveOnForge(
  db: Db,
  forge: Forge,
  pr: Pr,
  root: Pick<ReviewEntry, "id" | "forgeThreadId">,
  resolved: boolean,
): Promise<ForgeResult> {
  const done = await forge.resolve(pr, root.forgeThreadId!, resolved);
  if (done.status !== "ok") return done;
  await db
    .updateTable("entries")
    .set({ forge_resolved: Number(resolved) })
    .where("id", "=", root.id)
    .execute();
  return { status: "ok" };
}

// A comment thread's comments not on the forge yet, posted at once (the composer's Post to …) as plain discussion,
// with no review: each published as it's made, never touching a review of the user's in progress (on a forge that
// takes no comment on the diff while one is open, that's said first). A new thread on lines in the PR's diff starts a
// thread there and its other comments reply to it, recording their comments, then the forge is read back so the
// thread is linked at once. On a thread on the forge each comment is a reply. Elsewhere (a view's text, lines outside
// the PR's diff) each is a comment in the PR's conversation, the first with what they're about (header), the others in
// reply to it; recorded, so they're edited and deleted there too.
export const postComment = (db: Db, workspaceId: number, threadId: number) =>
  oneAtATime(workspaceId, () => comment(db, workspaceId, threadId));
async function comment(db: Db, workspaceId: number, threadId: number): Promise<ForgeResult> {
  const { pr, forge } = await prOf(db, workspaceId);
  const [mergeBase, head] = [currentMergeBase(workspaceId), currentHead(workspaceId)];
  if (!mergeBase || !head) return { status: "error", message: "Open the workspace first" };
  const t = (await listPostable(db, workspaceId)).find((p) => p.threadId === threadId);
  const entries = await listEntries(db, workspaceId, mergeBase, mergeBase, head);
  const root = entries.find((e) => e.id === threadId);
  const comments = root
    ? [root, ...entries.filter((e) => e.parentId === threadId)].filter(
        (e) => e.kind === "note" && unposted(e),
      )
    : [];
  if (!t || !root || !comments.length) return { status: "ok" };
  const found = await forge.postTarget(pr);
  if (found.status !== "ok") return found;
  const { target } = found;
  if (forge.pendingBlocksComments && target.pending && t.placement !== "conversation")
    return {
      status: "error",
      message: `You have a review in progress on this ${forge.names.pr} on ${forge.names.forge}. Finish or discard it there first, or post this with Submit Review`,
    };
  const replies = async (thread: { id: string; first: string }, list: ReviewEntry[]) => {
    for (const e of list) {
      const r = await forge.postReply(pr, thread, e.body);
      if (r.status !== "ok") return r;
      await recorded(db, e.id, r.comment);
    }
    return { status: "ok" as const };
  };
  return match(t.placement)
    .returnType<Promise<ForgeResult>>()
    .with("lines", async () => {
      const [first, ...rest] = comments;
      const made = await forge.postThread(
        pr,
        target,
        { path: root.path!, side: root.side!, startLine: root.startLine!, endLine: root.endLine! },
        first.body,
      );
      if (made.status !== "ok") return made;
      await recorded(db, first.id, made.comment, { threadId: made.threadId });
      const replied = await replies({ id: made.threadId ?? "", first: made.comment.id }, rest);
      // Read back at once, so the thread here is linked to the forge's before anything else is posted to it.
      await read(db, workspaceId).catch(() => {});
      return replied;
    })
    .with("reply", () => replies({ id: root.forgeThreadId ?? "", first: root.forgeId! }, comments))
    .with("conversation", async () => {
      const link = await permalinkOf(db, forge, pr, root, mergeBase, target.head);
      return inTheConversation(db, forge, pr, target, root, comments, header(root, link));
    })
    .with(null, async () => ({ status: "ok" as const }))
    .exhaustive();
}

// What the PR panel changes on the forge, each at the user's click (PullRequestChange).
export async function changePullRequest(
  db: Db,
  workspaceId: number,
  ref: PullRequestRef,
  change: PullRequestChange,
): Promise<ForgeResult> {
  const { pr, forge } = await prOf(db, workspaceId);
  return forge.changePullRequest(pr, ref, change);
}
