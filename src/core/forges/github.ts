import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "@octokit/core";
import { match, P } from "ts-pattern";
import type {
  Check,
  CheckState,
  CommentRef,
  CurrentUser,
  Forge,
  ForgeComment,
  ForgeProblem,
  ForgeRepo,
  ForgeResult,
  Posted,
  Pr,
  PullRequestResult,
  PullRequestTitle,
  ReviewThread,
} from "../forge.ts";

// ADR 0006: GitHub, github.com only, through Octokit with the token of the user's gh.

const problem = (status: "signed-out" | "cli-missing"): ForgeProblem => ({
  status,
  forge: "github",
  host: "github.com",
});

// ADR 0006: the token comes from `gh` each time and is never stored.
// ponytail: relies on PATH, a Finder-launched packaged app won't see Homebrew's gh; fix when we package.
async function ghToken(): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("gh", [
      "auth",
      "token",
      "--hostname",
      "github.com",
    ]);
    return stdout.trim() || null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw e;
    return null; // gh exits non-zero when not signed in
  }
}

async function withGitHub<T>(fn: (octokit: Octokit) => Promise<T>): Promise<T | ForgeProblem> {
  let token: string | null;
  try {
    token = await ghToken();
  } catch {
    return problem("cli-missing");
  }
  if (!token) return problem("signed-out");

  try {
    return await fn(new Octokit({ auth: token }));
  } catch (e) {
    if ((e as { status?: number }).status === 401) return problem("signed-out");
    return { status: "error", message: (e as Error).message };
  }
}

const ownerName = (repo: ForgeRepo) => {
  const [owner, name] = repo.path.split("/");
  return { owner, name };
};

function getCurrentUser(): Promise<CurrentUser> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /user");
    return { status: "signed-in", login: data.login, name: data.name, avatarUrl: data.avatar_url };
  });
}

const PER_PAGE = 100;

// Every repository the user can see (owned, collaborator, organisation member), most recently pushed first.
function listRepos(page: number) {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /user/repos", {
      sort: "pushed",
      per_page: PER_PAGE,
      page,
    });
    return {
      status: "ok" as const,
      repos: data.map((r) => ({
        id: Number(r.id),
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        pushedAt: r.pushed_at ?? null,
      })),
      hasMore: data.length === PER_PAGE,
    };
  });
}

// Open PRs of one repository, most recently updated first.
// ponytail: first 100 only; page like listRepos if a repository has more open PRs than that.
function listPullRequests(repo: ForgeRepo) {
  const { owner, name } = ownerName(repo);
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
      owner,
      repo: name,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });
    return {
      status: "ok" as const,
      pulls: data.map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? null,
        headRef: p.head.ref,
        draft: p.draft ?? false,
        updatedAt: p.updated_at,
      })),
    };
  });
}

// Title and state of some PRs of one repository, open or not, in one GraphQL request. A number GitHub doesn't know is
// left out.
function listPullRequestTitles(repo: ForgeRepo, numbers: number[]) {
  const { owner, name } = ownerName(repo);
  return withGitHub(async (octokit) => {
    if (!numbers.length) return { status: "ok" as const, pulls: [] };
    const fields = numbers
      .map((n) => `pr${n}: pullRequest(number: ${Math.trunc(n)}) { number title state isDraft }`)
      .join("\n");
    type Found = { number: number; title: string; state: string; isDraft: boolean } | null;
    type Data = { repository: Record<string, Found> };
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
    // A number that isn't a PR fails only its own field: GraphQL answers the others next to the error.
    const data = await octokit.graphql<Data>(query, { owner, name }).catch((e: { data?: Data }) => {
      if (e.data?.repository) return e.data;
      throw e;
    });
    return {
      status: "ok" as const,
      pulls: Object.values(data.repository).flatMap((p) =>
        p
          ? [
              {
                number: p.number,
                title: p.title,
                state: p.state.toLowerCase() as PullRequestTitle["state"],
                draft: p.isDraft,
              },
            ]
          : [],
      ),
    };
  });
}

