import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "@octokit/core";
import { match, P } from "ts-pattern";

export type GitHubProblem =
  | { status: "signed-out" }
  | { status: "gh-missing" }
  | { status: "error"; message: string };

export type CurrentUser =
  | { status: "signed-in"; login: string; name: string | null; avatarUrl: string }
  | GitHubProblem;

export type Repo = {
  id: number;
  fullName: string;
  description: string | null;
  private: boolean;
  pushedAt: string | null;
};

export type PullRequest = {
  number: number;
  title: string;
  author: string | null;
  headRef: string;
  draft: boolean;
  updatedAt: string;
};

export type PullRequestList = { status: "ok"; pulls: PullRequest[] } | GitHubProblem;

// What the workspace rail shows of a workspace's PR: its title and whether it's still open.
export type PullRequestTitle = {
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
};
export type PullRequestTitles = { status: "ok"; pulls: PullRequestTitle[] } | GitHubProblem;

export type RepoPage = { status: "ok"; repos: Repo[]; hasMore: boolean } | GitHubProblem;

// ADR 0006: the token comes from `gh` each time and is never stored.
// ponytail: relies on PATH, a Finder-launched packaged app won't see Homebrew's gh; fix when we package.
export async function ghToken(): Promise<string | null> {
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

async function withGitHub<T>(fn: (octokit: Octokit) => Promise<T>): Promise<T | GitHubProblem> {
  let token: string | null;
  try {
    token = await ghToken();
  } catch {
    return { status: "gh-missing" };
  }
  if (!token) return { status: "signed-out" };

  try {
    return await fn(new Octokit({ auth: token }));
  } catch (e) {
    if ((e as { status?: number }).status === 401) return { status: "signed-out" };
    return { status: "error", message: (e as Error).message };
  }
}

export function getCurrentUser(): Promise<CurrentUser> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /user");
    return { status: "signed-in", login: data.login, name: data.name, avatarUrl: data.avatar_url };
  });
}

const PER_PAGE = 100;

// Every repository the user can see (owned, collaborator, organisation member), most recently pushed first.
export function listRepos(page: number): Promise<RepoPage> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /user/repos", {
      sort: "pushed",
      per_page: PER_PAGE,
      page,
    });
    return {
      status: "ok",
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
export function listPullRequests(owner: string, name: string): Promise<PullRequestList> {
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
      status: "ok",
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
export function listPullRequestTitles(
  owner: string,
  name: string,
  numbers: number[],
): Promise<PullRequestTitles> {
  return withGitHub(async (octokit) => {
    if (!numbers.length) return { status: "ok", pulls: [] };
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
      status: "ok",
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

type PullRequestHead =
  | { status: "ok"; head: string; mergeBase: string; headRef: string; fromFork: boolean }
  | GitHubProblem;

// Where a PR's head is, and the commits its diff is between: GitHub diffs the head against the merge base,
// not the base branch's tip.
export function getPullRequestHead(
  owner: string,
  name: string,
  prNumber: number,
): Promise<PullRequestHead> {
  return withGitHub(async (octokit) => {
    const { data: pr } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner,
      repo: name,
      pull_number: prNumber,
    });
    // Head commits are reachable from the base repository even when the PR comes from a fork.
    const { data: compare } = await octokit.request(
      "GET /repos/{owner}/{repo}/compare/{basehead}",
      {
        owner,
        repo: name,
        basehead: `${pr.base.sha}...${pr.head.sha}`,
        per_page: 1,
      },
    );
    return {
      status: "ok",
      head: pr.head.sha,
      mergeBase: compare.merge_base_commit.sha,
      headRef: pr.head.ref,
      fromFork: pr.head.repo?.full_name !== pr.base.repo.full_name,
    };
  });
}

// The open PR whose head is this branch of the repository, if there is one.
export function findPullRequest(
  owner: string,
  name: string,
  branch: string,
): Promise<{ status: "ok"; number: number | null } | GitHubProblem> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
      owner,
      repo: name,
      head: `${owner}:${branch}`,
      state: "open",
      per_page: 1,
    });
    return { status: "ok", number: data[0]?.number ?? null };
  });
}

export type CreatedPullRequest = { status: "ok"; number: number; url: string } | GitHubProblem;

// Opens a draft PR of a pushed branch; the user finishes its title and description on GitHub.
export function createPullRequest(
  owner: string,
  name: string,
  pr: { head: string; base: string; title: string; body: string },
): Promise<CreatedPullRequest> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
      owner,
      repo: name,
      ...pr,
      draft: true,
    });
    return { status: "ok", number: data.number, url: data.html_url };
  });
}

