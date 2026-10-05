import { match, P } from "ts-pattern";
import type { Db } from "./db.ts";
import { listEntries, type ReviewEntry } from "./entries.ts";
import {
  getPullRequest,
  githubGraphql,
  githubRequest,
  type GitHubProblem,
  type MergeMethod,
  type PullRequestResult,
  type ReviewThread,
} from "./github.ts";
import { currentHead, currentMergeBase, pinRevision, readFileDiff, readTexts } from "./git.ts";
import { fence, isComment, quote } from "./thread-context.ts";
import { gitHubRepo } from "./projects.ts";
import { getWorkspaceRepo } from "./workspaces.ts";

// ADR 0037: a workspace's PR on GitHub. Reading it mirrors its review threads into the workspace's entries; posting
// sends picked threads back as one review. Nothing goes to GitHub without the user asking.

export async function prOf(db: Db, workspaceId: number) {
  const w = await getWorkspaceRepo(db, workspaceId);
  if (w.prNumber === null) throw new Error("The workspace has no pull request");
  return { ...w, ...gitHubRepo(w), prNumber: w.prNumber };
}

// What reads and changes a workspace's threads on GitHub runs one at a time: a read mirrors GitHub as it was when it
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
  const w = await prOf(db, workspaceId);
  const pr = await getPullRequest(w.owner, w.name, w.prNumber);
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
// so the replies of others land in the user's own thread. Text edited on GitHub is updated here, a reply deleted there
// is deleted here; a resolve or reopen on GitHub is taken over. A thread gone from GitHub, or whose first comment is
// (GitHub keeps a thread for its replies), is dropped here (dropThread), the next read mirroring what's left as a new
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
        "github_id as githubId",
        "github_thread_id as githubThreadId",
        "github_resolved as githubResolved",
      ])
      .where("workspace_id", "=", workspaceId)
      .where((eb) =>
        eb.or([eb("github_id", "is not", null), eb("github_thread_id", "is not", null)]),
      )
      .execute();
  let known = await select();
  let changed = false;
  const kindOf = (author: string) => (author === seen.viewer ? "note" : "comment");
  if (seen.complete) {
    const byId = new Map(threads.map((t) => [t.id, t]));
    const stale = known.filter((k) => {
      if (k.parentId !== null || !k.githubThreadId) return false;
      const t = byId.get(k.githubThreadId);
      return !t || (!!k.githubId && t.comments[0]?.id !== k.githubId);
    });
    for (const k of stale) await dropThread(db, k.id);
    if (stale.length) {
      known = await select();
      changed = true;
    }
  }
  const byGitHubId = new Map(known.flatMap((k) => (k.githubId ? [[k.githubId, k]] : [])));
  for (const t of threads) {
    const [first, ...replies] = t.comments;
    if (!first) continue;
    let root =
      known.find((k) => k.githubThreadId === t.id && k.parentId === null) ??
      byGitHubId.get(first.id);
    if (!root) {
      root = {
        ...(await mirrorThread(db, workspaceId, t, mergeBase, kindOf(first.author))),
        parentId: null,
      };
      changed = true;
    } else {
      const resolved = (root.githubResolved === 1) !== t.resolved;
      const mine = root.kind === "comment" && kindOf(first.author) === "note";
      if (
        root.githubThreadId !== t.id ||
        resolved ||
        mine ||
        (root.githubId === first.id && root.body !== first.body)
      ) {
        await db
          .updateTable("entries")
          .set({
            github_thread_id: t.id,
            github_resolved: Number(t.resolved),
            ...(resolved && { resolved_at: t.resolved ? now() : null }),
            ...(root.githubId === first.id && { body: first.body }),
            ...(mine && { kind: "note" as const }),
          })
          .where("id", "=", root.id)
          .execute();
        changed = true;
      }
    }
    for (const c of replies) {
      const row = byGitHubId.get(c.id);
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
            github_id: c.id,
            github_url: c.url,
          })
          .execute();
    }
    if (!t.complete) continue;
    const there = new Set(t.comments.map((c) => c.id));
    const gone = known.filter(
      (k) => k.parentId === root.id && k.githubId && !there.has(k.githubId),
    );
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

