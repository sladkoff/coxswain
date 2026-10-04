import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";

// ADR 0040, in a disposable home as in watch.test.ts: local repositories and new projects, with no GitHub at all.
const temp = realpathSync(mkdtempSync(join(os.tmpdir(), "coxswain-local-")));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { addLocalRepository, createRepository, listBranches, openWorktree } =
  await import("./git.ts");
const { openBranchWorkspace } = await import("./workspaces.ts");
home.mock.restore();
syncBuiltinESMExports();
const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};
Object.assign(process.env, identity);
after(() => rmSync(temp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

test("a local repository is used in place, its worktrees outside it, without GitHub", async (t) => {
  const db = openDatabase(join(temp, "local.db"));
  t.after(() => db.destroy());
  const repo = join(temp, "code/app");
  mkdirSync(join(repo, "src"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  await assert.rejects(addLocalRepository(db, repo), /no commits yet/);
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "initial");
  await assert.rejects(addLocalRepository(db, temp), /isn't in a git repository/);

  // A folder inside it adds the repository's top level.
  const project = await addLocalRepository(db, join(repo, "src"));
  assert.deepEqual(
    [project.path, project.name, project.github, project.where],
    [repo, "app", null, "~/code"],
  );
  assert.equal((await addLocalRepository(db, repo)).id, project.id);

  const branches = await listBranches(db, project.id);
  assert.deepEqual(branches, { status: "ok", branches: ["main"], defaultBranch: "main" });
  // A commit on the user's main that was never pushed is where a branch starts.
  writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "local only");
  const main = git(repo, "rev-parse", "HEAD");

  const w = await openBranchWorkspace(db, project.id, "feature", "main");
  const opened = await openWorktree(db, w.id);
  assert.equal(opened.status, "ok");
  if (opened.status !== "ok") return;
  assert.deepEqual(
    [opened.mergeBase, opened.head, opened.remote, opened.prNumber],
    [main, main, false, null],
  );
  const worktrees = git(repo, "worktree", "list", "--porcelain");
  assert.match(
    worktrees,
    new RegExp(`worktree ${temp}/coxswain/worktrees/local/app-[0-9a-f]{8}/branch-feature`),
  );
  // The user's checkout is left as it was.
  assert.equal(git(repo, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(git(repo, "status", "--porcelain"), "");
  assert.ok(!existsSync(join(temp, "coxswain/repos")));

  // An origin on github.com makes it a GitHub project.
  git(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
  assert.equal((await addLocalRepository(db, repo)).github, "acme/app");
});

test("a new project is a new folder with an empty first commit", async (t) => {
  const db = openDatabase(join(temp, "new.db"));
  t.after(() => db.destroy());
  const path = join(temp, "projects/fresh");
  const project = await createRepository(db, path);
  assert.deepEqual([project.path, project.github], [path, null]);
  assert.equal(git(path, "log", "--format=%s"), "Initial commit");
  assert.equal(git(path, "ls-tree", "HEAD"), "");
  await assert.rejects(
    createRepository(db, join(temp, "code/app")),
    /already exists and isn't empty/,
  );
});

test("the user's own worktrees are never moved or pruned", async (t) => {
  const db = openDatabase(join(temp, "own.db"));
  t.after(() => db.destroy());
  const repo = join(temp, "code/mine");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "initial");
  const theirs = join(temp, "code/mine-theirs");
  git(repo, "worktree", "add", "-q", "-b", "theirs", theirs);
  writeFileSync(join(theirs, "work.ts"), "uncommitted\n");
  // One on a drive that isn't mounted now: registered, its folder gone.
  const away = join(temp, "code/mine-away");
  git(repo, "worktree", "add", "-q", "-b", "away", away);
  rmSync(away, { recursive: true, force: true });
  const project = await addLocalRepository(db, repo);

  // A branch checked out in the user's worktree isn't taken from it.
  const onTheirs = await openBranchWorkspace(db, project.id, "theirs", "main");
  const refused = await openWorktree(db, onTheirs.id);
  assert.equal(refused.status, "git-error");
  if (refused.status === "git-error") assert.match(refused.message, /checked out at .*mine-theirs/);
  assert.ok(existsSync(join(theirs, "work.ts")));

  // Opening a workspace drops only coxswain's own stale registrations.
  const w = await openBranchWorkspace(db, project.id, "feature", "main");
  const opened = await openWorktree(db, w.id);
  assert.equal(opened.status, "ok");
  const ours = git(repo, "worktree", "list", "--porcelain").match(
    /worktree (.+branch-feature)/,
  )![1];
  rmSync(ours, { recursive: true, force: true });
  assert.equal((await openWorktree(db, w.id)).status, "ok");
  const listed = git(repo, "worktree", "list", "--porcelain");
  assert.ok(listed.includes(`worktree ${away}`), "the user's missing worktree is still registered");
  assert.equal(listed.split(`worktree ${ours}`).length, 2, "ours is registered once, made again");
  assert.ok(existsSync(join(ours, ".git")));
});
