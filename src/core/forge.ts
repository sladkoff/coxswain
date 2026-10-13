import { githubForge } from "./forges/github.ts";
import { gitlabForge, gitlabHostOf, gitlabHosts } from "./forges/gitlab.ts";

// ADR 0041: a forge is where a project's PRs are. Everything outside core/forges/ talks to a Forge, never to GitHub or
// GitLab themselves.
export type ForgeKind = "github" | "gitlab";
// A repository on a forge: path is GitHub's owner/name, or GitLab's group/…/name.
export type ForgeRepo = { forge: ForgeKind; host: string; path: string };
// A PR of a repository on its forge, by its number (GitLab's iid).
export type Pr = { repo: ForgeRepo; number: number };

export type ForgeProblem =
  | { status: "signed-out"; forge: ForgeKind; host: string }
  | { status: "cli-missing"; forge: ForgeKind; host: string }
  | { status: "error"; message: string };
export type ForgeResult<T extends object = object> = ({ status: "ok" } & T) | ForgeProblem;

export type CurrentUser =
  | { status: "signed-in"; login: string; name: string | null; avatarUrl: string }
  | ForgeProblem;

// A repository in the forge's list of those the user can see. fullName: its path there.
export type Repo = {
  id: number;
  fullName: string;
  description: string | null;
  private: boolean;
  pushedAt: string | null;
};
export type RepoPage = ForgeResult<{ repos: Repo[]; hasMore: boolean }>;

export type PullRequest = {
  number: number;
  title: string;
  author: string | null;
  headRef: string;
  draft: boolean;
  updatedAt: string;
};
export type PullRequestList = ForgeResult<{ pulls: PullRequest[] }>;

// What the workspace rail shows of a workspace's PR: its title and whether it's still open.
export type PullRequestTitle = {
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
};
export type PullRequestTitles = ForgeResult<{ pulls: PullRequestTitle[] }>;

// Where a PR's head is, and the merge base its diff is from.
export type PullRequestHead = ForgeResult<{
  head: string;
  mergeBase: string;
  headRef: string;
  fromFork: boolean;
}>;
export type CreatedPullRequest = ForgeResult<{ number: number; url: string }>;

// ADR 0037: a PR as its panel shows it, with its review threads (mirrored into entries) and its checks.
export type CheckState = "success" | "failure" | "pending" | "neutral";
// A check on a commit: on GitHub a check run or a commit status, on GitLab a pipeline's job. jobId: a job whose log can
// be read (readJobLog).
export type Check = {
  name: string;
  state: CheckState;
  detail: string | null;
  url: string | null;
  jobId: number | null;
};
export type ForgeComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string;
};
// A review thread on lines: side and lines as they were where its first comment was written (commit).
export type ReviewThread = {
  id: string;
  resolved: boolean;
  path: string;
  side: "old" | "new";
  startLine: number | null;
  endLine: number | null;
  commit: string | null;
  comments: ForgeComment[];
  complete: boolean; // every comment of it was read
};
// One item of the PR's conversation: a comment on the PR, a review's summary (review: its verdict), or a comment on a
// whole file (path).
export type ConversationItem = ForgeComment & { review?: string; path?: string };
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
  // Whether it merges cleanly, and what the forge says of merging it now (blocked by required checks or reviews, …).
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
  comments: ForgeComment[]; // the conversation's comments, all of them
};
export type PullRequestResult = PullRequestDetails | ForgeProblem;

// Posting (ADR 0037). Posted: a comment as the forge has it.
export type Posted = { id: string; url: string };
// Lines of a file diff, on one side.
export type LineAnchor = { path: string; side: "old" | "new"; startLine: number; endLine: number };
// The PR as posting needs it: its id on the forge, its head there, and the user's review in progress, if any.
export type PostTarget = {
  id: string;
  head: string;
  pending: { id: string; comments: number } | null;
};
export type Verdict = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
// A posted comment: on a review thread, or in the PR's conversation.
export type CommentRef = { id: string; inConversation: boolean };
// A comment recorded under an id the forge replaced when the review was submitted, and what it is now.
export type Rebound = { was: string; comment: Posted; threadId: string | null };
// A review in progress: comments added to it go out together when it's submitted. repliesWait: a thread started in it
// takes no replies until it's submitted (GitLab's draft notes), so they're posted after.
export type Review = {
  repliesWait: boolean;
  thread(
    anchor: LineAnchor,
    body: string,
  ): Promise<ForgeResult<{ threadId: string; comment: Posted }>>;
  reply(threadId: string, body: string): Promise<ForgeResult<{ comment: Posted }>>;
  submit(verdict: Verdict, body: string): Promise<ForgeResult<{ rebound: Rebound[] }>>;
};