// The comments posted from here in the PR's conversation, kept up with GitHub: an edit there is taken over (the user's
// text, after coxswain's marker), and one deleted there is deleted here, its thread with it if it was the first
// (dropThread). Deletes only when the read got every comment. Others' comments
// stay in the PR panel's conversation: GitHub doesn't thread them.
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
        "github_id as githubId",
        "github_url as githubUrl",
      ])
      .where("workspace_id", "=", workspaceId)
      .where("github_url", "like", "%#issuecomment-%")
      .execute()
  ).filter((e) => e.githubId);
  const there = new Map(comments.map((c) => [c.id, textOf(c.body)]));
  let changed = false;
  for (const e of posted) {
    const text = there.get(e.githubId!);
    if (text !== undefined && text !== e.body) {
      await db.updateTable("entries").set({ body: text }).where("id", "=", e.id).execute();
      changed = true;
    }
  }
  const gone = complete ? posted.filter((e) => !there.has(e.githubId!)) : [];
  for (const e of gone)
    if (e.parentId === null) await dropThread(db, e.id);
    else await db.deleteFrom("entries").where("id", "=", e.id).execute();
  return changed || gone.length > 0;
}

// A thread gone from GitHub, dropped here as it was there: what was on GitHub goes, and the user's notes not posted yet
// stay, as a local thread on the same anchor with the first of them first.
export async function dropThread(db: Db, rootId: number) {
  const drafts = await db
    .selectFrom("entries")
    .select("id")
    .where("parent_id", "=", rootId)
    .where("kind", "=", "note")
    .where("github_id", "is", null)
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
// replies to), and how the text is told from it again: after the marker, hidden on GitHub.
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
      github_id: first.id,
      github_thread_id: t.id,
      github_url: first.url,
      github_resolved: Number(t.resolved),
    })
    .returning([
      "id",
      "kind",
      "body",
      "github_id as githubId",
      "github_thread_id as githubThreadId",
      "github_resolved as githubResolved",
    ])
    .executeTakeFirstOrThrow();
}

// The line ranges a file diff's hunks cover on each side, from `git diff` (3 lines of context, as GitHub shows a PR):
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

// A comment thread with something to post, as Submit Review lists it. github: on a thread on GitHub, where the
// comments since go as replies, and a resolve or reopen made here. placement: how its comments go. "lines": a thread
// on its lines, which are in the PR's diff. "reply": on its thread on GitHub. "conversation": comments in the PR's
// conversation, since GitHub has nowhere on the diff for them (a view's text, lines outside the PR's diff, lines not
// pushed or changed since), or since the thread is there already. null: nothing to say, only a resolve or reopen.
export type PostableThread = {
  threadId: number;
  path: string | null;
  lines: string;
  body: string;
  github: boolean;
  placement: "lines" | "reply" | "conversation" | null;
  resolve: boolean | null; // true: resolve it on GitHub, false: reopen it, null: neither
};

const linesOf = (e: Pick<ReviewEntry, "startLine" | "endLine">) =>
  e.startLine === e.endLine ? `${e.startLine}` : `${e.startLine}–${e.endLine}`;
// An entry posted as a comment in the PR's conversation, not on a review thread: GitHub's URL for it says which.
export const inConversation = (e: Pick<ReviewEntry, "githubUrl">) =>
  !!e.githubUrl?.includes("#issuecomment-");
// An entry that isn't on GitHub yet.
export const unposted = (e: ReviewEntry) => !e.githubId && e.kind !== "comment";

