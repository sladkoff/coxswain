import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { Db } from "./db";
import {
  createPullRequest,
  type CreatedPullRequest,
  findPullRequest,
  getPullRequestHead,
  type GitHubProblem,
} from "./github.ts";
import { getProject } from "./projects.ts";
import { snapshotOf } from "./snapshot.ts";
import { getWorkspaceRepo, setWorkspacePullRequest } from "./workspaces.ts";

// ADR 0008: coxswain's own blobless clone per project, and one worktree per workspace on the PR's head branch, or on
// the workspace's own branch (ADR 0028).
export type GitProblem = { status: "git-error"; message: string };

export type ChangedFile = {
  path: string;
  previousPath: string | null; // set for renames
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
};

export type ChangedFileList = { status: "ok"; files: ChangedFile[] } | GitProblem;
export type FileTreeResult = { status: "ok"; paths: string[] } | GitProblem;
// A commit of the PR, or a local one on top. parent: its first parent, the old side of its commit diff. An agent turn
// is shown like one (turn: when it ran): its snapshots after and before (ADR 0028), subject its first message.
export type Commit = { sha: string; parent: string; subject: string; turn?: string };
// text is null when the file doesn't exist on that side or is binary.
export type FileText = { status: "ok"; text: string | null; binary: boolean } | GitProblem;
export type CloneResult = { status: "ok" } | GitProblem | GitHubProblem;
// head: what's on GitHub (ADR 0028), the PR's head or the branch's; the merge base while a branch isn't pushed. Local
// changes are what the worktree has on top of it. prNumber: the workspace's PR, which a branch workspace gets once one
// is opened for its branch. notice: something the user should know, e.g. the PR moved on but local changes kept the
// worktree back.
export type WorktreeResult =
  | {
      status: "ok";
      head: string;
      mergeBase: string;
      prNumber: number | null;
      notice: string | null;
    }
  | GitProblem
  | GitHubProblem;

const root = join(homedir(), "coxswain");
const repoPath = (owner: string, name: string) => join(root, "repos", owner, name);
// ADR 0005: worktrees go in ~/coxswain/worktrees/<owner>/<name>/pr-<number>/, or branch-<branch>/ for a workspace
// started on a branch, kept once it has a PR (agents' sessions are tied to the folder). Named by the PR or branch, not
// the workspace's row ID, so a database made afresh finds the same folder and never another's.
// ponytail: a branch's slashes become "+", so a/b and a+b share a folder; the second then moves the first's away.
export const worktreePath = (
  owner: string,
  name: string,
  w: { prNumber: number | null; branch: string | null },
) =>
  join(
    root,
    "worktrees",
    owner,
    name,
    w.branch ? `branch-${w.branch.replaceAll("/", "+")}` : `pr-${w.prNumber}`,
  );

class GitError extends Error {}

// ADR 0008 decision 7: git never prompts; missing credentials fail instead of hanging.
function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<Buffer> {
  return new Promise((done, fail) =>
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "buffer",
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
      },
      (e, stdout, stderr) =>
        e ? fail(new GitError(stderr.toString().trim() || e.message)) : done(stdout),
    ),
  );
}
const gitText = async (cwd: string, args: string[], env?: Record<string, string>) =>
  (await git(cwd, args, env)).toString();
const hasRef = (cwd: string, ref: string) =>
  git(cwd, ["rev-parse", "--verify", "--quiet", ref]).then(
    () => true,
    () => false,
  );

async function withGit<T>(fn: () => Promise<T>): Promise<T | GitProblem> {
  try {
    return await fn();
  } catch (e) {
    return { status: "git-error", message: (e as Error).message };
  }
}

const clones = new Map<string, Promise<CloneResult>>();

// Clones the project if it isn't yet; safe to call again while a clone runs.
export async function cloneProject(db: Db, projectId: number): Promise<CloneResult> {
  const { owner, name } = await getProject(db, projectId);
  return clone(owner, name);
}

