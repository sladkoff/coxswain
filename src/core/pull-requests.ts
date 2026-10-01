import { match } from "ts-pattern";
import type { Db } from "./db.ts";
import { listEntries, type ReviewEntry } from "./entries.ts";
import {
  getPullRequest,
  githubGraphql,
  type GitHubProblem,
  type MergeMethod,
  type PullRequestResult,
  type ReviewThread,
} from "./github.ts";
import { currentHead, currentMergeBase, pinRevision, readFileDiff, readTexts } from "./git.ts";
import { byAgent, fence } from "./thread-context.ts";
import { getWorkspaceRepo } from "./workspaces.ts";

// ADR 0037: a workspace's PR on GitHub. Reading it mirrors its review threads into the workspace's entries; posting
// sends picked threads back as one review. Nothing goes to GitHub without the user asking.

export async function prOf(db: Db, workspaceId: number) {
  const w = await getWorkspaceRepo(db, workspaceId);
  if (w.prNumber === null) throw new Error("The workspace has no pull request");
  return { ...w, prNumber: w.prNumber };
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
// from. Text edited on GitHub is updated here, a reply deleted there is deleted here; a resolve or reopen on GitHub
// is taken over. ponytail: a thread deleted on GitHub stays here, with the local replies to it.
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
        (root.kind === "comment" && root.body !== first.body)
      ) {
        await db
          .updateTable("entries")
          .set({
            github_thread_id: t.id,
            github_resolved: Number(t.resolved),
            ...(resolved && { resolved_at: t.resolved ? now() : null }),
            ...(root.kind === "comment" && { body: first.body }),
          })
          .where("id", "=", root.id)
          .execute();
        changed = true;
      }
    }
    for (const c of replies) {
      const row = byGitHubId.get(c.id);
      if (row && (row.kind !== "comment" || row.body === c.body)) continue;
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
      (k) => k.parentId === root.id && k.kind === "comment" && !there.has(k.githubId!),
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

// A thread as Post to GitHub lists it: where it is, what it starts with, what of it would be posted, and why it can't
// be, if it can't. github: on a thread from GitHub, where only the replies since go, and a resolve or reopen made here.
// onFile: its lines aren't in the PR's diff, so it goes on the whole file, quoting them.
export type PostableThread = {
  threadId: number;
  path: string | null;
  lines: string;
  body: string;
  github: boolean;
  yours: number; // entries of the user's to post
  agents: number; // … and of the agent's, posted with a marker if picked
  resolve: boolean | null; // true: resolve it on GitHub, false: reopen it, null: neither
  onFile: boolean;
  problem: string | null;
};

const linesOf = (e: Pick<ReviewEntry, "startLine" | "endLine">) =>
  e.startLine === e.endLine ? `${e.startLine}` : `${e.startLine}–${e.endLine}`;
const postable = (e: ReviewEntry) => !e.githubId && e.kind !== "comment";

// Every thread with something to post: a thread of the workspace's not on GitHub yet (open, and the user's, or the
// agent's that the user replied to), or one from GitHub with replies or a resolve since. Its lines are taken in what's
// on GitHub (ADR 0028), the PR's head: lines only here (not pushed, not committed) can't be posted yet.
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
    const github = !!root.githubThreadId;
    const unposted = (github ? replies : [root, ...replies]).filter(postable);
    const resolve =
      github && !!root.resolvedAt !== resolvedThere.get(root.id) ? !!root.resolvedAt : null;
    const userReplied = replies.some((r) => !byAgent(r));
    if (!github && (root.resolvedAt || (byAgent(root) && !userReplied))) continue;
    if (!unposted.length && resolve === null) continue;
    const problem = match(root)
      .when(
        (r) => r.section != null,
        () => "On a view's text, which isn't on GitHub",
      )
      .when(
        (r) => !github && !r.shown,
        (r) =>
          r.state === "outdated"
            ? "Its lines have changed since; reply on the new lines instead"
            : "Its lines aren't on GitHub yet: push first",
      )
      .otherwise(() => null);
    out.push({
      threadId: root.id,
      path: root.path,
      lines: root.section != null ? `§ ${root.section + 1}` : linesOf(root),
      body: root.body,
      github,
      yours: unposted.filter((e) => !byAgent(e)).length,
      agents: unposted.filter(byAgent).length,
      resolve,
      onFile: !github && !problem && !(await inDiff(root)),
      problem,
    });
  }
  return out;
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
export type ReviewPost = {
  threads: number[];
  withAgent: boolean; // post the agent's entries too, marked as the agent's
  event: ReviewEvent;
  body: string;
};