// Every comment thread with something to post: one of the workspace's not on GitHub yet (open), or one on GitHub with
// comments or a resolve since. Agent threads aren't posted. Its lines are taken in what's
// on GitHub (ADR 0028), the PR's head.
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
        .select(["id", "github_resolved as resolved"])
        .where("workspace_id", "=", workspaceId)
        .where("github_thread_id", "is not", null)
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
    // A comment posted at once is on GitHub before the next read finds its thread.
    const github = !!root.githubThreadId || !!root.githubId;
    const fresh = (github ? replies : [root, ...replies]).filter(unposted);
    const resolve =
      root.githubThreadId && !!root.resolvedAt !== resolvedThere.get(root.id)
        ? !!root.resolvedAt
        : null;
    if (!isComment(root) || (!github && root.resolvedAt)) continue;
    if (!fresh.length && resolve === null) continue;
    const onLines = root.section == null && root.shown && (await inDiff(root));
    out.push({
      threadId: root.id,
      path: root.path,
      lines: root.section != null ? `§ ${root.section + 1}` : linesOf(root),
      body: root.body,
      github,
      placement: match({
        github,
        fresh: fresh.length > 0,
        onLines,
        conversation: inConversation(root),
      })
        .returnType<PostableThread["placement"]>()
        .with({ github: true, fresh: true, conversation: true }, () => "conversation")
        .with({ github: true, fresh: true }, () => "reply")
        .with({ github: true }, () => null)
        .with({ onLines: true }, () => "lines")
        .otherwise(() => "conversation"),
      resolve,
    });
  }
  return out;
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
// threads: the picked ones, by their first entries.
// addToPending: the user agreed to add to their review in progress on GitHub, and submit it.
export type ReviewPost = {
  threads: number[];
  event: ReviewEvent;
  body: string;
  addToPending?: boolean;
};
// What posting comes to: done; or, for Submit Review, a review of the user's in progress on GitHub (with how many
// comments) that it would add to, so it asks first.
export type Posting = { status: "ok" } | { status: "pending"; comments: number } | GitHubProblem;

type Posted = { id: string; url: string };

// What comments in the PR's conversation are about, before the first of them: a permalink to the lines (link) where GitHub has them as they were, which it shows as the code, highlighted,
// with a link to it; else the code quoted.
const header = (root: ReviewEntry, link: string | null) =>
  match({ link, prose: root.section != null })
    .with({ link: P.string.select() }, (link) => link)
    .with({ prose: true }, () => quote(root.code ?? ""))
    .otherwise(
      () =>
        `\`${root.path}\`, ${root.startLine === root.endLine ? "line" : "lines"} ${linesOf(root)}${root.side === "old" ? " (removed)" : ""}:\n${fence(root.code ?? "")}`,
    );

// A permalink to an entry's lines on GitHub: at the PR's head as GitHub has it (prHead), or for removed lines the merge
// base; null where they aren't there unchanged (changed since, or not pushed), or it's on a view's text.
async function permalinkOf(
  db: Db,
  w: { owner: string; name: string },
  root: ReviewEntry,
  mergeBase: string,
  prHead: string,
): Promise<string | null> {
  if (root.section != null || !root.path) return null;
  const at = (
    await listEntries(db, root.workspaceId, mergeBase, mergeBase, prHead).catch(() => [])
  ).find((e) => e.id === root.id);
  if (!at?.shown) return null;
  const sha = root.side === "old" ? mergeBase : prHead;
  const lines =
    at.startLine === at.endLine ? `L${at.startLine}` : `L${at.startLine}-L${at.endLine}`;
  return `https://github.com/${w.owner}/${w.name}/blob/${sha}/${root.path}#${lines}`;
}

// The PR's node and its head on GitHub, for comments in its conversation and permalinks.
// With the user's review in progress, if they have one (only its author sees a pending review).
async function prNode(w: { owner: string; name: string; prNumber: number }) {
  return githubGraphql<{
    repository: {
      pullRequest: {
        id: string;
        headRefOid: string;
        reviews: { nodes: { id: string; comments: { totalCount: number } }[] };
      };
    };
  }>(
    `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) {
      pullRequest(number: $number) { id headRefOid
        reviews(states: PENDING, first: 1) { nodes { id comments { totalCount } } } } } }`,
    { owner: w.owner, name: w.name, number: w.prNumber },
  );
}

// Comments in the PR's conversation, each recorded on its entry: the first with what it's about (aside) unless the
// thread is there already, the others in reply to it by its link.
async function inTheConversation(
  db: Db,
  prId: string,
  root: ReviewEntry,
  comments: ReviewEntry[],
  about: string,
): Promise<{ status: "ok" } | GitHubProblem> {
  let top = root.githubUrl;
  for (const e of comments) {
    const said = await githubGraphql<{ addComment: { commentEdge: { node: Posted } } }>(
      `mutation($pr: ID!, $body: String!) { addComment(input: {subjectId: $pr, body: $body}) {
        commentEdge { node { id url } } } }`,
      { pr: prId, body: withHeader(top ? `In reply to ${top}:` : about, e.body) },
    );
    if (said.status !== "ok") return said;
    const c = said.data.addComment.commentEdge.node;
    await db
      .updateTable("entries")
      .set({ github_id: c.id, github_url: c.url })
      .where("id", "=", e.id)
      .execute();
    top ??= c.url;
  }
  return { status: "ok" };
}