// Where a PR's head is, and the commits its diff is between: GitHub diffs the head against the merge base,
// not the base branch's tip.
function getPullRequestHead(pr: Pr) {
  const { owner, name } = ownerName(pr.repo);
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner,
      repo: name,
      pull_number: pr.number,
    });
    // Head commits are reachable from the base repository even when the PR comes from a fork.
    const { data: compare } = await octokit.request(
      "GET /repos/{owner}/{repo}/compare/{basehead}",
      {
        owner,
        repo: name,
        basehead: `${data.base.sha}...${data.head.sha}`,
        per_page: 1,
      },
    );
    return {
      status: "ok" as const,
      head: data.head.sha,
      mergeBase: compare.merge_base_commit.sha,
      headRef: data.head.ref,
      fromFork: data.head.repo?.full_name !== data.base.repo.full_name,
    };
  });
}

// The open PR whose head is this branch of the repository, if there is one.
function findPullRequest(repo: ForgeRepo, branch: string) {
  const { owner, name } = ownerName(repo);
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
      owner,
      repo: name,
      head: `${owner}:${branch}`,
      state: "open",
      per_page: 1,
    });
    return { status: "ok" as const, number: data[0]?.number ?? null };
  });
}

// Opens a draft PR of a pushed branch; the user finishes its title and description on GitHub.
function createPullRequest(
  repo: ForgeRepo,
  pr: { head: string; base: string; title: string; body: string },
) {
  const { owner, name } = ownerName(repo);
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
      owner,
      repo: name,
      ...pr,
      draft: true,
    });
    return { status: "ok" as const, number: data.number, url: data.html_url };
  });
}

// ADR 0037: the PR in one GraphQL request. Polled while its workspace shows; GraphQL has no ETags, so each poll counts
// against the rate limit. Review threads and the conversation's comments are read in full, page by page (morePages),
// since a read mirrors them and takes what it doesn't find for deleted. ponytail: the first 100 comments of a thread (a
// longer one isn't pruned, see ReviewThread.complete), commits and checks; page them if PRs grow past that.
const threadFields = `id isResolved path diffSide subjectType originalLine originalStartLine
  comments(first: 100) { pageInfo { hasNextPage } nodes { id author { login } body createdAt url originalCommit { oid } } }`;