// ADR 0037: a PR as its panel shows it, with its review threads (mirrored into entries) and its checks, in one GraphQL
// request. Polled while its workspace shows; GraphQL has no ETags, so each poll counts against the rate limit.
export type CheckState = "success" | "failure" | "pending" | "neutral";
// A check on a commit: a check run (GitHub Actions and other apps) or a commit status. jobId: an Actions job, whose
// log can be read.
export type Check = {
  name: string;
  state: CheckState;
  detail: string | null;
  url: string | null;
  jobId: number | null;
};
export type GitHubComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string;
};
// A review thread on lines: side and lines as they were where its first comment was written (commit). file: a thread
// on a whole file, which has no lines.
export type ReviewThread = {
  id: string;
  resolved: boolean;
  path: string;
  side: "old" | "new";
  startLine: number | null;
  endLine: number | null;
  commit: string | null;
  comments: GitHubComment[];
};
// One item of the PR's conversation: a comment on the PR, a review's summary (review: its verdict), or a comment on a
// whole file (path).
export type ConversationItem = GitHubComment & { review?: string; path?: string };
export type MergeMethod = "merge" | "squash" | "rebase";
export type PullRequestDetails = {
  status: "ok";
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  // Whether it merges cleanly, and what GitHub says of merging it now (blocked by required checks or reviews, …).
  mergeable: "mergeable" | "conflicting" | "unknown";
  mergeState: string;
  author: string | null;
  baseRef: string;
  headRef: string;
  head: string;
  viewer: string;
  viewerId: string;
  canUpdate: boolean;
  assignees: string[];
  reviewers: { login: string; state: string }[]; // state: requested, approved, changes requested, commented, …
  labels: { name: string; color: string }[];
  checks: Check[]; // the head commit's
  checkState: CheckState | null; // all of them at once; null without any
  commitChecks: Record<string, CheckState>; // each commit's, by sha
  mergeMethods: MergeMethod[];
  conversation: ConversationItem[];
  threads: ReviewThread[];
};
export type PullRequestResult = PullRequestDetails | GitHubProblem;

// ponytail: the first 100 threads, comments, commits and checks; page them if PRs grow past that.
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
      comments(last: 50) { nodes { id author { login } body createdAt url } }
      reviews(last: 50) { nodes { id author { login } body state submittedAt createdAt url } }
      reviewThreads(first: 100) { nodes {
        id isResolved path diffSide subjectType originalLine originalStartLine
        comments(first: 100) { nodes { id author { login } body createdAt url originalCommit { oid } } }
      } }
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
      comments: { nodes: RawComment[] };
      reviews: {
        nodes: (RawComment & { state: string; submittedAt: string | null })[];
      };
      reviewThreads: {
        nodes: {
          id: string;
          isResolved: boolean;
          path: string;
          diffSide: "LEFT" | "RIGHT";
          subjectType: "LINE" | "FILE";
          originalLine: number | null;
          originalStartLine: number | null;
          comments: { nodes: (RawComment & { originalCommit: { oid: string } | null })[] };
        }[];
      };
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

const comment = (c: RawComment): GitHubComment => ({
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
    state: pr.state.toLowerCase() as PullRequestDetails["state"],
    draft: pr.isDraft,
    mergeable: pr.mergeable.toLowerCase() as PullRequestDetails["mergeable"],
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
  };
}

export function getPullRequest(
  owner: string,
  name: string,
  prNumber: number,
): Promise<PullRequestResult> {
  return withGitHub(async (octokit) =>
    parsePullRequest(
      await octokit.graphql<RawPullRequest>(pullRequestQuery, { owner, name, number: prNumber }),
    ),
  );
}

// One GraphQL mutation (or query) as the current user; what goes wrong comes back as a problem.
export function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<{ status: "ok"; data: T } | GitHubProblem> {
  return withGitHub(async (octokit) => ({
    status: "ok" as const,
    data: await octokit.graphql<T>(query, variables),
  }));
}

// One REST call as the current user, resolving with its response's data; what goes wrong comes back as a problem.
export function githubRequest<T>(
  route: string,
  params: Record<string, unknown>,
): Promise<{ status: "ok"; data: T } | GitHubProblem> {
  return withGitHub(async (octokit) => ({
    status: "ok" as const,
    data: (await octokit.request(route, params)).data as T,
  }));
}

// The last lines of a GitHub Actions job's log, where a failure usually says why. Timestamps are cut off.
export function readJobLog(
  owner: string,
  name: string,
  jobId: number,
  lines = 150,
): Promise<{ status: "ok"; log: string } | GitHubProblem> {
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