function clone(owner: string, name: string): Promise<CloneResult> {
  const path = repoPath(owner, name);
  if (existsSync(join(path, ".git"))) return Promise.resolve({ status: "ok" });
  const key = `${owner}/${name}`;
  let cloning = clones.get(key);
  if (!cloning) {
    cloning = withGit(async () => {
      // ADR 0006: clone with the protocol the user chose for gh; HTTPS relies on gh's credential helper.
      const ssh = (await ghProtocol()) === "ssh";
      const url = ssh ? `git@github.com:${key}.git` : `https://github.com/${key}.git`;
      // Clone next to the final place and rename, so an interrupted clone never looks finished.
      const tmp = `${path}.cloning`;
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(dirname(path), { recursive: true });
      await git(dirname(path), ["clone", "--filter=blob:none", "--no-checkout", url, tmp]);
      renameSync(tmp, path);
      return { status: "ok" as const };
    }).finally(() => clones.delete(key));
    clones.set(key, cloning);
  }
  return cloning;
}

function ghProtocol(): Promise<string> {
  return new Promise((done) =>
    execFile("gh", ["config", "get", "git_protocol"], (e, out) => done(e ? "" : out.trim())),
  );
}

// The last result of opening each workspace's worktree, so switching back needs no network.
// ponytail: memory only, so the first open after a restart waits for GitHub and fetch (~2.5 s); persist if that hurts.
const lastOpened = new Map<number, { head: string; mergeBase: string; prNumber: number | null }>();

// What openWorktree last said, if the worktree is still there; null when it has to be opened properly.
export async function openedBefore(db: Db, workspaceId: number): Promise<WorktreeResult | null> {
  const last = lastOpened.get(workspaceId);
  const w = await getWorkspaceRepo(db, workspaceId);
  if (!last || !existsSync(join(worktreePath(w.owner, w.name, w), ".git"))) return null;
  return { status: "ok", ...last, notice: null };
}

// Makes sure the workspace's worktree exists and is on its latest head on GitHub, then says what its diff is against.
// Talks to GitHub and fetches, so it takes a second or more; show openedBefore meanwhile.
export async function openWorktree(db: Db, workspaceId: number): Promise<WorktreeResult> {
  const w = await getWorkspaceRepo(db, workspaceId);
  const { owner, name } = w;
  const cloned = clone(owner, name);
  let prNumber = w.prNumber;
  // ADR 0028: a branch workspace gets its PR once one is opened for the branch, here or on GitHub. Offline, or the PR
  // already has a workspace of its own: it carries on as a branch.
  if (prNumber === null && w.branch) {
    const found = await findPullRequest(owner, name, w.branch);
    if (found.status === "ok" && found.number !== null)
      prNumber = await setWorkspacePullRequest(db, workspaceId, found.number).then(
        () => found.number,
        () => null,
      );
  }
  if (prNumber === null) {
    const c = await cloned;
    return c.status === "ok" ? openBranch(workspaceId, w) : c;
  }
  const [pr, c] = await Promise.all([getPullRequestHead(owner, name, prNumber), cloned]);
  if (pr.status !== "ok") return pr;
  if (c.status !== "ok") return c;
  // ponytail: fork PRs need a remote for the fork (ADR 0008); read-only via pull/<n>/head would be the cheap first step.
  if (pr.fromFork) return { status: "git-error", message: "PRs from forks are not supported yet" };

  return withGit(async () => {
    const repo = repoPath(owner, name);
    const path = worktreePath(owner, name, w);
    const branch = pr.headRef;
    const upstream = `origin/${branch}`;
    await git(repo, ["fetch", "origin", `+refs/heads/${branch}:refs/remotes/${upstream}`]);
    await addWorktree(repo, path, branch, upstream, true);
    const notice = await catchUp(path, upstream, "The PR has new commits");
    lastOpened.set(workspaceId, { head: pr.head, mergeBase: pr.mergeBase, prNumber });
    return { status: "ok" as const, head: pr.head, mergeBase: pr.mergeBase, prNumber, notice };
  });
}

