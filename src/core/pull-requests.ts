import { match } from "ts-pattern";
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

// The PR for its panel. Its review threads are mirrored into entries first; changed says whether that changed any.
export async function readPullRequest(
  db: Db,
  workspaceId: number,
): Promise<{ pr: PullRequestResult; changed: boolean }> {
  const w = await prOf(db, workspaceId);
  const pr = await getPullRequest(w.owner, w.name, w.prNumber);
  const mergeBase = currentMergeBase(workspaceId);
  // Threads are anchored in the worktree, so they wait until it's open.
  if (pr.status !== "ok" || !mergeBase) return { pr, changed: false };
  return { pr, changed: await syncThreads(db, workspaceId, pr.threads, mergeBase) };
}

const now = () => new Date().toISOString();

// Mirrors review threads into entries (ADR 0037): a thread's first comment becomes its first entry, on the lines it was
// written on, and the rest replies, each of kind 'comment'. A comment posted from here is the entry it was posted
// from, so the replies of others land in the user's own thread. Text edited on GitHub is updated here, a reply deleted
// there is deleted here; a resolve or reopen on GitHub is taken over. ponytail: a thread deleted on GitHub stays here, with the local replies to it.
export async function syncThreads(
  db: Db,
  workspaceId: number,
  threads: ReviewThread[],
  mergeBase: string,
): Promise<boolean> {
  const known = await db
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
    .where((eb) => eb.or([eb("github_id", "is not", null), eb("github_thread_id", "is not", null)]))
    .execute();
  const byGitHubId = new Map(known.flatMap((k) => (k.githubId ? [[k.githubId, k]] : [])));
  let changed = false;
  for (const t of threads) {
    const [first, ...replies] = t.comments;
    if (!first) continue;
    let root =
      known.find((k) => k.githubThreadId === t.id && k.parentId === null) ??
      byGitHubId.get(first.id);
    if (!root) {
      root = { ...(await mirrorThread(db, workspaceId, t, mergeBase)), parentId: null };
      changed = true;
    } else {
      const resolved = (root.githubResolved === 1) !== t.resolved;
      if (
        root.githubThreadId !== t.id ||
        resolved ||
        (root.githubId === first.id && root.body !== first.body)
      ) {
        await db
          .updateTable("entries")
          .set({
            github_thread_id: t.id,
            github_resolved: Number(t.resolved),
            ...(resolved && { resolved_at: t.resolved ? now() : null }),
            ...(root.githubId === first.id && { body: first.body }),
          })
          .where("id", "=", root.id)
          .execute();
        changed = true;
      }
    }
    for (const c of replies) {
      const row = byGitHubId.get(c.id);
      if (row && row.body === c.body) continue;
      changed = true;
      if (row)
        await db.updateTable("entries").set({ body: c.body }).where("id", "=", row.id).execute();
      else
        await db
          .insertInto("entries")
          .values({
            workspace_id: workspaceId,
            kind: "comment",
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

// A thread's first entry, on its lines as they were where it was written: the new side at its comment's commit, the
// old side at the merge base. A commit the clone doesn't have leaves it without code, so it reads as outdated.
async function mirrorThread(db: Db, workspaceId: number, t: ReviewThread, mergeBase: string) {
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
      kind: "comment",
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
// on its lines, which are in the PR's diff. "body": in the review's text, with what they are about quoted, since GitHub
// has nowhere to put them (a view's text, lines outside the PR's diff, lines not pushed or changed since). "reply": on
// its thread on GitHub. null: nothing to say, only a resolve or reopen.
export type PostableThread = {
  threadId: number;
  path: string | null;
  lines: string;
  body: string;
  github: boolean;
  placement: "lines" | "body" | "reply" | null;
  resolve: boolean | null; // true: resolve it on GitHub, false: reopen it, null: neither
};

const linesOf = (e: Pick<ReviewEntry, "startLine" | "endLine">) =>
  e.startLine === e.endLine ? `${e.startLine}` : `${e.startLine}–${e.endLine}`;
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
      placement: match({ github, fresh: fresh.length > 0, onLines })
        .returnType<PostableThread["placement"]>()
        .with({ github: true, fresh: true }, () => "reply")
        .with({ github: true }, () => null)
        .with({ onLines: true }, () => "lines")
        .otherwise(() => "body"),
      resolve,
    });
  }
  return out;
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
// threads: the picked ones, by their first entries.
export type ReviewPost = {
  threads: number[];
  event: ReviewEvent;
  body: string;
};

type Posted = { id: string; url: string };

// Comments in the review's text: what they are about, quoted, then the comments.
const aside = (root: ReviewEntry, text: string) =>
  root.section != null
    ? `${quote(root.code ?? "")}\n\n${text}`
    : `\`${root.path}\`, ${root.startLine === root.endLine ? "line" : "lines"} ${linesOf(root)}${root.side === "old" ? " (removed)" : ""}:\n${fence(root.code ?? "")}\n\n${text}`;

// Posts the picked threads' comments as the user wrote them, in one review of the PR's head as last opened, then
// submits it with event and body: a new thread whose lines are in the PR's diff becomes a thread there, its first
// comment on the lines and the others replies; on a thread already on GitHub each comment is a reply; the other new
// threads go in the review's text. Then the resolves and reopens made here. Each comment posted records its GitHub
// comment, and a new thread its GitHub thread, so the thread here is that one: edited, deleted and replied to in both.
// What got posted is recorded as it goes, so a failure halfway posts nothing twice; a review left pending is
// submitted next time. ponytail: a thread in the review's text has nothing on GitHub to point at, so it's resolved
// here once posted; a PR comment of its own each would keep the link.
export async function postReview(
  db: Db,
  workspaceId: number,
  post: ReviewPost,
): Promise<{ status: "ok" } | GitHubProblem> {
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
  const found = await githubGraphql<{
    repository: { pullRequest: { id: string; reviews: { nodes: { id: string }[] } } };
  }>(
    `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) {
      pullRequest(number: $number) { id reviews(states: PENDING, first: 1) { nodes { id } } } } }`,
    { owner: w.owner, name: w.name, number: w.prNumber },
  );
  if (found.status !== "ok") return found;
  const pr = found.data.repository.pullRequest;
  // Pending reviews are only seen by their author: one there is the user's, e.g. left by a post that failed.
  let reviewId = pr.reviews.nodes[0]?.id ?? null;
  const body = [
    post.body.trim(),
    ...saying("body").map((t) =>
      aside(
        rootOf(t),
        commentsOf(t)
          .map((e) => e.body)
          .join("\n\n"),
      ),
    ),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
  const reviewing =
    saying("lines").length > 0 ||
    saying("reply").length > 0 ||
    !!reviewId ||
    !!body ||
    post.event !== "COMMENT";
  if (!reviewing && listed.every((t) => t.resolve === null))
    return { status: "error", message: "Nothing to post" };
  const resolveHere = (ids: number[]) =>
    ids.length &&
    db.updateTable("entries").set({ resolved_at: now() }).where("id", "in", ids).execute();
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
    await resolveHere(saying("body").map((t) => t.threadId));
  }
  for (const t of listed) {
    if (t.resolve === null) continue;
    const root = rootOf(t);
    const done = await githubGraphql(
      t.resolve
        ? `mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id } } }`
        : `mutation($id: ID!) { unresolveReviewThread(input: {threadId: $id}) { thread { id } } }`,
      { id: root.githubThreadId },
    );
    if (done.status !== "ok") return done;
    await db
      .updateTable("entries")
      .set({ github_resolved: Number(t.resolve) })
      .where("id", "=", root.id)
      .execute();
  }
  return { status: "ok" };
}

// A comment thread's comments not on GitHub yet, posted at once (the composer's Post to GitHub) as plain discussion,
// with no review: GitHub's REST single comments, each published as it's made, never touching a pending review of the
// user's (GitHub refuses them while one is open, and says so). A new thread on lines in the PR's diff starts a thread
// there and its other comments reply to it, recording their comments; the next read of GitHub finds the thread by its
// first comment. On a thread on GitHub each comment is a reply. Elsewhere (a view's text, lines outside the PR's diff)
// they go together as a comment in the PR's conversation, with what they're about quoted, and the thread is resolved
// here. Resolves here aren't sent: those wait for Submit Review.
export async function postComment(
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
      return replies(made.data.id, rest);
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
    .with("body", async () => {
      const found = await githubGraphql<{ repository: { pullRequest: { id: string } } }>(
        `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) {
          pullRequest(number: $number) { id } } }`,
        { owner: w.owner, name: w.name, number: w.prNumber },
      );
      if (found.status !== "ok") return found;
      const said = await githubGraphql(
        `mutation($pr: ID!, $body: String!) { addComment(input: {subjectId: $pr, body: $body}) { clientMutationId } }`,
        {
          pr: found.data.repository.pullRequest.id,
          body: aside(root, comments.map((e) => e.body).join("\n\n")),
        },
      );
      if (said.status !== "ok") return said;
      await db
        .updateTable("entries")
        .set({ resolved_at: now() })
        .where("id", "=", root.id)
        .execute();
      return { status: "ok" };
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