const agentNames: Record<string, string> = { claude: "Claude", codex: "Codex" };

// An entry as it's posted. The agent's are marked as such (ADR 0037): they go out as the user, who picked them.
async function postedBody(db: Db, e: ReviewEntry, thread: ReviewEntry[]): Promise<string> {
  if (!byAgent(e)) return e.body;
  const asked = thread.findLast((q) => q.kind === "question" && q.id < e.id)?.agentSessionId;
  const agent =
    asked &&
    (
      await db
        .selectFrom("agent_sessions")
        .select("agent")
        .where("agent_session_id", "=", asked)
        .executeTakeFirst()
    )?.agent;
  const who = agentNames[agent ?? ""] ?? "The agent";
  const what = e.kind === "answer" ? "" : ` (${e.kind})`;
  return `> 🤖 ${who}${what}, via coxswain\n\n${e.body}`;
}

type Posted = { id: string; url: string };

// Posts the picked threads as one review of the PR's head as last opened, then submits it with event and body:
// each new thread with its entries, replies to threads from GitHub, and the resolves and reopens made here. What got
// posted is recorded as it goes, so a failure halfway posts nothing twice; a review left pending is submitted next time.
export async function postReview(
  db: Db,
  workspaceId: number,
  post: ReviewPost,
): Promise<{ status: "ok" } | GitHubProblem> {
  const w = await prOf(db, workspaceId);
  const [mergeBase, head] = [currentMergeBase(workspaceId), currentHead(workspaceId)];
  if (!mergeBase || !head) return { status: "error", message: "Open the workspace first" };
  const picked = new Set(post.threads);
  const listed = (await listPostable(db, workspaceId)).filter(
    (t) => picked.has(t.threadId) && !t.problem,
  );
  const entries = await listEntries(db, workspaceId, mergeBase, mergeBase, head);
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
  const posting = listed.some((t) => !t.github || t.yours || (post.withAgent && t.agents));
  const reviewing = posting || !!reviewId || !!post.body.trim() || post.event !== "COMMENT";
  if (!reviewing && listed.every((t) => t.resolve === null))
    return { status: "error", message: "Nothing to post" };
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
    for (const t of listed) {
      const root = entries.find((e) => e.id === t.threadId)!;
      const thread = [root, ...entries.filter((e) => e.parentId === root.id)];
      const going = thread.filter(
        (e) => postable(e) && (post.withAgent || !byAgent(e) || (e === root && !t.github)),
      );
      let threadId = root.githubThreadId;
      for (const e of going) {
        const body = await postedBody(db, e, thread);
        if (!threadId) {
          const side = root.side === "old" ? "LEFT" : "RIGHT";
          const many = root.startLine !== root.endLine;
          const made = await githubGraphql<{
            addPullRequestReviewThread: {
              thread: { id: string; comments: { nodes: Posted[] } };
            };
          }>(
            `mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) {
              thread { id comments(first: 1) { nodes { id url } } } } }`,
            {
              input: {
                pullRequestReviewId: reviewId,
                path: root.path,
                body: t.onFile
                  ? `On ${many ? "lines" : "line"} ${linesOf(root)}${root.side === "old" ? " (removed)" : ""}:\n${fence(root.code ?? "")}\n\n${body}`
                  : body,
                ...(t.onFile
                  ? { subjectType: "FILE" }
                  : {
                      subjectType: "LINE",
                      line: root.endLine,
                      side,
                      ...(many && { startLine: root.startLine, startSide: side }),
                    }),
              },
            },
          );
          if (made.status !== "ok") return made;
          const th = made.data.addPullRequestReviewThread.thread;
          threadId = th.id;
          await record(e.id, th.comments.nodes[0], th.id);
          if (e.id !== root.id)
            await db
              .updateTable("entries")
              .set({ github_thread_id: th.id, github_resolved: 0 })
              .where("id", "=", root.id)
              .execute();
          continue;
        }
        const replied = await githubGraphql<{
          addPullRequestReviewThreadReply: { comment: Posted };
        }>(
          `mutation($review: ID!, $thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {
            pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) { comment { id url } } }`,
          { review: reviewId, thread: threadId, body },
        );
        if (replied.status !== "ok") return replied;
        await record(e.id, replied.data.addPullRequestReviewThreadReply.comment);
      }
    }
    const submitted = await githubGraphql(
      `mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: {
        pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { id } } }`,
      { review: reviewId, event: post.event, body: post.body.trim() || null },
    );
    if (submitted.status !== "ok") return submitted;
  }
  for (const t of listed) {
    if (t.resolve === null) continue;
    const root = entries.find((e) => e.id === t.threadId)!;
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