const pullRequestQuery = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login id }
  repository(owner: $owner, name: $name) {
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      id number title body url state isDraft mergeable mergeStateStatus viewerCanUpdate
      author { login } baseRefName headRefName headRefOid
      assignees(first: 20) { nodes { login } }
      labels(first: 20) { nodes { name color } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } ... on Bot { login } } } }
      latestReviews(first: 20) { nodes { author { login } state } }
      comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { id author { login } body createdAt url } }
      reviews(last: 50) { nodes { id author { login } body state submittedAt createdAt url } }
      reviewThreads(first: 100) { pageInfo { hasNextPage endCursor } nodes { ${threadFields} } }
      commits(last: 100) { nodes { commit { oid statusCheckRollup { state } } } }
      headCommit: commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl databaseId title checkSuite { app { slug } } }
        ... on StatusContext { context state targetUrl description }
      } } } } } }
    }
  }
}`;

type Login = { login: string } | null;
// GitHub's enums for checks, as its GraphQL schema has them: a commit's or rollup's state (StatusState), and a check
// run's status (CheckStatusState) and conclusion (CheckConclusionState).
type StatusState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";
type CheckStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "WAITING" | "PENDING" | "REQUESTED";
type CheckConclusion =
  | "SUCCESS"
  | "FAILURE"
  | "NEUTRAL"
  | "CANCELLED"
  | "SKIPPED"
  | "TIMED_OUT"
  | "ACTION_REQUIRED"
  | "STARTUP_FAILURE"
  | "STALE";
type RawComment = { id: string; author: Login; body: string; createdAt: string; url: string };
type RawContext =
  | {
      __typename: "CheckRun";
      name: string;
      status: CheckStatus;
      conclusion: CheckConclusion | null;
      detailsUrl: string | null;
      databaseId: number;
      title: string | null;
      checkSuite: { app: { slug: string } | null } | null;
    }
  | {
      __typename: "StatusContext";
      context: string;
      state: StatusState;
      targetUrl: string | null;
      description: string | null;
    };
type Page<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] };
type RawThread = {
  id: string;
  isResolved: boolean;
  path: string;
  diffSide: "LEFT" | "RIGHT";
  subjectType: "LINE" | "FILE";
  originalLine: number | null;
  originalStartLine: number | null;
  comments: {
    pageInfo: { hasNextPage: boolean };
    nodes: (RawComment & { originalCommit: { oid: string } | null })[];
  };
};
type RawPullRequest = {
  viewer: { login: string; id: string };
  repository: {
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    pullRequest: {
      id: string;
      number: number;
      title: string;
      body: string;
      url: string;
      state: string;
      isDraft: boolean;
      mergeable: string;
      mergeStateStatus: string;
      viewerCanUpdate: boolean;
      author: Login;
      baseRefName: string;
      headRefName: string;
      headRefOid: string;
      assignees: { nodes: { login: string }[] };
      labels: { nodes: { name: string; color: string }[] };
      reviewRequests: {
        nodes: { requestedReviewer: { login?: string; name?: string } | null }[];
      };
      latestReviews: { nodes: { author: Login; state: string }[] };
      comments: Page<RawComment>;
      reviews: {
        nodes: (RawComment & { state: string; submittedAt: string | null })[];
      };
      reviewThreads: Page<RawThread>;
      commits: {
        nodes: { commit: { oid: string; statusCheckRollup: { state: StatusState } | null } }[];
      };
      headCommit: {
        nodes: {
          commit: {
            statusCheckRollup: { state: StatusState; contexts: { nodes: RawContext[] } } | null;
          };
        }[];
      };
    } | null;
  };
};

const comment = (c: RawComment): ForgeComment => ({
  id: c.id,
  author: c.author?.login ?? "ghost",
  body: c.body,
  createdAt: c.createdAt,
  url: c.url,
});

// A rollup's or a commit status's state, as the panel colours it. Exhaustive over GitHub's enum, so a case it adds to
// the type is a type error here; at runtime an unknown one is neutral.
export const statusState = (state: StatusState): CheckState =>
  match(state)
    .returnType<CheckState>()
    .with("SUCCESS", () => "success")
    .with(P.union("FAILURE", "ERROR"), () => "failure")
    .with(P.union("PENDING", "EXPECTED"), () => "pending")
    .exhaustive(() => "neutral");

// A check run's state: running until completed, then by its conclusion.
export const checkRunState = (
  status: CheckStatus,
  conclusion: CheckConclusion | null,
): CheckState =>
  match({ status, conclusion })
    .returnType<CheckState>()
    .with({ status: P.not("COMPLETED") }, () => "pending")
    .with({ conclusion: "SUCCESS" }, () => "success")
    .with(
      { conclusion: P.union("FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED") },
      () => "failure",
    )
    .with(
      { conclusion: P.union("NEUTRAL", "CANCELLED", "SKIPPED", "STALE", null) },
      () => "neutral",
    )
    .exhaustive(() => "neutral");

const words = (s: string) => s.toLowerCase().replaceAll("_", " ");

export function parsePullRequest(data: RawPullRequest): PullRequestResult {
  const { viewer, repository: r } = data;
  const pr = r.pullRequest;
  if (!pr) return { status: "error", message: "No such pull request" };
  const rollup = pr.headCommit.nodes[0]?.commit.statusCheckRollup ?? null;
  const checks = (rollup?.contexts.nodes ?? []).map((c): Check =>
    c.__typename === "CheckRun"
      ? {
          name: c.name,
          state: checkRunState(c.status, c.conclusion),
          detail: c.title,
          url: c.detailsUrl,
          jobId: c.checkSuite?.app?.slug === "github-actions" ? c.databaseId : null,
        }
      : {
          name: c.context,
          state: statusState(c.state),
          detail: c.description,
          url: c.targetUrl,
          jobId: null,
        },
  );
  const requested = pr.reviewRequests.nodes.flatMap((n) => {
    const who = n.requestedReviewer?.login ?? n.requestedReviewer?.name;
    return who ? [{ login: who, state: "requested" }] : [];
  });
  const reviewed = pr.latestReviews.nodes.flatMap((n) =>
    n.author ? [{ login: n.author.login, state: words(n.state) }] : [],
  );
  const threads = pr.reviewThreads.nodes.map((t): ReviewThread => ({
    id: t.id,
    resolved: t.isResolved,
    path: t.path,
    side: t.diffSide === "LEFT" ? "old" : "new",
    startLine: t.subjectType === "FILE" ? null : (t.originalStartLine ?? t.originalLine),
    endLine: t.subjectType === "FILE" ? null : t.originalLine,
    commit: t.comments.nodes[0]?.originalCommit?.oid ?? null,
    comments: t.comments.nodes.map(comment),
    complete: !t.comments.pageInfo.hasNextPage,
  }));
  // A thread on a whole file has no lines to stand between: it's part of the conversation.
  const onFiles = threads.flatMap((t) =>
    t.startLine === null ? t.comments.map((c) => ({ ...c, path: t.path })) : [],
  );
  const reviews = pr.reviews.nodes.flatMap((v) =>
    v.body || v.state === "APPROVED" || v.state === "CHANGES_REQUESTED"
      ? [
          {
            ...comment({ ...v, createdAt: v.submittedAt ?? v.createdAt }),
            review: words(v.state),
          },
        ]
      : [],
  );
  return {
    status: "ok",
    id: pr.id,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    url: pr.url,
    state: pr.state.toLowerCase() as "open" | "merged" | "closed",
    draft: pr.isDraft,
    mergeable: pr.mergeable.toLowerCase() as "mergeable" | "conflicting" | "unknown",
    mergeState: words(pr.mergeStateStatus),
    author: pr.author?.login ?? null,
    baseRef: pr.baseRefName,
    headRef: pr.headRefName,
    head: pr.headRefOid,
    viewer: viewer.login,
    viewerId: viewer.id,
    canUpdate: pr.viewerCanUpdate,
    assignees: pr.assignees.nodes.map((a) => a.login),
    reviewers: [
      ...requested,
      ...reviewed.filter((v) => !requested.some((q) => q.login === v.login)),
    ],
    labels: pr.labels.nodes,
    checks,
    checkState: rollup ? statusState(rollup.state) : null,
    commitChecks: Object.fromEntries(
      pr.commits.nodes.flatMap(({ commit: c }) =>
        c.statusCheckRollup ? [[c.oid, statusState(c.statusCheckRollup.state)]] : [],
      ),
    ),
    mergeMethods: [
      ...(r.mergeCommitAllowed ? ["merge" as const] : []),
      ...(r.squashMergeAllowed ? ["squash" as const] : []),
      ...(r.rebaseMergeAllowed ? ["rebase" as const] : []),
    ],
    conversation: [...pr.comments.nodes.map(comment), ...reviews, ...onFiles].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    ),
    threads: threads.filter((t) => t.startLine !== null),
    comments: pr.comments.nodes.map(comment),
  };
}

function getPullRequest(pr: Pr): Promise<PullRequestResult> {
  const { owner, name } = ownerName(pr.repo);
  return withGitHub(async (octokit) => {
    const raw = await octokit.graphql<RawPullRequest>(pullRequestQuery, {
      owner,
      name,
      number: pr.number,
    });
    const found = raw.repository.pullRequest;
    if (found) {
      const more = <T>(field: string, fields: string, page: Page<T>) =>
        morePages<T>(octokit, found.id, field, fields, page);
      found.reviewThreads.nodes = await more("reviewThreads", threadFields, found.reviewThreads);
      found.comments.nodes = await more(
        "comments",
        "id author { login } body createdAt url",
        found.comments,
      );
    }
    return parsePullRequest(raw);
  });
}

// A connection of the PR's read to its end, 100 at a time after the first page.
async function morePages<T>(
  octokit: Octokit,
  prId: string,
  field: string,
  fields: string,
  first: Page<T>,
): Promise<T[]> {
  const nodes = [...first.nodes];
  let page = first.pageInfo;
  while (page.hasNextPage) {
    const { node } = await octokit.graphql<{ node: Record<string, Page<T>> }>(
      `query($id: ID!, $after: String) { node(id: $id) { ... on PullRequest {
        ${field}(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${fields} } } } } }`,
      { id: prId, after: page.endCursor },
    );
    nodes.push(...node[field].nodes);
    page = node[field].pageInfo;
  }
  return nodes;
}

// One GraphQL mutation (or query) as the current user; what goes wrong comes back as a problem.
function graphql<T>(query: string, variables: Record<string, unknown>) {
  return withGitHub(async (octokit) => ({
    status: "ok" as const,
    data: await octokit.graphql<T>(query, variables),
  }));
}
// The same, for a mutation whose answer isn't needed.
const mutate = (query: string, variables: Record<string, unknown>): Promise<ForgeResult> =>
  graphql(query, variables).then((r) => (r.status === "ok" ? { status: "ok" } : r));

// One REST call as the current user, resolving with its response's data.
function request<T>(route: string, params: Record<string, unknown>) {
  return withGitHub(async (octokit) => ({
    status: "ok" as const,
    data: (await octokit.request(route, params)).data as T,
  }));
}

// The last lines of a GitHub Actions job's log, where a failure usually says why. Timestamps are cut off.
function readJobLog(repo: ForgeRepo, jobId: number, lines: number) {
  const { owner, name } = ownerName(repo);
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs", {
      owner,
      repo: name,
      job_id: jobId,
    });
    const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
    const log = text
      .trimEnd()
      .split("\n")
      .slice(-lines)
      .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ""))
      .join("\n");
    return { status: "ok" as const, log };
  });
}

// ADR 0006: clone with the protocol the user chose for gh; HTTPS relies on gh's credential helper.
function ghProtocol(): Promise<string> {
  return new Promise((done) =>
    execFile("gh", ["config", "get", "git_protocol"], (e, out) => done(e ? "" : out.trim())),
  );
}

// The PR's node and its head on GitHub, for posting. With the user's review in progress, if they have one (only its
// author sees a pending review).
async function postTarget(pr: Pr) {
  const { owner, name } = ownerName(pr.repo);
  const found = await graphql<{
    repository: {
      pullRequest: {
        id: string;
        headRefOid: string;
        reviews: { nodes: { id: string; comments: { totalCount: number } }[] };
      };
    };
  }>(
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            id
            headRefOid
            reviews(states: PENDING, first: 1) {
              nodes {
                id
                comments {
                  totalCount
                }
              }
            }
          }
        }
      }
    `,
    { owner, name, number: pr.number },
  );
  if (found.status !== "ok") return found;
  const p = found.data.repository.pullRequest;
  const pending = p.reviews.nodes[0];
  return {
    status: "ok" as const,
    target: {
      id: p.id,
      head: p.headRefOid,
      pending: pending ? { id: pending.id, comments: pending.comments.totalCount } : null,
    },
  };
}