// A branch workspace without a PR (ADR 0028): its worktree on its branch, made from the base branch unless it's on
// GitHub already. Its diff is against where it forked from the base branch, like a PR's; what's pushed is on GitHub.
// Offline, it carries on with what was fetched before.
function openBranch(
  workspaceId: number,
  w: { owner: string; name: string; branch: string | null; baseBranch: string | null },
): Promise<WorktreeResult> {
  return withGit(async () => {
    const repo = repoPath(w.owner, w.name);
    const path = worktreePath(w.owner, w.name, { prNumber: null, branch: w.branch });
    const [branch, base] = [w.branch!, w.baseBranch!];
    const fetch = (b: string) =>
      git(repo, ["fetch", "origin", `+refs/heads/${b}:refs/remotes/origin/${b}`]).then(
        () => true,
        () => false,
      );
    // Fetching a branch that was never pushed fails too, so only the base branch's failure says we're offline.
    const [fetched] = await Promise.all([fetch(base), fetch(branch)]);
    const pushed = await hasRef(repo, `refs/remotes/origin/${branch}`);
    await addWorktree(repo, path, branch, `origin/${pushed ? branch : base}`, pushed);
    const behind = pushed
      ? await catchUp(path, `origin/${branch}`, "The branch has new commits")
      : null;
    const mergeBase = (await gitText(path, ["merge-base", `origin/${base}`, "HEAD"])).trim();
    const head = pushed
      ? (await gitText(repo, ["rev-parse", `origin/${branch}`])).trim()
      : mergeBase;
    lastOpened.set(workspaceId, { head, mergeBase, prNumber: null });
    const notice = fetched
      ? behind
      : "Could not fetch from GitHub; showing what was fetched before";
    return { status: "ok" as const, head, mergeBase, prNumber: null, notice };
  });
}

// Makes sure the worktree at path has branch checked out. Without a worktree there: a worktree elsewhere may hold the
// branch already, e.g. one named by an older coxswain or a database made since, so it's moved here, local changes and
// all (registrations whose folder is gone are dropped first); else one is added, the branch made from start if it
// doesn't exist yet, tracking start if track.
// ponytail: fails when the branch is the default branch, which the clone itself has checked out; make the clone bare
// (with an explicit fetch refspec) if such PRs show up.
async function addWorktree(
  repo: string,
  path: string,
  branch: string,
  start: string,
  track: boolean,
) {
  if (existsSync(join(path, ".git"))) return;
  if (existsSync(path) && readdirSync(path).length)
    throw new GitError(
      `${path} exists and isn't a worktree; move it away and reopen the workspace`,
    );
  await git(repo, ["worktree", "prune"]);
  const holder = (await gitText(repo, ["worktree", "list", "--porcelain"]))
    .split("\n\n")
    .find((w) => w.split("\n").includes(`branch refs/heads/${branch}`))
    ?.match(/^worktree (.+)$/m)?.[1];
  if (holder && holder !== repo) await git(repo, ["worktree", "move", holder, path]);
  if (existsSync(join(path, ".git"))) return;
  const hasBranch = await hasRef(repo, `refs/heads/${branch}`);
  await git(
    repo,
    hasBranch
      ? ["worktree", "add", path, branch]
      : ["worktree", "add", track ? "--track" : "--no-track", "-b", branch, path, start],
  );
}

// Fast-forwards the worktree to upstream when it's behind and has no local changes. Otherwise, if it's behind, says so
// (moved: what happened on GitHub).
async function catchUp(path: string, upstream: string, moved: string): Promise<string | null> {
  const [head, remote, dirty] = await Promise.all([
    gitText(path, ["rev-parse", "HEAD"]),
    gitText(path, ["rev-parse", upstream]),
    gitText(path, ["status", "--porcelain"]),
  ]);
  if (head.trim() === remote.trim()) return null;
  const behind = await git(path, ["merge-base", "--is-ancestor", "HEAD", upstream]).then(
    () => true,
    () => false,
  );
  if (behind && !dirty) await git(path, ["merge", "--ff-only", upstream]);
  return behind && dirty ? `${moved}; not updated because of local changes` : null;
}

export async function openedWorktree(db: Db, workspaceId: number): Promise<string> {
  const w = await getWorkspaceRepo(db, workspaceId);
  const path = worktreePath(w.owner, w.name, w);
  if (!existsSync(join(path, ".git"))) throw new GitError("The worktree is not ready yet");
  return path;
}

// The project's branches on GitHub (as last fetched), to start a branch workspace from, and its default branch.
// ponytail: as of the clone and the fetches since; fetch them all first if a new branch is missed.
export type BranchList =
  | { status: "ok"; branches: string[]; defaultBranch: string }
  | GitProblem
  | GitHubProblem;
