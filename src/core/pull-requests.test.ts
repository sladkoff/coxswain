import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";
import type { ReviewThread } from "./github.ts";

// The real git and core code, on a disposable coxswain directory.
const temp = mkdtempSync(join(os.tmpdir(), "coxswain-pr-"));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { hunkRanges, listPostable, syncThreads } = await import("./pull-requests.ts");
const { addNote, listEntries } = await import("./entries.ts");
const { checkRunState, statusState } = await import("./github.ts");
home.mock.restore();
syncBuiltinESMExports();
after(() => rmSync(temp, { recursive: true, force: true }));

test("hunkRanges: the lines each side of a file diff's hunks cover", () => {
  const diff = "diff --git a/f b/f\n@@ -1,3 +1,4 @@\n a\n+b\n@@ -10 +11,0 @@\n-x\n";
  assert.deepEqual(hunkRanges(diff), {
    old: [
      [1, 3],
      [10, 10],
    ],
    new: [[1, 4]],
  });
});

test("check states: running until completed, then by conclusion", () => {
  assert.equal(checkRunState("IN_PROGRESS", null), "pending");
  assert.equal(checkRunState("COMPLETED", "TIMED_OUT"), "failure");
  assert.equal(checkRunState("COMPLETED", "SKIPPED"), "neutral");
  assert.equal(statusState("ERROR"), "failure");
});

test("review threads mirror into entries, and what's new here is postable", async (t) => {
  const worktree = join(temp, "coxswain/worktrees/test/repo/pr-7");
  mkdirSync(worktree, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: worktree,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    }).trim();
  const lines = Array.from({ length: 20 }, (_, i) => `${i + 1}`);
  const write = (ls: string[]) => writeFileSync(join(worktree, "f.txt"), ls.join("\n") + "\n");
  git("init", "-q", "-b", "feature");
  write(lines);
  git("add", ".");
  git("commit", "-qm", "base");
  const mergeBase = git("rev-parse", "HEAD");
  write(lines.with(1, "two"));
  git("commit", "-qam", "two");
  const head = git("rev-parse", "HEAD");
  const db = openDatabase(join(temp, "test.db"));
  t.after(() => db.destroy());
  await db
    .insertInto("projects")
    .values({ id: 1, github: "test/repo", name: "repo", last_opened_at: "" })
    .execute();
  await db
    .insertInto("workspaces")
    .values({ id: 1, project_id: 1, pr_number: 7, last_opened_at: "" })
    .execute();

  const comment = (id: string, body: string, author = "ana") => ({
    id,
    author,
    body,
    createdAt: "2026-10-01T00:00:00Z",
    url: `https://github.com/test/repo/pull/7#${id}`,
  });
  const thread: ReviewThread = {
    id: "T1",
    resolved: false,
    path: "f.txt",
    side: "new",
    startLine: 2,
    endLine: 2,
    commit: head,
    comments: [comment("C1", "Why two?"), comment("C2", "Spelled out?")],
  };
  assert.equal(await syncThreads(db, 1, [thread], mergeBase), true);
  assert.equal(await syncThreads(db, 1, [thread], mergeBase), false, "nothing new the second time");
  const listed = () => listEntries(db, 1, mergeBase, mergeBase, head);
  let entries = await listed();
  const root = entries.find((e) => e.githubThreadId === "T1")!;
  assert.deepEqual(
    [root.kind, root.author, root.code, root.state, root.shown],
    ["comment", "ana", "two", "current", true],
  );
  assert.deepEqual(
    entries.filter((e) => e.parentId === root.id).map((e) => e.body),
    ["Spelled out?"],
  );

  // A reply here, and a resolve here: postable. A new thread on lines in the diff, and one outside it (a file comment).
  await addNote(db, { workspaceId: 1, body: "Yes, on purpose", parentId: root.id });
  await db.updateTable("entries").set({ resolved_at: "now" }).where("id", "=", root.id).execute();
  const anchor = { path: "f.txt", side: "new" as const, base: mergeBase, head };
  await addNote(db, {
    workspaceId: 1,
    body: "Near it",
    anchor: { ...anchor, startLine: 3, endLine: 3, code: "3" },
  });
  await addNote(db, {
    workspaceId: 1,
    body: "Far away",
    anchor: { ...anchor, startLine: 18, endLine: 18, code: "18" },
  });
  // Lines only in the worktree: not on GitHub yet.
  write(lines.with(1, "two").with(9, "ten"));
  await addNote(db, {
    workspaceId: 1,
    body: "Not pushed",
    anchor: { ...anchor, startLine: 10, endLine: 10, code: "ten", head: null },
  });
  const postable = await listPostable(db, 1, mergeBase, head);
  assert.deepEqual(
    postable.map((p) => [p.body, p.github, p.resolve, p.placement]),
    [
      ["Why two?", true, true, "reply"],
      ["Near it", false, null, "lines"],
      ["Far away", false, null, "body"],
      ["Not pushed", false, null, "body"],
    ],
  );

  // GitHub edits a reply, deletes another and reopens the thread: taken over; the local reply stays.
  await syncThreads(
    db,
    1,
    [{ ...thread, resolved: true, comments: [comment("C1", "Why two, really?")] }],
    mergeBase,
  );
  await syncThreads(
    db,
    1,
    [{ ...thread, resolved: false, comments: [comment("C1", "Why two, really?")] }],
    mergeBase,
  );
  entries = await listed();
  const after = entries.find((e) => e.id === root.id)!;
  assert.equal(after.body, "Why two, really?");
  assert.equal(after.resolvedAt, null, "reopened on GitHub");
  assert.deepEqual(
    entries.filter((e) => e.parentId === root.id).map((e) => e.body),
    ["Yes, on purpose"],
  );
});