// Posts the picked threads' comments as the user wrote them, in one review of the PR's head as last opened, then
// submits it with event and body: a new thread whose lines are in the PR's diff becomes a thread there, its first
// comment on the lines and the others replies; on a thread already on GitHub each comment is a reply; the rest go as
// linked comments in the PR's conversation, as posting at once does. Then the resolves and reopens made here. Each
// comment posted records its GitHub comment, and a new thread its GitHub thread, so the thread here is that one:
// edited, deleted and replied to in both. What got posted is recorded as it goes, so a failure halfway posts nothing
// twice. A review of the user's in progress on GitHub is added to only with addToPending: without, it comes back as
// pending, for Submit Review to ask.
export const postReview = (db: Db, workspaceId: number, post: ReviewPost) =>
  oneAtATime(workspaceId, () => review(db, workspaceId, post));
async function review(db: Db, workspaceId: number, post: ReviewPost): Promise<Posting> {
  const w = await prOf(db, workspaceId);
  const [mergeBase, head] = [currentMergeBase(workspaceId), currentHead(workspaceId)];
  if (!mergeBase || !head) return { status: "error", message: "Open the workspace first" };
  const picked = new Set(post.threads);
  const listed = (await listPostable(db, workspaceId)).filter((t) => picked.has(t.threadId));
  const entries = await listEntries(db, workspaceId, mergeBase, mergeBase, head);
  const rootOf = (t: PostableThread) => entries.find((e) => e.id === t.threadId)!;
  // A thread's comments not on GitHub yet, in order.
  const commentsOf = (t: PostableThread) =>
    [rootOf(t), ...entries.filter((e) => e.parentId === t.threadId)].filter(
      (e) => e.kind === "note" && unposted(e),
    );
  const saying = (placement: PostableThread["placement"]) =>
    listed.filter((t) => t.placement === placement && commentsOf(t).length);
  if (saying("reply").some((t) => !rootOf(t).githubThreadId))
    return {
      status: "error",
      message: "A thread posted a moment ago isn't read back from GitHub yet; try again",
    };
  const record = (id: number, c: Posted, threadId?: string) =>
    db
      .updateTable("entries")
      .set({
        github_id: c.id,
        github_url: c.url,
        ...(threadId && { github_thread_id: threadId, github_resolved: 0 }),
      })
      .where("id", "=", id)
      .execute();
  const found = await prNode(w);
  if (found.status !== "ok") return found;
  const pr = found.data.repository.pullRequest;
  // Pending reviews are only seen by their author: one there is the user's, started on GitHub or left by a post that
  // failed. It's added to only once the user said so.
  const pending = pr.reviews.nodes[0] ?? null;
  if (pending && !post.addToPending)
    return { status: "pending", comments: pending.comments.totalCount };
  let reviewId = pending?.id ?? null;
  const body = post.body.trim();
  const reviewing =
    saying("lines").length > 0 ||
    saying("reply").length > 0 ||
    !!reviewId ||
    !!body ||
    post.event !== "COMMENT";
  if (!reviewing && listed.every((t) => t.resolve === null) && !saying("conversation").length)
    return { status: "error", message: "Nothing to post" };
  // Off the PR's diff: linked comments in its conversation, as posting at once does.
  for (const t of saying("conversation")) {
    const root = rootOf(t);
    const link = await permalinkOf(db, w, root, mergeBase, pr.headRefOid);
    const said = await inTheConversation(db, pr.id, root, commentsOf(t), header(root, link));
    if (said.status !== "ok") return said;
  }
  if (reviewing) {
    if (!reviewId) {
      const made = await githubGraphql<{
        addPullRequestReview: { pullRequestReview: { id: string } };
      }>(
        `mutation($pr: ID!, $commit: GitObjectID!) { addPullRequestReview(input: {pullRequestId: $pr, commitOID: $commit}) {
          pullRequestReview { id } } }`,
        { pr: pr.id, commit: head },
      );
      if (made.status !== "ok") return made;
      reviewId = made.data.addPullRequestReview.pullRequestReview.id;
    }
    // A comment on a thread on GitHub, in this review.
    const reply = (threadId: string, body: string) =>
      githubGraphql<{ addPullRequestReviewThreadReply: { comment: Posted } }>(
        `mutation($review: ID!, $thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {
          pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) { comment { id url } } }`,
        { review: reviewId, thread: threadId, body },
      );
    for (const t of saying("lines")) {
      const root = rootOf(t);
      const side = root.side === "old" ? "LEFT" : "RIGHT";
      const [first, ...rest] = commentsOf(t);
      const made = await githubGraphql<{
        addPullRequestReviewThread: { thread: { id: string; comments: { nodes: Posted[] } } };
      }>(
        `mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) {
          thread { id comments(first: 1) { nodes { id url } } } } }`,
        {
          input: {
            pullRequestReviewId: reviewId,
            path: root.path,
            body: first.body,
            subjectType: "LINE",
            line: root.endLine,
            side,
            ...(root.startLine !== root.endLine && { startLine: root.startLine, startSide: side }),
          },
        },
      );
      if (made.status !== "ok") return made;
      const thread = made.data.addPullRequestReviewThread.thread;
      await record(first.id, thread.comments.nodes[0], thread.id);
      for (const e of rest) {
        const replied = await reply(thread.id, e.body);
        if (replied.status !== "ok") return replied;
        await record(e.id, replied.data.addPullRequestReviewThreadReply.comment);
      }
    }
    for (const t of saying("reply"))
      for (const e of commentsOf(t)) {
        const replied = await reply(rootOf(t).githubThreadId!, e.body);
        if (replied.status !== "ok") return replied;
        await record(e.id, replied.data.addPullRequestReviewThreadReply.comment);
      }
    const submitted = await githubGraphql(
      `mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: {
        pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { id } } }`,
      { review: reviewId, event: post.event, body: body || null },
    );
    if (submitted.status !== "ok") return submitted;
  }
  for (const t of listed) {
    if (t.resolve === null) continue;
    const done = await resolveOnGitHub(db, rootOf(t), t.resolve);
    if (done.status !== "ok") return done;
  }
  return { status: "ok" };
}

