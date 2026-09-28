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
const { openWorktree, readSyncState, statusEntries } = await import("./git.ts");
const { onWorkspaceChange, watchLimits, watchWorkspace } = await import("./watch.ts");
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

test("status entries count a rename once", () => {
  assert.equal(statusEntries(""), 0);
  assert.equal(statusEntries(" M a.ts\0?? b.ts\0"), 2);
  assert.equal(statusEntries("R  new.ts\0old.ts\0 M c.ts\0"), 2);
});

test("the watcher tells commits from uncommitted changes, and the sync state counts them", async (t) => {
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
  const synced = await readSyncState(db, 1);
  assert.equal(synced.status, "ok");
  if (synced.status !== "ok") return;
  assert.deepEqual([synced.behind, synced.ahead, synced.dirty], [0, 0, 0]);
  assert.ok(synced.checkedAt, "GitHub's check is timed");

  const changes: string[] = [];
  const off = onWorkspaceChange((id, change) => changes.push(`${id}:${change}`));
  t.after(() => (off(), watchWorkspace(db, null)));
  watchWorkspace(db, 1);
  const until = async (want: string) => {
    for (let i = 0; i < 100 && !changes.includes(want); i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(changes.includes(want), `saw ${want} (${changes.join(", ")})`);
  };
  await new Promise((r) => setTimeout(r, 60)); // the first check only sets what's there
  writeFileSync(join(worktree, "a.ts"), "export const a = 2;\n");
  await until("1:status");
  git(worktree, "commit", "-qam", "local");
  await until("1:head");
  writeFileSync(join(worktree, "b.ts"), "new\n");
  const s = await readSyncState(db, 1);
  assert.equal(s.status, "ok");
  if (s.status !== "ok") return;
  assert.equal(s.ahead, 1, "the branch isn't pushed, so the commit is ahead");
  assert.equal(s.dirty, 1);
});