export async function listBranches(db: Db, projectId: number): Promise<BranchList> {
  const { owner, name } = await getProject(db, projectId);
  const cloned = await clone(owner, name);
  if (cloned.status !== "ok") return cloned;
  return withGit(async () => {
    const repo = repoPath(owner, name);
    const [refs, head] = await Promise.all([
      gitText(repo, ["for-each-ref", "--format=%(refname:lstrip=3)", "refs/remotes/origin"]),
      gitText(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => ""),
    ]);
    const branches = refs.split("\n").filter((b) => b && b !== "HEAD");
    const defaultBranch = head.trim().replace(/^origin\//, "") || branches[0] || "main";
    return { status: "ok" as const, branches, defaultBranch };
  });
}

// A commit named by a (possibly short) hash, HEAD, a branch or tag, or one of those with ~ or ^, as its full hash;
// throws if the worktree has no such commit. Names that git could read as an option or a range are refused.
export async function resolveCommit(db: Db, workspaceId: number, rev: string): Promise<string> {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./~^-]*$/.test(rev) || rev.includes(".."))
    throw new GitError(`Not a commit: ${rev}`);
  const path = await openedWorktree(db, workspaceId);
  return (
    await gitText(path, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]).catch(() => {
      throw new GitError(`${rev} isn't a commit in the worktree`);
    })
  ).trim();
}

// The worktree as a commit, uncommitted changes included (snapshot.ts).
export function snapshot(
  db: Db,
  workspaceId: number,
): Promise<{ status: "ok"; sha: string } | GitProblem> {
  return withGit(async () => ({
    status: "ok" as const,
    sha: await snapshotOf(await openedWorktree(db, workspaceId)),
  }));
}

// Pushes the worktree's branch to GitHub and makes it its upstream. Never forced: if the branch moved on there, it fails
// with git's message.
export function push(db: Db, workspaceId: number): Promise<{ status: "ok" } | GitProblem> {
  return withGit(async () => {
    const path = await openedWorktree(db, workspaceId);
    const branch = (await gitText(path, ["symbolic-ref", "--short", "HEAD"])).trim();
    await git(path, ["push", "--set-upstream", "origin", branch]);
    return { status: "ok" as const };
  });
}

// A branch workspace's PR (ADR 0028): pushes the branch and opens a draft PR into its base branch, titled by its one
// commit or else by the branch, with the commits listed. The workspace is the PR's from then on.
export async function openPullRequest(
  db: Db,
  workspaceId: number,
): Promise<CreatedPullRequest | GitProblem> {
  const w = await getWorkspaceRepo(db, workspaceId);
  if (w.prNumber !== null || !w.branch || !w.baseBranch)
    return { status: "git-error", message: "The workspace has a PR already" };
  const pushed = await push(db, workspaceId);
  if (pushed.status !== "ok") return pushed;
  const log = await withGit(async () =>
    (
      await gitText(await openedWorktree(db, workspaceId), [
        "log",
        "-z",
        "--format=%s",
        `origin/${w.baseBranch}..HEAD`,
      ])
    )
      .split("\0")
      .filter(Boolean),
  );
  if (!Array.isArray(log)) return log;
  const pr = await createPullRequest(w.owner, w.name, {
    head: w.branch,
    base: w.baseBranch,
    title: log.length === 1 ? log[0] : w.branch,
    body: log.length > 1 ? log.map((s) => `- ${s}`).join("\n") : "",
  });
  if (pr.status === "ok") await setWorkspacePullRequest(db, workspaceId, pr.number);
  return pr;
}

const isCommit = (s: string) => /^[0-9a-f]{40}$/.test(s);

// Everything that differs between the merge base and the worktree: the PR's commits, and local commits,
// uncommitted and untracked files. With head, only what differs between the two commits (a commit diff).
export function listChangedFiles(
  db: Db,
  workspaceId: number,
  mergeBase: string,
  head?: string,
): Promise<ChangedFileList> {
  return withGit(async () => {
    if (!isCommit(mergeBase)) throw new GitError(`Not a commit: ${mergeBase}`);
    if (head !== undefined && !isCommit(head)) throw new GitError(`Not a commit: ${head}`);
    const path = await openedWorktree(db, workspaceId);
    const range = head ? [mergeBase, head] : [mergeBase];
    const [names, counts, untracked] = await Promise.all([
      gitText(path, ["diff", "-M", "-z", "--name-status", ...range]),
      gitText(path, ["diff", "-M", "-z", "--numstat", ...range]),
      head ? "" : gitText(path, ["ls-files", "-z", "--others", "--exclude-standard"]),
    ]);
    return {
      status: "ok" as const,
      files: parseChanges(names, counts, untracked, (p) => countLines(join(path, p))),
    };
  });
}