const sideOf = (side: "old" | "new") => (side === "old" ? "LEFT" : "RIGHT");

// A posted comment's mutations: on a review thread, or in the PR's conversation.
const mutations = (c: CommentRef) =>
  c.inConversation
    ? {
        edit: `mutation($id: ID!, $body: String!) { updateIssueComment(input: {id: $id, body: $body}) { clientMutationId } }`,
        remove: `mutation($id: ID!) { deleteIssueComment(input: {id: $id}) { clientMutationId } }`,
      }
    : {
        edit: `mutation($id: ID!, $body: String!) { updatePullRequestReviewComment(input: {
          pullRequestReviewCommentId: $id, body: $body }) { clientMutationId } }`,
        remove: `mutation($id: ID!) { deletePullRequestReviewComment(input: {id: $id}) { clientMutationId } }`,
      };

type RestComment = { id: number; node_id: string; html_url: string };
const posted = (c: RestComment): Posted => ({ id: c.node_id, url: c.html_url });

export const githubForge: Forge = {
  names: { forge: "GitHub", pr: "PR", request: "pull request", sign: "#", cli: "gh" },
  verdicts: ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
  // GitHub takes no single comment on the diff while the user has a review in progress.
  pendingBlocksComments: true,
  currentUser: () => getCurrentUser(),
  listRepos: (_host, page) => listRepos(page),
  cloneUrl: async (repo) =>
    (await ghProtocol()) === "ssh"
      ? `git@github.com:${repo.path}.git`
      : `https://github.com/${repo.path}.git`,
  listPullRequests,
  listPullRequestTitles,
  findPullRequest,
  getPullRequestHead,
  createPullRequest,
  getPullRequest,
  readJobLog,
  // GitHub shows a permalink to lines as the code, highlighted, with a link to it.
  permalink: (repo, sha, a) =>
    `https://github.com/${repo.path}/blob/${sha}/${a.path}#${a.startLine === a.endLine ? `L${a.startLine}` : `L${a.startLine}-L${a.endLine}`}`,
  postTarget,
  comment: async (_pr, target, body) => {
    const said = await graphql<{ addComment: { commentEdge: { node: Posted } } }>(
      `
        mutation ($pr: ID!, $body: String!) {
          addComment(input: { subjectId: $pr, body: $body }) {
            commentEdge {
              node {
                id
                url
              }
            }
          }
        }
      `,
      { pr: target.id, body },
    );
    if (said.status !== "ok") return said;
    return { status: "ok", comment: said.data.addComment.commentEdge.node };
  },
  // The user's review in progress, or a new one on the PR's head.
  startReview: async (_pr, target) => {
    let reviewId = target.pending?.id;
    if (!reviewId) {
      const made = await graphql<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(
        `
          mutation ($pr: ID!, $commit: GitObjectID!) {
            addPullRequestReview(input: { pullRequestId: $pr, commitOID: $commit }) {
              pullRequestReview {
                id
              }
            }
          }
        `,
        { pr: target.id, commit: target.head },
      );
      if (made.status !== "ok") return made;
      reviewId = made.data.addPullRequestReview.pullRequestReview.id;
    }
    const review = reviewId;
    return {
      status: "ok",
      review: {
        repliesWait: false,
        thread: async (a, body) => {
          const side = sideOf(a.side);
          const made = await graphql<{
            addPullRequestReviewThread: { thread: { id: string; comments: { nodes: Posted[] } } };
          }>(
            `
              mutation ($input: AddPullRequestReviewThreadInput!) {
                addPullRequestReviewThread(input: $input) {
                  thread {
                    id
                    comments(first: 1) {
                      nodes {
                        id
                        url
                      }
                    }
                  }
                }
              }
            `,
            {
              input: {
                pullRequestReviewId: review,
                path: a.path,
                body,
                subjectType: "LINE",
                line: a.endLine,
                side,
                ...(a.startLine !== a.endLine && { startLine: a.startLine, startSide: side }),
              },
            },
          );
          if (made.status !== "ok") return made;
          const t = made.data.addPullRequestReviewThread.thread;
          return { status: "ok", threadId: t.id, comment: t.comments.nodes[0] };
        },
        reply: async (threadId, body) => {
          const replied = await graphql<{ addPullRequestReviewThreadReply: { comment: Posted } }>(
            `
              mutation ($review: ID!, $thread: ID!, $body: String!) {
                addPullRequestReviewThreadReply(
                  input: {
                    pullRequestReviewId: $review
                    pullRequestReviewThreadId: $thread
                    body: $body
                  }
                ) {
                  comment {
                    id
                    url
                  }
                }
              }
            `,
            { review, thread: threadId, body },
          );
          if (replied.status !== "ok") return replied;
          return { status: "ok", comment: replied.data.addPullRequestReviewThreadReply.comment };
        },
        submit: async (verdict, body) => {
          const submitted = await mutate(
            `mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: {
              pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { id } } }`,
            { review, event: verdict, body: body || null },
          );
          return submitted.status === "ok" ? { status: "ok", rebound: [] } : submitted;
        },
      },
    };
  },
  // GitHub's REST single comments, each published as it's made.
  postThread: async (pr, target, a, body) => {
    const { owner, name } = ownerName(pr.repo);
    const side = sideOf(a.side);
    const made = await request<RestComment>(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      {
        owner,
        repo: name,
        pull_number: pr.number,
        body,
        commit_id: target.head,
        path: a.path,
        line: a.endLine,
        side,
        ...(a.startLine !== a.endLine && { start_line: a.startLine, start_side: side }),
      },
    );
    if (made.status !== "ok") return made;
    return { status: "ok", comment: posted(made.data), threadId: null };
  },
  // A reply goes to the thread's first comment, by its REST id.
  postReply: async (pr, thread, body) => {
    const { owner, name } = ownerName(pr.repo);
    const top = await graphql<{ node: { databaseId: number } | null }>(
      `
        query ($id: ID!) {
          node(id: $id) {
            ... on PullRequestReviewComment {
              databaseId
            }
          }
        }
      `,
      { id: thread.first },
    );
    if (top.status !== "ok") return top;
    if (!top.data.node)
      return { status: "error", message: "The thread's first comment is gone from GitHub" };
    const r = await request<RestComment>(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
      { owner, repo: name, pull_number: pr.number, comment_id: top.data.node.databaseId, body },
    );
    if (r.status !== "ok") return r;
    return { status: "ok", comment: posted(r.data) };
  },
  resolve: (_pr, threadId, resolved) =>
    mutate(
      resolved
        ? `mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id } } }`
        : `mutation($id: ID!) { unresolveReviewThread(input: {threadId: $id}) { thread { id } } }`,
      { id: threadId },
    ),
  commentBody: async (_pr, c) => {
    const now = await graphql<{ node: { body: string } | null }>(
      c.inConversation
        ? `query($id: ID!) { node(id: $id) { ... on IssueComment { body } } }`
        : `query($id: ID!) { node(id: $id) { ... on PullRequestReviewComment { body } } }`,
      { id: c.id },
    );
    return now.status === "ok" ? { status: "ok", body: now.data.node?.body ?? null } : now;
  },
  editComment: (_pr, c, body) => mutate(mutations(c).edit, { id: c.id, body }),
  deleteComment: async (_pr, c) => {
    const done = await mutate(mutations(c).remove, { id: c.id });
    return done.status === "error" && /Could not resolve to a node/.test(done.message)
      ? { status: "ok" }
      : done;
  },
  changePullRequest: (_pr, ref, change) => {
    const [query, variables] = match(change)
      .returnType<[string, Record<string, unknown>]>()
      .with({ kind: "body" }, (c) => [
        `mutation($pr: ID!, $body: String!) { updatePullRequest(input: {pullRequestId: $pr, body: $body}) { clientMutationId } }`,
        { pr: ref.id, body: c.body },
      ])
      .with({ kind: "comment" }, (c) => [
        `mutation($pr: ID!, $body: String!) { addComment(input: {subjectId: $pr, body: $body}) { clientMutationId } }`,
        { pr: ref.id, body: c.body },
      ])
      .with({ kind: "assign" }, (c) => [
        c.on
          ? `mutation($pr: ID!, $me: ID!) { addAssigneesToAssignable(input: {assignableId: $pr, assigneeIds: [$me]}) { clientMutationId } }`
          : `mutation($pr: ID!, $me: ID!) { removeAssigneesFromAssignable(input: {assignableId: $pr, assigneeIds: [$me]}) { clientMutationId } }`,
        { pr: ref.id, me: ref.viewerId },
      ])
      .with({ kind: "ready" }, () => [
        `mutation($pr: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $pr}) { clientMutationId } }`,
        { pr: ref.id },
      ])
      .with({ kind: "merge" }, (c) => [
        `mutation($pr: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) { mergePullRequest(input: {
          pullRequestId: $pr, mergeMethod: $method, expectedHeadOid: $head}) { clientMutationId } }`,
        { pr: ref.id, method: c.method.toUpperCase(), head: ref.head },
      ])
      .exhaustive();
    return mutate(query, variables);
  },
};
