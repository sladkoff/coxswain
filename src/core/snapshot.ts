import { execFile } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ADR 0028: a snapshot is the worktree as a commit, uncommitted and untracked files included, so a view or an agent
// turn can be pinned to it; HEAD itself when nothing is uncommitted. Made with a copy of the worktree's index, which
// stays as it was, and with a fixed author and date, so the same files on the same HEAD make the same commit. Kept
// from git gc under refs/coxswain/snapshots/. Only node: imports, so node --test runs it.
// ponytail: those refs are never pruned; drop the ones no view or turn uses if they pile up.
const fixed = {
  GIT_AUTHOR_NAME: "coxswain",
  GIT_AUTHOR_EMAIL: "coxswain@localhost",
  GIT_AUTHOR_DATE: "@0 +0000",
  GIT_COMMITTER_NAME: "coxswain",
  GIT_COMMITTER_EMAIL: "coxswain@localhost",
  GIT_COMMITTER_DATE: "@0 +0000",
};
let indexes = 0;

const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  new Promise<string>((done, fail) =>
    execFile(
      "git",
      args,
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } },
      (e, stdout, stderr) =>
        e ? fail(new Error(stderr.trim() || e.message)) : done(stdout.trim()),
    ),
  );

export async function snapshotOf(path: string): Promise<string> {
  const [head, status] = await Promise.all([
    git(path, ["rev-parse", "HEAD"]),
    git(path, ["status", "--porcelain"]),
  ]);
  if (!status) return head;
  const own = resolve(path, await git(path, ["rev-parse", "--git-path", "index"]));
  const index = join(tmpdir(), `coxswain-index-${process.pid}-${++indexes}`);
  try {
    // A copy of the index knows which files are unchanged, so only the changed ones are read.
    if (existsSync(own)) copyFileSync(own, index);
    const env = { GIT_INDEX_FILE: index };
    await git(path, ["add", "--all"], env);
    const tree = await git(path, ["write-tree"], env);
    if (tree === (await git(path, ["rev-parse", "HEAD^{tree}"]))) return head;
    const sha = await git(
      path,
      ["commit-tree", "--no-gpg-sign", tree, "-p", head, "-m", "coxswain snapshot"],
      fixed,
    );
    await git(path, ["update-ref", `refs/coxswain/snapshots/${sha}`, sha]);
    return sha;
  } finally {
    rmSync(index, { force: true });
  }
}