// The commits from the merge base to the worktree's HEAD, or to head, newest first.
export function listCommits(
  db: Db,
  workspaceId: number,
  mergeBase: string,
  head?: string,
): Promise<{ status: "ok"; commits: Commit[] } | GitProblem> {
  return withGit(async () => {
    if (!isCommit(mergeBase)) throw new GitError(`Not a commit: ${mergeBase}`);
    if (head !== undefined && !isCommit(head)) throw new GitError(`Not a commit: ${head}`);
    const out = await gitText(await openedWorktree(db, workspaceId), [
      "log",
      "-z",
      "--format=%H%x1f%P%x1f%s",
      `${mergeBase}..${head ?? "HEAD"}`,
    ]);
    const commits = out
      .split("\0")
      .filter(Boolean)
      .map((l) => {
        const [sha, parents, subject] = l.split("\x1f");
        return { sha, parent: parents.split(" ")[0], subject };
      });
    return { status: "ok" as const, commits };
  });
}

// Joins `git diff -z --name-status` and `--numstat` output by path, and adds untracked files as added.
function parseChanges(
  names: string,
  counts: string,
  untracked: string,
  linesOf: (path: string) => number,
): ChangedFile[] {
  const lines = new Map<string, [number, number]>();
  const c = counts.split("\0");
  for (let i = 0; i < c.length - 1;) {
    const [add, del, path] = c[i].split("\t");
    // Renames have an empty path, then the old and new paths as their own fields. Binary files count "-".
    const key = path === "" ? c[i + 2] : path;
    i += path === "" ? 3 : 1;
    lines.set(key, [Number(add) || 0, Number(del) || 0]);
  }
  const files: ChangedFile[] = [];
  const n = names.split("\0");
  for (let i = 0; i < n.length - 1;) {
    const code = n[i][0];
    const renamed = code === "R" || code === "C";
    const previousPath = renamed ? n[i + 1] : null;
    const path = renamed ? n[i + 2] : n[i + 1];
    i += renamed ? 3 : 2;
    const status = renamed
      ? "renamed"
      : code === "A"
        ? "added"
        : code === "D"
          ? "deleted"
          : "modified";
    const [additions, deletions] = lines.get(path) ?? [0, 0];
    files.push({
      path,
      previousPath: code === "C" ? null : previousPath,
      status,
      additions,
      deletions,
    });
  }
  for (const path of untracked.split("\0").filter(Boolean))
    files.push({
      path,
      previousPath: null,
      status: "added",
      additions: linesOf(path),
      deletions: 0,
    });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function countLines(file: string): number {
  try {
    const bytes = readFileSync(file);
    if (bytes.includes(0)) return 0;
    const text = bytes.toString("utf8");
    return text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
  } catch {
    return 0;
  }
}

// Every file in the worktree: tracked ones plus new files that aren't ignored.
export function listWorktreeFiles(db: Db, workspaceId: number): Promise<FileTreeResult> {
  return withGit(async () => {
    const path = await openedWorktree(db, workspaceId);
    const out = await gitText(path, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--deduplicate",
    ]);
    // A file deleted in the worktree is still in the index until the deletion is staged.
    const paths = out.split("\0").filter((p) => p && existsSync(join(path, p)));
    return { status: "ok" as const, paths };
  });
}

// The worktree's HEAD commit: its committed changes, without the uncommitted ones.
export async function headCommit(db: Db, workspaceId: number): Promise<string> {
  return (await gitText(await openedWorktree(db, workspaceId), ["rev-parse", "HEAD"])).trim();
}