// What the PR panel changes on the forge, each at the user's click: the description, a comment on the PR, assigning
// themselves, ready for review, merging.
export type PullRequestChange =
  | { kind: "body"; body: string }
  | { kind: "comment"; body: string }
  | { kind: "assign"; on: boolean }
  | { kind: "ready" }
  | { kind: "merge"; method: MergeMethod };
// The PR as the panel read it: the ids a change needs, and the head a merge must still be at.
export type PullRequestRef = { id: string; viewerId: string; head: string };

export type Forge = {
  // How the UI and the agent's texts name it, its PRs (short and long, and the sign before a PR's number) and its CLI.
  names: { forge: string; pr: string; request: string; sign: string; cli: string };
  verdicts: Verdict[];
  // Whether the forge refuses a single comment on the diff while the user has a review in progress.
  pendingBlocksComments: boolean;
  currentUser(host: string): Promise<CurrentUser>;
  listRepos(host: string, page: number): Promise<RepoPage>;
  cloneUrl(repo: ForgeRepo): Promise<string>;
  listPullRequests(repo: ForgeRepo): Promise<PullRequestList>;
  listPullRequestTitles(repo: ForgeRepo, numbers: number[]): Promise<PullRequestTitles>;
  findPullRequest(repo: ForgeRepo, branch: string): Promise<ForgeResult<{ number: number | null }>>;
  getPullRequestHead(pr: Pr): Promise<PullRequestHead>;
  createPullRequest(
    repo: ForgeRepo,
    pr: { head: string; base: string; title: string; body: string },
  ): Promise<CreatedPullRequest>;
  getPullRequest(pr: Pr): Promise<PullRequestResult>;
  readJobLog(repo: ForgeRepo, jobId: number, lines: number): Promise<ForgeResult<{ log: string }>>;
  // A link to lines at a commit that the forge shows as the code itself; null if it shows only a link.
  permalink(repo: ForgeRepo, sha: string, anchor: LineAnchor): string | null;
  postTarget(pr: Pr): Promise<ForgeResult<{ target: PostTarget }>>;
  comment(pr: Pr, target: PostTarget, body: string): Promise<ForgeResult<{ comment: Posted }>>;
  startReview(pr: Pr, target: PostTarget): Promise<ForgeResult<{ review: Review }>>;
  // A comment published at once: a new thread on lines, or a reply on one (first: its first comment's id).
  postThread(
    pr: Pr,
    target: PostTarget,
    anchor: LineAnchor,
    body: string,
  ): Promise<ForgeResult<{ comment: Posted; threadId: string | null }>>;
  postReply(
    pr: Pr,
    thread: { id: string; first: string },
    body: string,
  ): Promise<ForgeResult<{ comment: Posted }>>;
  resolve(pr: Pr, threadId: string, resolved: boolean): Promise<ForgeResult>;
  commentBody(pr: Pr, c: CommentRef): Promise<ForgeResult<{ body: string | null }>>;
  editComment(pr: Pr, c: CommentRef, body: string): Promise<ForgeResult>;
  // One already gone from the forge is deleted all the same.
  deleteComment(pr: Pr, c: CommentRef): Promise<ForgeResult>;
  changePullRequest(pr: Pr, ref: PullRequestRef, change: PullRequestChange): Promise<ForgeResult>;
};

export const forgeOf = (kind: ForgeKind): Forge => (kind === "github" ? githubForge : gitlabForge);

// Every host coxswain can reach a forge on: github.com, and each GitLab host glab is signed in to.
export const forgeHosts = (): { forge: ForgeKind; host: string }[] => [
  { forge: "github", host: "github.com" },
  ...gitlabHosts().map((host) => ({ forge: "gitlab" as const, host })),
];

// What to tell the user when a change can't be made on the forge, as an error's message.
export const problemText = (p: ForgeProblem) =>
  p.status === "error"
    ? p.message
    : `Sign in to ${forgeOf(p.forge).names.forge} with ${forgeOf(p.forge).names.cli} first`;

// The forge a git remote's URL (HTTPS, SSH or git:) points at, or null if coxswain doesn't know its host.
export async function forgeRepoOf(url: string): Promise<ForgeRepo | null> {
  const m = url
    .trim()
    .match(
      /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/|[^@/:]+@([^/:]+):)(.+?)(?:\.git)?\/?$/,
    );
  if (!m) return null;
  const host = (m[1] ?? m[2]).toLowerCase();
  const path = m[3];
  if (host === "github.com")
    return /^[\w.-]+\/[\w.-]+$/.test(path) ? { forge: "github", host, path } : null;
  const gitlab = gitlabHostOf(host);
  return gitlab && /^[\w.-]+(\/[\w.-]+)+$/.test(path)
    ? { forge: "gitlab", host: gitlab, path }
    : null;
}
