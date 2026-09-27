// node --test src/core/workspaces.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrations, openDatabase } from "./db.ts";
import { snapshotOf } from "./snapshot.ts";
import {
  branchNameProblem,
  listWorkspaces,
  openBranchWorkspace,
  openPullRequestWorkspace,
} from "./workspaces.ts";

const temp = () => mkdtempSync(join(tmpdir(), "coxswain-test-"));

test("rebuilding workspaces keeps their children, and branch workspaces become the PR's", async () => {
  const path = join(temp(), "coxswain.db");
  // A database as the migrations before ADR 0028 left it, with a PR workspace and an entry on it.
  const old = new DatabaseSync(path);
  for (const m of migrations.slice(0, 3)) old.exec(m);
  old.exec(`insert into projects values (1, 'o', 'r', '');
    insert into workspaces values (1, 1, 7, '');
    insert into entries (workspace_id, kind, body, created_at) values (1, 'note', 'kept', '');
    pragma user_version = 3`);
  old.close();

  const db = openDatabase(path);
  const entries = await db.selectFrom("entries").select("body").execute();
  assert.deepEqual(
    entries.map((e) => e.body),
    ["kept"],
  );
  const branch = await openBranchWorkspace(db, 1, "feature/x", "main");
  assert.equal(branch.prNumber, null);
  // Opening the PR of its branch makes the branch workspace the PR's, rather than a second one.
  const pr = await openPullRequestWorkspace(db, 1, 8, "feature/x");
  assert.equal(pr.id, branch.id);
  assert.deepEqual(
    (await listWorkspaces(db, 1)).map((w) => [w.prNumber, w.branch]),
    [
      [7, null],
      [8, "feature/x"],
    ],
  );
  // Foreign keys are on again: removing the workspace takes its entries.
  await db.deleteFrom("workspaces").where("id", "=", 1).execute();
  assert.equal((await db.selectFrom("entries").select("id").execute()).length, 0);
});

test("branch names git won't take are refused", () => {
  for (const ok of ["feature/x", "fix-1", "a.b"]) assert.equal(branchNameProblem(ok), null);
  for (const bad of ["", "-f", "a..b", "a b", "a/", "x.lock", "a//b", "a:b", "@", "/a", "a@{1"])
    assert.notEqual(branchNameProblem(bad), null, bad);
});

test("a snapshot is HEAD when clean, else a stable commit with the uncommitted files", async () => {
  const dir = temp();
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    }).trim();
  git("init", "-q");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "first");
  const head = git("rev-parse", "HEAD");
  assert.equal(await snapshotOf(dir), head);

  writeFileSync(join(dir, "a.txt"), "two\n");
  writeFileSync(join(dir, "new.txt"), "new\n");
  const status = git("status", "--porcelain");
  const sha = await snapshotOf(dir);
  assert.notEqual(sha, head);
  assert.equal(git("show", `${sha}:a.txt`), "two");
  assert.equal(git("show", `${sha}:new.txt`), "new");
  assert.equal(git("rev-parse", `${sha}^`), head);
  assert.equal(await snapshotOf(dir), sha, "the same files make the same snapshot");
  assert.equal(git("status", "--porcelain"), status, "the worktree's own index is untouched");
  assert.equal(git("rev-parse", `refs/coxswain/snapshots/${sha}`), sha);
});
