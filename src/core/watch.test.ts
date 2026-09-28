import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";

// A disposable coxswain directory, as in views.test.ts.
const temp = mkdtempSync(join(os.tmpdir(), "coxswain-watch-"));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { openWorktree } = await import("./git.ts");
const { onHeadMoved, watchLimits, watchWorkspace } = await import("./watch.ts");
home.mock.restore();
syncBuiltinESMExports();
const originalPath = process.env.PATH;
const bin = join(temp, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
process.env.PATH = `${bin}:${originalPath}`;
after(() => {
  process.env.PATH = originalPath;
  rmSync(temp, { recursive: true, force: true });
});
watchLimits.everyMs = 20;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();

test("the watcher tells when HEAD moves, not when files change", async (t) => {
  const repo = join(temp, "coxswain/repos/test/repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "initial");
  git(repo, "remote", "add", "origin", repo);
  const db = openDatabase(join(temp, "test.db"));
  t.after(() => db.destroy());
  await db
    .insertInto("projects")
    .values({ id: 1, owner: "test", name: "repo", last_opened_at: "" })
    .execute();
  await db
    .insertInto("workspaces")
    .values({
      id: 1,
      project_id: 1,
      pr_number: null,
      branch: "feature",
      base_branch: "main",
      last_opened_at: "",
    })
    .execute();
  assert.equal((await openWorktree(db, 1)).status, "ok");
  const worktree = join(temp, "coxswain/worktrees/test/repo/branch-feature");
  const changes: string[] = [];
  const off = onHeadMoved((id) => changes.push(`${id}`));
  t.after(() => (off(), watchWorkspace(db, null)));
  watchWorkspace(db, 1);
  const until = async (want: string) => {
    for (let i = 0; i < 100 && !changes.includes(want); i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(changes.includes(want), `saw ${want} (${changes.join(", ")})`);
  };
  await new Promise((r) => setTimeout(r, 60)); // the first check only sets what's there
  writeFileSync(join(worktree, "a.ts"), "export const a = 2;\n");
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(changes, [], "an uncommitted edit isn't a move");
  git(worktree, "commit", "-qam", "local");
  await until("1");
});
