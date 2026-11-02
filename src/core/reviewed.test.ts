import childProcess from "node:child_process";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";

const temp = mkdtempSync(join(os.tmpdir(), "coxswain-reviewed-"));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { openWorktree, openedWorktree } = await import("./git.ts");
const { listReviewed, setReviewed, listChangedSinceReview } = await import("./reviewed.ts");
const { publishGuide } = await import("./views.ts");
home.mock.restore();
syncBuiltinESMExports();
after(() => rmSync(temp, { recursive: true, force: true }));
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

test("Guide updates retain unchanged reviewed files across base moves, including existing marks", async () => {
  const repo = join(temp, "repo");
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  for (const path of ["a.ts", "b.ts", "other.ts"]) writeFileSync(join(repo, path), "original\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  const db = openDatabase(join(temp, "reviewed.db"));
  try {
    await db
      .insertInto("projects")
      .values({ id: 1, github: null, name: "repo", path: repo, last_opened_at: "" })
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
    const worktree = await openedWorktree(db, 1);
    for (const path of ["a.ts", "b.ts"]) writeFileSync(join(worktree, path), "reviewed change\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "feature");
    const head = git(worktree, "rev-parse", "HEAD");
    const batchReads = mock.method(childProcess, "spawn");
    syncBuiltinESMExports();
    try {
      assert.deepEqual(await listChangedSinceReview(db, 1, base, head), []);
      assert.equal(batchReads.mock.callCount(), 0, "no baselines or marks means no blob reads");
    } finally {
      batchReads.mock.restore();
      syncBuiltinESMExports();
    }
    await publishGuide(db, 1, base, head, [
      "## First\n```diff path=a.ts\n```\n```diff path=b.ts\n```",
    ]);
    await setReviewed(db, 1, base, "a.ts", true, head);
    // An existing mark from the released fingerprint format must also survive the upgrade.
    const legacy = createHash("sha1")
      .update(base)
      .update("\0")
      .update("reviewed change\n")
      .digest("hex");
    await db
      .insertInto("reviewed_files")
      .values({ workspace_id: 1, path: "b.ts", fingerprint: legacy })
      .execute();
    assert.deepEqual((await listReviewed(db, 1, base, head)).sort(), ["a.ts", "b.ts"]);
    // A completed job remembers the old Guide range even after publication replaces its view.
    await db
      .insertInto("jobs")
      .values({
        workspace_id: 1,
        kind: "guide",
        why: "ahead",
        state: "done",
        base,
        head,
        model: "test",
        agent: "codex",
        workspace: "feature",
        ran_on: null,
        items: 1,
        done: 1,
        failed: 0,
        calls: 1,
        updated_at: "",
        reused: 0,
        started_at: "",
        finished_at: "",
        error: null,
      })
      .execute();
    writeFileSync(join(repo, "other.ts"), "unrelated base change\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "unrelated base update");
    const nextBase = git(repo, "rev-parse", "HEAD");
    git(worktree, "merge", "main", "--no-edit");
    const nextHead = git(worktree, "rev-parse", "HEAD");
    await publishGuide(db, 1, nextBase, nextHead, [
      "## Reordered\n```diff path=b.ts\n```\n```diff path=a.ts\n```",
    ]);
    assert.deepEqual(
      (await listReviewed(db, 1, nextBase, nextHead)).sort(),
      ["a.ts", "b.ts"],
      "unrelated base changes and Guide reordering preserve review marks",
    );
    assert.deepEqual(
      await listChangedSinceReview(db, 1, nextBase, nextHead),
      [],
      "unrelated base moves add no changed dots",
    );
    await setReviewed(db, 1, nextBase, "b.ts", false, nextHead);
    assert.deepEqual(
      await listReviewed(db, 1, nextBase, nextHead),
      ["a.ts"],
      "unchecking an existing-format mark stays unchecked",
    );
    await setReviewed(db, 1, nextBase, "b.ts", true, nextHead);
    writeFileSync(join(worktree, "a.ts"), "new unreviewed change\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "edit only a");
    const changedHead = git(worktree, "rev-parse", "HEAD");
    const sections = ["## Updated\n```diff path=a.ts\n```\n```diff path=b.ts\n```"];
    await publishGuide(db, 1, nextBase, changedHead, sections);
    assert.deepEqual(
      await listChangedSinceReview(db, 1, nextBase, changedHead),
      ["a.ts"],
      "only the changed file gets a dot",
    );
    await publishGuide(db, 1, nextBase, changedHead, sections);
    assert.deepEqual(
      await listChangedSinceReview(db, 1, nextBase, changedHead),
      ["a.ts"],
      "further Guide generation does not clear the dot",
    );
    const reopened = openDatabase(join(temp, "reviewed.db"));
    try {
      assert.deepEqual(await listChangedSinceReview(reopened, 1, nextBase, changedHead), ["a.ts"]);
    } finally {
      await reopened.destroy();
    }

    assert.deepEqual(
      await listReviewed(db, 1, nextBase, changedHead),
      ["b.ts"],
      "only the changed file loses its mark",
    );
    assert.deepEqual(
      (await listReviewed(db, 1, base, head)).sort(),
      ["a.ts", "b.ts"],
      "old snapshots retain their reviewed contents",
    );
    await setReviewed(db, 1, nextBase, "a.ts", true, changedHead);
    assert.deepEqual(
      await listChangedSinceReview(db, 1, nextBase, changedHead),
      [],
      "Reviewed clears the dot",
    );
    await setReviewed(db, 1, nextBase, "a.ts", false, changedHead);
    assert.deepEqual(
      await listChangedSinceReview(db, 1, nextBase, changedHead),
      [],
      "manual unreview does not invent a new change",
    );
    writeFileSync(join(worktree, "new.ts"), "new file\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "add a file after the previous Guide");
    const addedHead = git(worktree, "rev-parse", "HEAD");
    await publishGuide(db, 1, nextBase, addedHead, [
      ...sections,
      "## Added\n```diff path=new.ts\n```",
    ]);
    assert.deepEqual(
      await listChangedSinceReview(db, 1, nextBase, addedHead),
      ["new.ts"],
      "new files added after the first Guide also get a dot",
    );
    await setReviewed(db, 1, nextBase, "new.ts", true, addedHead);
    assert.deepEqual(
      await listChangedSinceReview(db, 1, nextBase, addedHead),
      [],
      "review acknowledges an added file",
    );
    await setReviewed(db, 1, nextBase, "b.ts", true, changedHead, "file");
    writeFileSync(join(repo, "b.ts"), "changed old side\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "change b on base");
    const changedBase = git(repo, "rev-parse", "HEAD");
    assert.deepEqual(
      await listReviewed(db, 1, changedBase, changedHead),
      [],
      "changing a file's old side invalidates its diff review too",
    );
    assert.deepEqual(
      await listReviewed(db, 1, changedBase, changedHead, "file"),
      ["b.ts"],
      "whole-file review remains independent of the diff base",
    );
    writeFileSync(join(worktree, "same-size.ts"), "first\n");
    await setReviewed(db, 1, base, "same-size.ts", true);
    assert.ok((await listReviewed(db, 1, base)).includes("same-size.ts"));
    writeFileSync(join(worktree, "same-size.ts"), "other\n");
    assert.ok(
      !(await listReviewed(db, 1, base)).includes("same-size.ts"),
      "live edits are never hidden by immutable digest caches",
    );
  } finally {
    await db.destroy();
  }
});
