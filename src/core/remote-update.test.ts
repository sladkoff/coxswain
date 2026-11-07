import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "./db.ts";
import { catchUp, prepareRemoteUpdate } from "./git.ts";
import { getAutoUpdate, setAutoUpdate } from "./workspaces.ts";

const git = (path: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: path,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();

test("remote updates follow rewritten history, but local work persistently disables them per workspace", async () => {
  const path = mkdtempSync(join(tmpdir(), "coxswain-remote-update-"));
  const db = openDatabase(join(path, "test.db"));
  // Keep SQLite files outside the repository's untracked-file check.
  const repo = join(path, "repo");
  git(path, "init", "-q", repo);
  const commit = (text: string) => {
    writeFileSync(join(repo, "file.txt"), text);
    git(repo, "add", ".");
    git(repo, "commit", "-qm", text);
    return git(repo, "rev-parse", "HEAD");
  };
  try {
    const base = commit("base");
    const old = commit("old remote");
    git(repo, "update-ref", "refs/remotes/origin/topic", old);
    assert.equal(await getAutoUpdate(db, 1), true);
    const expected = await prepareRemoteUpdate(db, 1, repo, "origin/topic");
    git(repo, "checkout", "-q", "--detach", base);
    const rewritten = commit("rewritten remote");
    git(repo, "checkout", "-q", "--detach", old);
    git(repo, "update-ref", "refs/remotes/origin/topic", rewritten);
    assert.equal(await catchUp(db, 1, repo, "origin/topic", expected), null);
    assert.equal(git(repo, "rev-parse", "HEAD"), rewritten);

    // A remote rewind must also be followed.
    const beforeRewind = await prepareRemoteUpdate(db, 1, repo, "origin/topic");
    git(repo, "update-ref", "refs/remotes/origin/topic", base);
    await catchUp(db, 1, repo, "origin/topic", beforeRewind);
    assert.equal(git(repo, "rev-parse", "HEAD"), base);

    const local = commit("local commit");
    const protectedLocal = await prepareRemoteUpdate(db, 1, repo, "origin/topic");
    assert.equal(await getAutoUpdate(db, 1), false);
    assert.equal(await getAutoUpdate(db, 2), true);
    await catchUp(db, 1, repo, "origin/topic", protectedLocal);
    assert.equal(git(repo, "rev-parse", "HEAD"), local);

    git(repo, "reset", "--keep", base);
    assert.equal(
      await getAutoUpdate(db, 1),
      false,
      "cleaning up never silently re-enables updating",
    );
    await setAutoUpdate(db, 1, true);
    writeFileSync(join(repo, "untracked.txt"), "local edit");
    await prepareRemoteUpdate(db, 1, repo, "origin/topic");
    assert.equal(await getAutoUpdate(db, 1), false);
    assert.equal(git(repo, "rev-parse", "HEAD"), base);

    rmSync(join(repo, "untracked.txt"));
    await setAutoUpdate(db, 1, true);
    const beforeFetch = await prepareRemoteUpdate(db, 1, repo, "origin/topic");
    writeFileSync(join(repo, "file.txt"), "edit during fetch");
    git(repo, "update-ref", "refs/remotes/origin/topic", rewritten);
    await catchUp(db, 1, repo, "origin/topic", beforeFetch);
    assert.equal(await getAutoUpdate(db, 1), false);
    assert.equal(git(repo, "diff", "--", "file.txt").includes("edit during fetch"), true);
    git(repo, "checkout", "--", "file.txt");
    git(repo, "update-ref", "refs/remotes/origin/topic", base);
    await setAutoUpdate(db, 1, true);
    const beforeCommit = await prepareRemoteUpdate(db, 1, repo, "origin/topic");
    const duringFetch = commit("commit during fetch");
    git(repo, "update-ref", "refs/remotes/origin/topic", rewritten);
    await catchUp(db, 1, repo, "origin/topic", beforeCommit);
    assert.equal(await getAutoUpdate(db, 1), false);
    assert.equal(git(repo, "rev-parse", "HEAD"), duringFetch);

    // Manual updates bypass only the saved off preference, not protection of local work.
    git(repo, "reset", "--keep", base);
    git(repo, "update-ref", "refs/remotes/origin/topic", base);
    const manual = await prepareRemoteUpdate(db, 1, repo, "origin/topic", true);
    git(repo, "update-ref", "refs/remotes/origin/topic", rewritten);
    assert.equal(await catchUp(db, 1, repo, "origin/topic", manual, true), null);
    assert.equal(git(repo, "rev-parse", "HEAD"), rewritten);
    assert.equal(
      await getAutoUpdate(db, 1),
      false,
      "a one-shot update leaves automatic updates off",
    );

    writeFileSync(join(repo, "file.txt"), "keep this local edit");
    const dirtyManual = await prepareRemoteUpdate(db, 1, repo, "origin/topic", true);
    git(repo, "update-ref", "refs/remotes/origin/topic", base);
    assert.match(
      (await catchUp(db, 1, repo, "origin/topic", dirtyManual, true)) ?? "",
      /local edits/,
    );
    assert.ok(git(repo, "diff").includes("keep this local edit"));
    assert.equal(git(repo, "rev-parse", "HEAD"), rewritten);
    git(repo, "checkout", "--", "file.txt");
    git(repo, "update-ref", "refs/remotes/origin/topic", rewritten);
    const localManual = commit("keep this unpushed commit");
    const unpushedManual = await prepareRemoteUpdate(db, 1, repo, "origin/topic", true);
    git(repo, "update-ref", "refs/remotes/origin/topic", base);
    assert.match(
      (await catchUp(db, 1, repo, "origin/topic", unpushedManual, true)) ?? "",
      /unpushed commits/,
    );
    assert.equal(git(repo, "rev-parse", "HEAD"), localManual);
    assert.equal(await getAutoUpdate(db, 1), false);
  } finally {
    await db.destroy();
    rmSync(path, { recursive: true, force: true });
  }
});
