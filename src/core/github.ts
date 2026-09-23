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

export type ChangedFile = {
  path: string
  previousPath: string | null // set for renames
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  additions: number
  deletions: number
}

export type ChangedFileList = { status: 'ok'; files: ChangedFile[] } | GitHubProblem

// The PR's file diffs (GitHub lists at most 3000).
export function listChangedFiles(owner: string, name: string, prNumber: number): Promise<ChangedFileList> {
  return withGitHub(async (octokit) => {
    const files: ChangedFile[] = []
    for (let page = 1; ; page++) {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
        owner,
        repo: name,
        pull_number: prNumber,
        per_page: 100,
        page,
      })
      for (const f of data) {
        const status =
          f.status === 'added' || f.status === 'renamed' ? f.status : f.status === 'removed' ? 'deleted' : 'modified'
        files.push({
          path: f.filename,
          previousPath: f.previous_filename ?? null,
          status,
          additions: f.additions,
          deletions: f.deletions,
        })
      }
      if (data.length < 100) return { status: 'ok', files }
    }
  })
}

export type PullRequestCommits = { status: 'ok'; head: string; mergeBase: string } | GitHubProblem

// The commits a PR's diff is between: GitHub diffs the head against the merge base, not the base branch's tip.
export function getPullRequestCommits(owner: string, name: string, prNumber: number): Promise<PullRequestCommits> {
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
    return { status: 'ok', head: pr.head.sha, mergeBase: compare.merge_base_commit.sha }
  })
}

export type FileTreeResult = { status: 'ok'; paths: string[]; truncated: boolean } | GitHubProblem

// Every file at a commit.
// ponytail: read from GitHub until we clone; switch to the workspace's worktree then.
export function listFilesAt(owner: string, name: string, commit: string): Promise<FileTreeResult> {
  return withGitHub(async (octokit) => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
      owner,
      repo: name,
      tree_sha: commit,
      recursive: 'true',
    })
    return {
      status: 'ok',
      paths: data.tree.flatMap((e) => (e.type === 'blob' && e.path ? [e.path] : [])),
      truncated: data.truncated,
    }
  })
}

// text is null when the file doesn't exist at that commit (added or deleted in the diff) or is binary.
export type FileText = { status: 'ok'; text: string | null; binary: boolean } | GitHubProblem

export function readFileAt(owner: string, name: string, commit: string, path: string): Promise<FileText> {
  return withGitHub(async (octokit) => {
    let data
    try {
      ;({ data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo: name,
        path,
        ref: commit,
      }))
    } catch (e) {
      if ((e as { status?: number }).status === 404) return { status: 'ok', text: null, binary: false }
      throw e
    }
    if (Array.isArray(data) || data.type !== 'file') return { status: 'ok', text: null, binary: false }
    // The contents API leaves out files over 1 MB; the blob API has them.
    const base64 =
      data.content ||
      (await octokit.request('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', { owner, repo: name, file_sha: data.sha }))
        .data.content
    const bytes = Buffer.from(base64, 'base64')
    const binary = bytes.includes(0)
    return { status: 'ok', text: binary ? null : bytes.toString('utf8'), binary }
  })
}
