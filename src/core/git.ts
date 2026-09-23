import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getPullRequestHead, type GitHubProblem } from './github'
import { getProject } from './projects'
import { getWorkspaceRepo } from './workspaces'

// ADR 0008: coxswain's own blobless clone per project, and one worktree per workspace on the PR's head branch.
export type GitProblem = { status: 'git-error'; message: string }

export type ChangedFile = {
  path: string
  previousPath: string | null // set for renames
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  additions: number
  deletions: number
}

export type ChangedFileList = { status: 'ok'; files: ChangedFile[] } | GitProblem
export type FileTreeResult = { status: 'ok'; paths: string[] } | GitProblem
// text is null when the file doesn't exist on that side or is binary.
export type FileText = { status: 'ok'; text: string | null; binary: boolean } | GitProblem
export type CloneResult = { status: 'ok' } | GitProblem | GitHubProblem
// notice: something the user should know, e.g. the PR moved on but local changes kept the worktree back.
export type WorktreeResult =
  | { status: 'ok'; head: string; mergeBase: string; notice: string | null }
  | GitProblem
  | GitHubProblem

const root = join(homedir(), 'coxswain')
const repoPath = (owner: string, name: string) => join(root, 'repos', owner, name)
// ADR 0005: worktrees go in ~/coxswain/worktrees/<project>/<workspace>/.
export const worktreePath = (owner: string, name: string, workspaceId: number) =>
  join(root, 'worktrees', owner, name, String(workspaceId))

class GitError extends Error {}

