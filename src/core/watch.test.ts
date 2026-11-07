import childProcess from "node:child_process";
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
const { getAutoUpdate, setAutoUpdate } = await import("./workspaces.ts");
const { openWorktree, worktreePath } = await import("./git.ts");
const { onEvent } = await import("./events.ts");
const { checkGitHub, changeAutoUpdate, updateFromRemote, watchLimits, watchWorkspace } =
  await import("./watch.ts");
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

test("the watcher tells when HEAD moves, not when files change, and checks GitHub on a push", async (t) => {
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
    .values({ id: 1, github: "test/repo", name: "repo", last_opened_at: "" })
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
  const off = onEvent((e) => "workspaceId" in e && changes.push(`${e.workspaceId} ${e.what}`));
  t.after(() => (off(), watchWorkspace(db, null)));
  watchWorkspace(db, 1);
  await checkGitHub(db, 1); // joins the check watching starts
  const until = async (want: string) => {
    for (let i = 0; i < 100 && !changes.includes(want); i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(changes.includes(want), `saw ${want} (${changes.join(", ")})`);
  };
  await new Promise((r) => setTimeout(r, 60)); // the first look only sets what's there
  assert.ok(!changes.includes("1 github"), "the first check has nothing to compare with");
  writeFileSync(join(worktree, "a.ts"), "export const a = 2;\n");
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!changes.includes("1 worktree"), "an uncommitted edit isn't a move");
  git(worktree, "commit", "-qam", "local");
  await until("1 worktree");
  assert.ok(!changes.includes("1 github"), "a commit isn't a push");
  // A push moves the branch's origin/ ref; the next look checks GitHub, which finds the new head.
  git(worktree, "update-ref", "refs/remotes/origin/feature", "HEAD");
  await until("1 github");
});

test("enabling waits for an off-mode check, then fetches freshly; manual updates keep the preference off", async (t) => {
  const directory = join(temp, "explicit-updates");
  mkdirSync(directory);
  const origin = join(directory, "origin.git");
  git(directory, "init", "--bare", "-q", "-b", "main", origin);
  const seed = join(directory, "seed");
  git(directory, "init", "-q", "-b", "main", seed);
  writeFileSync(join(seed, "a.txt"), "base");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "base");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "checkout", "-qb", "feature");
  git(seed, "push", "-q", "origin", "main", "feature");
  const repo = join(directory, "repo");
  git(directory, "clone", "-q", origin, repo);
  const db = openDatabase(join(directory, "test.db"));
  t.after(() => db.destroy());
  await db
    .insertInto("projects")
    .values({ id: 99, path: repo, name: "repo", github: null, last_opened_at: "" })
    .execute();
  await db
    .insertInto("workspaces")
    .values({
      id: 99,
      project_id: 99,
      pr_number: null,
      branch: "feature",
      base_branch: "main",
      last_opened_at: "",
    })
    .execute();
  await openWorktree(db, 99);
  const path = worktreePath({ path: repo, github: null }, { branch: "feature", prNumber: null });
  await setAutoUpdate(db, 99, false);
  const advance = (text: string) => {
    writeFileSync(join(seed, "a.txt"), text);
    git(seed, "commit", "-qam", text);
    git(seed, "push", "-q", "origin", "feature");
    return git(seed, "rev-parse", "HEAD");
  };
  const remote = advance("new remote");
  const original = childProcess.execFile;
  let release: () => void = () => {};
  let reached!: () => void;
  const fetching = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let intercepted = false;
  const gate = mock.method(childProcess, "execFile", (...args: unknown[]) => {
    if (args[0] === "git" && Array.isArray(args[1]) && args[1][0] === "fetch" && !intercepted) {
      intercepted = true;
      const callback = args.at(-1) as (...values: unknown[]) => void;
      args[args.length - 1] = (...values: unknown[]) => {
        release = () => callback(...values);
        reached();
      };
    }
    return Reflect.apply(original, childProcess, args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    release();
    gate.mock.restore();
    syncBuiltinESMExports();
  });
  const oldCheck = checkGitHub(db, 99);
  await fetching; // This check has already prepared while automatic updates were off.
  const enabling = changeAutoUpdate(db, 99, true);
  assert.equal(await getAutoUpdate(db, 99), true);
  release();
  await oldCheck;
  await enabling;
  assert.equal(
    git(path, "rev-parse", "HEAD"),
    remote,
    "re-enabling must not merely reuse the old off-mode check",
  );
  gate.mock.restore();
  syncBuiltinESMExports();

  await setAutoUpdate(db, 99, false);
  const manual = advance("one-shot remote");
  await updateFromRemote(db, 99);
  assert.equal(git(path, "rev-parse", "HEAD"), manual);
  assert.equal(await getAutoUpdate(db, 99), false);
  writeFileSync(join(path, "local.txt"), "untracked work");
  advance("another remote");
  await assert.rejects(updateFromRemote(db, 99), /local edits/);
  assert.equal(git(path, "rev-parse", "HEAD"), manual);
  assert.equal(await getAutoUpdate(db, 99), false);
  rmSync(join(path, "local.txt"));
  git(seed, "push", "-q", "origin", "--delete", "feature");
  await assert.rejects(updateFromRemote(db, 99), /Could not check/);
  assert.equal(
    git(path, "rev-parse", "HEAD"),
    manual,
    "a failed branch fetch must not update from a stale cached remote ref",
  );
  assert.equal(await getAutoUpdate(db, 99), false);
});