// One changed file's diff between two commits, as `git diff` prints it; a rename names both paths so it's found.
export async function readFileDiff(
  db: Db,
  workspaceId: number,
  base: string,
  head: string,
  file: Pick<ChangedFile, "path" | "previousPath">,
): Promise<string> {
  if (!isCommit(base)) throw new GitError(`Not a commit: ${base}`);
  if (!isCommit(head)) throw new GitError(`Not a commit: ${head}`);
  const paths = file.previousPath ? [file.previousPath, file.path] : [file.path];
  return gitText(await openedWorktree(db, workspaceId), ["diff", "-M", base, head, "--", ...paths]);
}

// Blob paths at a pinned revision, including unchanged files; excludes directories and submodule commits.
export async function listFilesAt(db: Db, workspaceId: number, commit: string): Promise<string[]> {
  if (!isCommit(commit)) throw new GitError(`Not a commit: ${commit}`);
  const out = await gitText(await openedWorktree(db, workspaceId), ["ls-tree", "-r", "-z", commit]);
  return out.split("\0").flatMap((entry) => {
    const tab = entry.indexOf("\t");
    return tab >= 0 && entry.slice(0, tab).split(" ")[1] === "blob" ? [entry.slice(tab + 1)] : [];
  });
}

const asText = (bytes: Buffer): FileText =>
  bytes.includes(0)
    ? { status: "ok", text: null, binary: true }
    : { status: "ok", text: bytes.toString("utf8"), binary: false };

// A file as it is in the worktree now.
export function readWorktreeFile(db: Db, workspaceId: number, file: string): Promise<FileText> {
  return withGit(async () => {
    const path = await openedWorktree(db, workspaceId);
    const full = resolve(path, file);
    if (relative(path, full).startsWith("..")) throw new GitError(`Outside the worktree: ${file}`);
    return existsSync(full)
      ? asText(readFileSync(full))
      : { status: "ok" as const, text: null, binary: false };
  });
}

// Identifies file diffs by their contents: the old side (base) and the new side's bytes, from the worktree, or at
// head for a pinned range (ADR 0014). Changes when either does, e.g. after an agent's edit or new commits on the PR;
// a file diff with no local changes gets the same fingerprint either way. Whole files ignore base and use a
// separate namespace, so their marks never apply to a diff (ADR 0014).
export async function diffFingerprints(
  db: Db,
  workspaceId: number,
  base: string,
  files: string[],
  head?: string,
  kind: "diff" | "file" = "diff",
): Promise<Map<string, string>> {
  const path = await openedWorktree(db, workspaceId);
  const contents = head
    ? await readBlobs(path, head, files)
    : new Map(files.map((f) => [f, worktreeBytes(path, f)]));
  const hash = (f: string) => {
    const bytes = contents.get(f);
    return (
      (kind === "file" ? "file:" : "") +
      createHash("sha1")
        .update(kind === "file" ? "file" : base)
        .update("\0")
        .update(bytes ?? "deleted")
        .digest("hex")
    );
  };
  return new Map(files.map((f) => [f, hash(f)]));
}

// Files as text in a view of the diff: at a commit, or in the worktree without one; null where the file isn't there.
export async function readTexts(
  db: Db,
  workspaceId: number,
  files: string[],
  commit?: string,
): Promise<Map<string, string | null>> {
  const path = await openedWorktree(db, workspaceId);
  const bytes = commit
    ? await readBlobs(path, commit, files)
    : new Map(files.map((f) => [f, worktreeBytes(path, f)]));
  return new Map(files.map((f) => [f, bytes.get(f)?.toString("utf8") ?? null]));
}

function worktreeBytes(path: string, file: string): Buffer | null {
  const full = resolve(path, file);
  if (relative(path, full).startsWith("..")) throw new Error(`Outside the worktree: ${file}`);
  return existsSync(full) ? readFileSync(full) : null;
}

// Files' contents at a commit, in one `git cat-file --batch`; null where the file isn't there.
function readBlobs(
  cwd: string,
  commit: string,
  files: string[],
): Promise<Map<string, Buffer | null>> {
  if (!isCommit(commit)) throw new GitError(`Not a commit: ${commit}`);
  return new Promise((done, fail) => {
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", fail);
    child.on("close", (code) => {
      if (code) return fail(new GitError(`git cat-file exited with ${code}`));
      const out = Buffer.concat(chunks);
      const blobs = new Map<string, Buffer | null>();
      let at = 0;
      for (const f of files) {
        const eol = out.indexOf(10, at);
        const header = out.subarray(at, eol).toString();
        at = eol + 1;
        // "<oid> <type> <size>", then the contents and a newline; or "<name> missing".
        const size = header.endsWith(" missing") ? -1 : Number(header.split(" ")[2]);
        if (size < 0) blobs.set(f, null);
        else {
          blobs.set(f, out.subarray(at, at + size));
          at += size + 1;
        }
      }
      done(blobs);
    });
    child.stdin.end(files.map((f) => `${commit}:${f}\n`).join(""));
  });
}