// ADR 0008 decision 7: git never prompts; missing credentials fail instead of hanging.
function git(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((done, fail) =>
    execFile(
      'git',
      args,
      { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (e, stdout, stderr) => (e ? fail(new GitError(stderr.toString().trim() || e.message)) : done(stdout)),
    ),
  )
}
const gitText = async (cwd: string, args: string[]) => (await git(cwd, args)).toString()

async function withGit<T>(fn: () => Promise<T>): Promise<T | GitProblem> {
  try {
    return await fn()
  } catch (e) {
    return { status: 'git-error', message: (e as Error).message }
  }
}

const clones = new Map<string, Promise<CloneResult>>()

// Clones the project if it isn't yet; safe to call again while a clone runs.
export function cloneProject(db: DatabaseSync, projectId: number): Promise<CloneResult> {
  const { owner, name } = getProject(db, projectId)
  return clone(owner, name)
}

function clone(owner: string, name: string): Promise<CloneResult> {
  const path = repoPath(owner, name)
  if (existsSync(join(path, '.git'))) return Promise.resolve({ status: 'ok' })
  const key = `${owner}/${name}`
  let cloning = clones.get(key)
  if (!cloning) {
    cloning = withGit(async () => {
      // ADR 0006: clone with the protocol the user chose for gh; HTTPS relies on gh's credential helper.
      const ssh = (await ghProtocol()) === 'ssh'
      const url = ssh ? `git@github.com:${key}.git` : `https://github.com/${key}.git`
      // Clone next to the final place and rename, so an interrupted clone never looks finished.
      const tmp = `${path}.cloning`
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(dirname(path), { recursive: true })
      await git(dirname(path), ['clone', '--filter=blob:none', '--no-checkout', url, tmp])
      renameSync(tmp, path)
      return { status: 'ok' as const }
    }).finally(() => clones.delete(key))
    clones.set(key, cloning)
  }
  return cloning
}

function ghProtocol(): Promise<string> {
  return new Promise((done) => execFile('gh', ['config', 'get', 'git_protocol'], (e, out) => done(e ? '' : out.trim())))
}

// The last result of opening each workspace's worktree, so switching back needs no network.
// ponytail: memory only, so the first open after a restart waits for GitHub and fetch (~2.5 s); persist if that hurts.
const lastOpened = new Map<number, { head: string; mergeBase: string }>()

// What openWorktree last said, if the worktree is still there; null when it has to be opened properly.
export function openedBefore(db: DatabaseSync, workspaceId: number): WorktreeResult | null {
  const last = lastOpened.get(workspaceId)
  const { owner, name } = getWorkspaceRepo(db, workspaceId)
  if (!last || !existsSync(join(worktreePath(owner, name, workspaceId), '.git'))) return null
  return { status: 'ok', ...last, notice: null }
}

// Makes sure the workspace's worktree exists and is on the PR's latest head, then says what its diff is against.
// Talks to GitHub and fetches, so it takes a second or more; show openedBefore meanwhile.
export async function openWorktree(db: DatabaseSync, workspaceId: number): Promise<WorktreeResult> {
  const { owner, name, prNumber } = getWorkspaceRepo(db, workspaceId)
  const [pr, cloned] = await Promise.all([getPullRequestHead(owner, name, prNumber), clone(owner, name)])
  if (pr.status !== 'ok') return pr
  if (cloned.status !== 'ok') return cloned
  // ponytail: fork PRs need a remote for the fork (ADR 0008); read-only via pull/<n>/head would be the cheap first step.
  if (pr.fromFork) return { status: 'git-error', message: 'PRs from forks are not supported yet' }

  return withGit(async () => {
    const repo = repoPath(owner, name)
    const path = worktreePath(owner, name, workspaceId)
    const branch = pr.headRef
    const upstream = `origin/${branch}`
    await git(repo, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/${upstream}`])
    let notice: string | null = null
    // ponytail: fails when the head branch is the default branch, which the clone itself has checked out;
    // make the clone bare (with an explicit fetch refspec) if such PRs show up.
    if (!existsSync(join(path, '.git'))) {
      if (existsSync(path) && readdirSync(path).length)
        throw new GitError(`${path} exists and isn't a worktree; move it away and reopen the workspace`)
      const hasBranch = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(
        () => true,
        () => false,
      )
      await git(
        repo,
        hasBranch ? ['worktree', 'add', path, branch] : ['worktree', 'add', '--track', '-b', branch, path, upstream],
      )
    }
    const [head, remote, dirty] = await Promise.all([
      gitText(path, ['rev-parse', 'HEAD']),
      gitText(path, ['rev-parse', upstream]),
      gitText(path, ['status', '--porcelain']),
    ])
    if (head.trim() !== remote.trim()) {
      const behind = await git(path, ['merge-base', '--is-ancestor', 'HEAD', upstream]).then(
        () => true,
        () => false,
      )
      if (behind && !dirty) await git(path, ['merge', '--ff-only', upstream])
      else notice = behind ? 'The PR has new commits; not updated because of local changes' : null
    }
    lastOpened.set(workspaceId, { head: pr.head, mergeBase: pr.mergeBase })
    return { status: 'ok' as const, head: pr.head, mergeBase: pr.mergeBase, notice }
  })
}

function openedWorktree(db: DatabaseSync, workspaceId: number): string {
  const { owner, name } = getWorkspaceRepo(db, workspaceId)
  const path = worktreePath(owner, name, workspaceId)
  if (!existsSync(join(path, '.git'))) throw new GitError('The worktree is not ready yet')
  return path
}

const isCommit = (s: string) => /^[0-9a-f]{40}$/.test(s)

// Everything that differs between the merge base and the worktree: the PR's commits, and local commits,
// uncommitted and untracked files.
export function listChangedFiles(db: DatabaseSync, workspaceId: number, mergeBase: string): Promise<ChangedFileList> {
  return withGit(async () => {
    if (!isCommit(mergeBase)) throw new GitError(`Not a commit: ${mergeBase}`)
    const path = openedWorktree(db, workspaceId)
    const [names, counts, untracked] = await Promise.all([
      gitText(path, ['diff', '-M', '-z', '--name-status', mergeBase]),
      gitText(path, ['diff', '-M', '-z', '--numstat', mergeBase]),
      gitText(path, ['ls-files', '-z', '--others', '--exclude-standard']),
    ])
    return { status: 'ok' as const, files: parseChanges(names, counts, untracked, (p) => countLines(join(path, p))) }
  })
}

// Joins `git diff -z --name-status` and `--numstat` output by path, and adds untracked files as added.
export function parseChanges(
  names: string,
  counts: string,
  untracked: string,
  linesOf: (path: string) => number,
): ChangedFile[] {
  const lines = new Map<string, [number, number]>()
  const c = counts.split('\0')
  for (let i = 0; i < c.length - 1; ) {
    const [add, del, path] = c[i].split('\t')
    // Renames have an empty path, then the old and new paths as their own fields. Binary files count "-".
    const key = path === '' ? c[i + 2] : path
    i += path === '' ? 3 : 1
    lines.set(key, [Number(add) || 0, Number(del) || 0])
  }
  const files: ChangedFile[] = []
  const n = names.split('\0')
  for (let i = 0; i < n.length - 1; ) {
    const code = n[i][0]
    const renamed = code === 'R' || code === 'C'
    const previousPath = renamed ? n[i + 1] : null
    const path = renamed ? n[i + 2] : n[i + 1]
    i += renamed ? 3 : 2
    const status = renamed ? 'renamed' : code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
    const [additions, deletions] = lines.get(path) ?? [0, 0]
    files.push({ path, previousPath: code === 'C' ? null : previousPath, status, additions, deletions })
  }
  for (const path of untracked.split('\0').filter(Boolean))
    files.push({ path, previousPath: null, status: 'added', additions: linesOf(path), deletions: 0 })
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function countLines(file: string): number {
  try {
    const bytes = readFileSync(file)
    if (bytes.includes(0)) return 0
    const text = bytes.toString('utf8')
    return text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0
  } catch {
    return 0
  }
}

// Every file in the worktree: tracked ones plus new files that aren't ignored.
export function listWorktreeFiles(db: DatabaseSync, workspaceId: number): Promise<FileTreeResult> {
  return withGit(async () => {
    const path = openedWorktree(db, workspaceId)
    const out = await gitText(path, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'])
    // A file deleted in the worktree is still in the index until the deletion is staged.
    const paths = out.split('\0').filter((p) => p && existsSync(join(path, p)))
    return { status: 'ok' as const, paths }
  })
}

const asText = (bytes: Buffer): FileText =>
  bytes.includes(0) ? { status: 'ok', text: null, binary: true } : { status: 'ok', text: bytes.toString('utf8'), binary: false }

// A file as it is in the worktree now.
export function readWorktreeFile(db: DatabaseSync, workspaceId: number, file: string): Promise<FileText> {
  return withGit(async () => {
    const path = openedWorktree(db, workspaceId)
    const full = resolve(path, file)
    if (relative(path, full).startsWith('..')) throw new GitError(`Outside the worktree: ${file}`)
    return existsSync(full) ? asText(readFileSync(full)) : { status: 'ok' as const, text: null, binary: false }
  })
}

// A file at a commit, e.g. the merge base. May fetch its contents from GitHub the first time (blobless clone).
export function readFileAt(db: DatabaseSync, workspaceId: number, commit: string, file: string): Promise<FileText> {
  return withGit(async () => {
    if (!isCommit(commit)) throw new GitError(`Not a commit: ${commit}`)
    return asText(await git(openedWorktree(db, workspaceId), ['show', `${commit}:${file}`]))
  })
}
