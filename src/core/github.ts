import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "@octokit/core";

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