// A file at a commit, e.g. the merge base. May fetch its contents from GitHub the first time (blobless clone).
export function readFileAt(
  db: Db,
  workspaceId: number,
  commit: string,
  file: string,
): Promise<FileText> {
  return withGit(async () => {
    if (!isCommit(commit)) throw new GitError(`Not a commit: ${commit}`);
    return asText(await git(await openedWorktree(db, workspaceId), ["show", `${commit}:${file}`]));
  });
}

// A line of a worktree file, e.g. where a name clicked in the canvas is defined or used.
export type CodeLine = { path: string; line: number; text: string };
export type CodeLineList = { status: "ok"; lines: CodeLine[] } | GitProblem;

// What reads as a definition of a name, in most languages: a keyword before it, a Go method, or a class method.
const definitionOf = (name: string) => {
  const n = name.replaceAll("$", "\\$");
  return new RegExp(
    [
      String.raw`\b(?:function\*?|class|interface|type|enum|struct|trait|def|fn|func|namespace|module|protocol|object|record|const|let|var|val)\s+${n}\b`,
      String.raw`\bfunc\s+\([^)]*\)\s+${n}\b`,
      String.raw`^\s*(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*${n}\s*(?:<[^>]*>)?\(.*\)\s*(?::[^=]*)?\{\s*$`,
    ].join("|"),
  );
};
const importLine = /^\s*(?:import|from)\b|\bfrom\s+["']/;
const importPath = /^["'`]?(\.{1,2}\/[^"'`]*)["'`]?$/;
const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts", ".json", ".css"];

// Go to Definition for a token clicked in `from` (a worktree path): a relative import path opens its file; a name is
// looked up with `git grep` in the worktree. Only the worktree: the clone is blobless, so grepping a commit fetches
// every blob. ponytail: matches by name and a regex per language, so every definition of the name is found, not
// the one in scope; a language server in the core (ADR 0003) if that gets noisy.
export function findDefinitions(
  db: Db,
  workspaceId: number,
  from: string,
  token: string,
): Promise<CodeLineList> {
  return withGit(async () => {
    const path = await openedWorktree(db, workspaceId);
    const spec = token.match(importPath)?.[1];
    if (spec) {
      const base = join(dirname(from), spec);
      const found = [base, base.replace(/\.js$/, ".ts"), ...extensions.map((x) => base + x)]
        .concat(extensions.map((x) => join(base, "index" + x)))
        .find((p) => !relative(path, resolve(path, p)).startsWith("..") && isFile(join(path, p)));
      return { status: "ok" as const, lines: found ? [{ path: found, line: 1, text: "" }] : [] };
    }
    const definition = definitionOf(token);
    const lines = (await grepWord(path, token)).filter(
      (l) => definition.test(l.text) && !importLine.test(l.text),
    );
    return { status: "ok" as const, lines };
  });
}

// Find Usages: every line of the worktree with the name as a whole word, its definitions and imports included.
export function findUsages(db: Db, workspaceId: number, token: string): Promise<CodeLineList> {
  return withGit(async () => ({
    status: "ok" as const,
    lines: await grepWord(await openedWorktree(db, workspaceId), token),
  }));
}

// The worktree's lines with a name as a whole word; none for a token that isn't a name.
async function grepWord(path: string, token: string): Promise<CodeLine[]> {
  if (!/^[A-Za-z_$][\w$]*$/.test(token)) return [];
  const args = ["grep", "-n", "-z", "-I", "-w", "--untracked", "-F", "-e", token];
  // Exit code 1 is no match.
  const out = await gitText(path, args).catch(() => "");
  return out
    .split("\n")
    .map((l) => l.split("\0"))
    .filter(([, , text]) => text)
    .map(([p, line, text]) => ({ path: p, line: Number(line), text: text.trim() }));
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
