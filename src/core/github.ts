import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Octokit } from '@octokit/core'

export type GitHubProblem =
  | { status: 'signed-out' }
  | { status: 'gh-missing' }
  | { status: 'error'; message: string }

export type CurrentUser =
  | { status: 'signed-in'; login: string; name: string | null; avatarUrl: string }
  | GitHubProblem

export type Repo = {
  id: number
  fullName: string
  description: string | null
  private: boolean
  pushedAt: string | null
}

export type PullRequest = {
  number: number
  title: string
  author: string | null
  headRef: string
  draft: boolean
  updatedAt: string
}

export type PullRequestList = { status: 'ok'; pulls: PullRequest[] } | GitHubProblem

export type RepoPage = { status: 'ok'; repos: Repo[]; hasMore: boolean } | GitHubProblem

// ADR 0006: the token comes from `gh` each time and is never stored.
// ponytail: relies on PATH, a Finder-launched packaged app won't see Homebrew's gh; fix when we package.
async function ghToken(): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('gh', ['auth', 'token', '--hostname', 'github.com'])
    return stdout.trim() || null
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e
    return null // gh exits non-zero when not signed in
  }
}

async function withGitHub<T>(fn: (octokit: Octokit) => Promise<T>): Promise<T | GitHubProblem> {
  let token: string | null
  try {
    token = await ghToken()
  } catch {
    return { status: 'gh-missing' }
  }
  if (!token) return { status: 'signed-out' }

  try {
    return await fn(new Octokit({ auth: token }))
  } catch (e) {
    if ((e as { status?: number }).status === 401) return { status: 'signed-out' }
    return { status: 'error', message: (e as Error).message }
  }
}

export function getCurrentUser(): Promise<CurrentUser> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request('GET /user')
    return { status: 'signed-in', login: data.login, name: data.name, avatarUrl: data.avatar_url }
  })
}

const PER_PAGE = 100

// Every repository the user can see (owned, collaborator, organisation member), most recently pushed first.
export function listRepos(page: number): Promise<RepoPage> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request('GET /user/repos', { sort: 'pushed', per_page: PER_PAGE, page })
    return {
      status: 'ok',
      repos: data.map((r) => ({
        id: Number(r.id),
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        pushedAt: r.pushed_at ?? null,
      })),
      hasMore: data.length === PER_PAGE,
    }
  })
}

// Open PRs of one repository, most recently updated first.
// ponytail: first 100 only; page like listRepos if a repository has more open PRs than that.
export function listPullRequests(owner: string, name: string): Promise<PullRequestList> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo: name,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    })
    return {
      status: 'ok',
      pulls: data.map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? null,
        headRef: p.head.ref,
        draft: p.draft ?? false,
        updatedAt: p.updated_at,
      })),
    }
  })
}

export type PullRequestHead =
  | { status: 'ok'; head: string; mergeBase: string; headRef: string; fromFork: boolean }
  | GitHubProblem

// Where a PR's head is, and the commits its diff is between: GitHub diffs the head against the merge base,
// not the base branch's tip.
export function getPullRequestHead(owner: string, name: string, prNumber: number): Promise<PullRequestHead> {
  return withGitHub(async (octokit) => {
    const { data: pr } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo: name,
      pull_number: prNumber,
    })
    // Head commits are reachable from the base repository even when the PR comes from a fork.
    const { data: compare } = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
      owner,
      repo: name,
      basehead: `${pr.base.sha}...${pr.head.sha}`,
      per_page: 1,
    })
    return {
      status: 'ok',
      head: pr.head.sha,
      mergeBase: compare.merge_base_commit.sha,
      headRef: pr.head.ref,
      fromFork: pr.head.repo?.full_name !== pr.base.repo.full_name,
    }
  })
}

// What happened on a PR on GitHub, for the timeline (ADR 0020). A review's comments: how many review comments it has.
// state: a review's, as GitHub's timeline gives it (approved, changes_requested, commented, dismissed).
export type GitHubEvent =
  | { kind: 'comment'; at: string; author: string | null; body: string; url: string }
  | { kind: 'review'; at: string; author: string | null; state: string; body: string; comments: number; commit: string | null; url: string }
  | { kind: 'state'; at: string; author: string | null; what: 'merged' | 'closed' | 'reopened' | 'ready' | 'draft' | 'force-pushed' }

export type PullRequestActivity =
  | { status: 'ok'; title: string; body: string; author: string | null; createdAt: string; url: string; events: GitHubEvent[] }
  | GitHubProblem

// The issue timeline's items, as far as we read them; its route types every event separately.
type TimelineItem = {
  event?: string
  id?: number
  created_at?: string
  submitted_at?: string
  user?: { login: string } | null
  actor?: { login: string } | null
  body?: string | null
  html_url?: string
  state?: string
  commit_id?: string | null
  comments?: { pull_request_review_id?: number | null }[]
}

const states: Record<string, Extract<GitHubEvent, { kind: 'state' }>['what']> = {
  merged: 'merged',
  closed: 'closed',
  reopened: 'reopened',
  ready_for_review: 'ready',
  convert_to_draft: 'draft',
  head_ref_force_pushed: 'force-pushed',
}

// The PR as the Overview shows it, and what happened on it: comments, reviews and changes of state, oldest first.
// ponytail: at most 10 pages of 100 timeline items; page further if a PR ever has more.
export function getPullRequestActivity(owner: string, name: string, prNumber: number): Promise<PullRequestActivity> {
  return withGitHub(async (octokit) => {
    const { data: pr } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo: name,
      pull_number: prNumber,
    })
    const items: TimelineItem[] = []
    for (let page = 1; page <= 10; page++) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline', {
        owner,
        repo: name,
        issue_number: prNumber,
        per_page: 100,
        page,
      })
      items.push(...(data as TimelineItem[]))
      if (data.length < 100) break
    }
    // Review comments come as line-commented items; count them by the review they belong to.
    const reviewComments = new Map<number, number>()
    for (const c of items.filter((i) => i.event === 'line-commented').flatMap((i) => i.comments ?? []))
      if (c.pull_request_review_id) reviewComments.set(c.pull_request_review_id, (reviewComments.get(c.pull_request_review_id) ?? 0) + 1)
    const events: GitHubEvent[] = []
    for (const i of items) {
      const author = i.user?.login ?? i.actor?.login ?? null
      if (i.event === 'commented' && i.created_at)
        events.push({ kind: 'comment', at: i.created_at, author, body: i.body ?? '', url: i.html_url ?? '' })
      else if (i.event === 'reviewed' && i.submitted_at)
        events.push({
          kind: 'review',
          at: i.submitted_at,
          author,
          state: i.state ?? 'commented',
          body: i.body ?? '',
          comments: (i.id && reviewComments.get(i.id)) || 0,
          commit: i.commit_id ?? null,
          url: i.html_url ?? '',
        })
      else if (i.event && states[i.event] && i.created_at) events.push({ kind: 'state', at: i.created_at, author, what: states[i.event] })
    }
    return {
      status: 'ok',
      title: pr.title,
      body: pr.body ?? '',
      author: pr.user?.login ?? null,
      createdAt: pr.created_at,
      url: pr.html_url,
      events: events.sort((a, b) => a.at.localeCompare(b.at)),
    }
  })
}