// A thread resolved or reopened on GitHub as it is here, recorded as what GitHub has.
export async function resolveOnGitHub(
  db: Db,
  root: Pick<ReviewEntry, "id" | "githubThreadId">,
  resolved: boolean,
): Promise<{ status: "ok" } | GitHubProblem> {
  const done = await githubGraphql(
    resolved
      ? `mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id } } }`
      : `mutation($id: ID!) { unresolveReviewThread(input: {threadId: $id}) { thread { id } } }`,
    { id: root.githubThreadId },
  );
  if (done.status !== "ok") return done;
  await db
    .updateTable("entries")
    .set({ github_resolved: Number(resolved) })
    .where("id", "=", root.id)
    .execute();
  return { status: "ok" };
}

// A comment thread's comments not on GitHub yet, posted at once (the composer's Post to GitHub) as plain discussion,
// with no review: GitHub's REST single comments, each published as it's made, never touching a pending review of the
// user's (GitHub takes none on the diff while one is open, so that's said first). A new thread on lines in the PR's
// diff starts a thread there and its other comments reply to it, recording their comments, then GitHub is read back so
// the thread is linked at once. On a thread on GitHub each comment is a reply. Elsewhere (a view's text, lines outside
// the PR's diff) each is a comment in the PR's conversation, the first with what they're about (header), the others in
// reply to it; recorded, so they're edited and deleted there too.
export const postComment = (db: Db, workspaceId: number, threadId: number) =>
  oneAtATime(workspaceId, () => comment(db, workspaceId, threadId));
