import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";

// ADR 0005: COXSWAIN_HOME moves coxswain's folder, here to one named through a symlink as macOS's /tmp is. Git lists
// worktrees by their real path, so coxswain has to take the folder by its real path to know its worktrees as its own.
const temp = realpathSync(mkdtempSync(join(os.tmpdir(), "coxswain-home-")));
mkdirSync(join(temp, "real"));
symlinkSync(join(temp, "real"), join(temp, "link"));
process.env.COXSWAIN_HOME = join(temp, "link/second");
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { addLocalRepository, openWorktree } = await import("./git.ts");
const { openBranchWorkspace } = await import("./workspaces.ts");
home.mock.restore();
syncBuiltinESMExports();
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
});
after(() => rmSync(temp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

test("COXSWAIN_HOME holds coxswain's worktrees, still known as its own through a symlink", async (t) => {
  const db = openDatabase(join(temp, "second.db"));
  t.after(() => db.destroy());
  const repo = join(temp, "code/app");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "initial");
  const project = await addLocalRepository(db, repo);

  const w = await openBranchWorkspace(db, project.id, "feature", "main");
  assert.equal((await openWorktree(db, w.id)).status, "ok");
  const ours = git(repo, "worktree", "list", "--porcelain").match(
    /worktree (.+branch-feature)/,
  )![1];
  assert.ok(ours.startsWith(join(temp, "real/second/worktrees/local/app-")), ours);
  assert.ok(!existsSync(join(temp, "coxswain")), "nothing in ~/coxswain");

  // Its folder gone, its registration is dropped as coxswain's own and the worktree made again.
  rmSync(ours, { recursive: true, force: true });
  assert.equal((await openWorktree(db, w.id)).status, "ok");
  assert.ok(existsSync(join(ours, ".git")));
  await assert.rejects(addLocalRepository(db, ours), /coxswain's own/);
});