async function comment(
  db: Db,
  workspaceId: number,
  threadId: number,
): Promise<{ status: "ok" } | GitHubProblem> {
  const w = await prOf(db, workspaceId);
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
  const found = await prNode(w);
  if (found.status !== "ok") return found;
  const { id: prId, headRefOid, reviews } = found.data.repository.pullRequest;
  // GitHub takes no single comment on the diff while the user has a review in progress.
  if (reviews.nodes.length && t.placement !== "conversation")
    return {
      status: "error",
      message:
        "You have a review in progress on this PR on GitHub. Finish or discard it there first, or post this with Submit Review",
    };
  type Comment = { id: number; node_id: string; html_url: string };
  const record = (id: number, c: Comment) =>
    db
      .updateTable("entries")
      .set({ github_id: c.node_id, github_url: c.html_url })
      .where("id", "=", id)
      .execute();
  const pr = { owner: w.owner, repo: w.name, pull_number: w.prNumber };
  const replies = async (top: number, list: ReviewEntry[]) => {
    for (const e of list) {
      const r = await githubRequest<Comment>(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
        { ...pr, comment_id: top, body: e.body },
      );
      if (r.status !== "ok") return r;
      await record(e.id, r.data);
    }
    return { status: "ok" as const };
  };
  return match(t.placement)
    .returnType<Promise<{ status: "ok" } | GitHubProblem>>()
    .with("lines", async () => {
      const [first, ...rest] = comments;
      const side = root.side === "old" ? "LEFT" : "RIGHT";
      const made = await githubRequest<Comment>(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
        {
          ...pr,
          body: first.body,
          commit_id: head,
          path: root.path,
          line: root.endLine,
          side,
          ...(root.startLine !== root.endLine && { start_line: root.startLine, start_side: side }),
        },
      );
      if (made.status !== "ok") return made;
      await record(first.id, made.data);
      const replied = await replies(made.data.id, rest);
      // Read back at once, so the thread here is linked to GitHub's before anything else is posted to it.
      await read(db, workspaceId).catch(() => {});
      return replied;
    })
    .with("reply", async () => {
      const top = await githubGraphql<{ node: { databaseId: number } | null }>(
        `query($id: ID!) { node(id: $id) { ... on PullRequestReviewComment { databaseId } } }`,
        { id: root.githubId },
      );
      if (top.status !== "ok") return top;
      if (!top.data.node)
        return { status: "error", message: "The thread's first comment is gone from GitHub" };
      return replies(top.data.node.databaseId, comments);
    })
    .with("conversation", async () => {
      const link = await permalinkOf(db, w, root, mergeBase, headRefOid);
      return inTheConversation(db, prId, root, comments, header(root, link));
    })
    .with(null, async () => ({ status: "ok" }))
    .exhaustive();
}

// What the PR panel changes on GitHub, each at the user's click: the description, a comment on the PR, assigning
// themselves, ready for review, merging.
export type PullRequestChange =
  | { kind: "body"; body: string }
  | { kind: "comment"; body: string }
  | { kind: "assign"; on: boolean }
  | { kind: "ready" }
  | { kind: "merge"; method: MergeMethod };
// The PR as the panel read it: the node ids a change needs, and the head a merge must still be at.
export type PullRequestRef = { id: string; viewerId: string; head: string };

export function changePullRequest(
  pr: PullRequestRef,
  change: PullRequestChange,
): Promise<{ status: "ok" } | GitHubProblem> {
  const [query, variables] = match(change)
    .returnType<[string, Record<string, unknown>]>()
    .with({ kind: "body" }, (c) => [
      `mutation($pr: ID!, $body: String!) { updatePullRequest(input: {pullRequestId: $pr, body: $body}) { clientMutationId } }`,
      { pr: pr.id, body: c.body },
    ])
    .with({ kind: "comment" }, (c) => [
      `mutation($pr: ID!, $body: String!) { addComment(input: {subjectId: $pr, body: $body}) { clientMutationId } }`,
      { pr: pr.id, body: c.body },
    ])
    .with({ kind: "assign" }, (c) => [
      c.on
        ? `mutation($pr: ID!, $me: ID!) { addAssigneesToAssignable(input: {assignableId: $pr, assigneeIds: [$me]}) { clientMutationId } }`
        : `mutation($pr: ID!, $me: ID!) { removeAssigneesFromAssignable(input: {assignableId: $pr, assigneeIds: [$me]}) { clientMutationId } }`,
      { pr: pr.id, me: pr.viewerId },
    ])
    .with({ kind: "ready" }, () => [
      `mutation($pr: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $pr}) { clientMutationId } }`,
      { pr: pr.id },
    ])
    .with({ kind: "merge" }, (c) => [
      `mutation($pr: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) { mergePullRequest(input: {
        pullRequestId: $pr, mergeMethod: $method, expectedHeadOid: $head}) { clientMutationId } }`,
      { pr: pr.id, method: c.method.toUpperCase(), head: pr.head },
    ])
    .exhaustive();
  return githubGraphql(query, variables).then((r) => (r.status === "ok" ? { status: "ok" } : r));
}
