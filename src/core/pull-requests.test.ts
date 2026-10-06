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
const { hunkRanges, listPostable, oneAtATime, syncConversation, syncThreads, textOf, withHeader } =
  await import("./pull-requests.ts");
const { addEntry, addNote, listEntries } = await import("./entries.ts");
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
    complete: true,
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
      ["Far away", false, null, "conversation"],
      ["Not pushed", false, null, "conversation"],
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

  // A comment thread posted from here, as postReview records it, is the thread on GitHub: replies by others land in
  // it, and an edit there is taken over; a thread of the agent's isn't postable.
  const near = entries.find((e) => e.body === "Near it")!;
  await db
    .updateTable("entries")
    .set({ github_id: "C9", github_thread_id: "T2", github_resolved: 0 })
    .where("id", "=", near.id)
    .execute();
  const nearThread: ReviewThread = {
    ...thread,
    id: "T2",
    startLine: 3,
    endLine: 3,
    comments: [comment("C9", "Near it, edited", "me"), comment("C10", "Fixed", "bo")],
  };
  await syncThreads(db, 1, [nearThread], mergeBase);
  entries = await listed();
  assert.equal(entries.filter((e) => e.githubThreadId === "T2").length, 1, "no second copy");
  assert.equal(entries.find((e) => e.id === near.id)!.body, "Near it, edited");
  assert.deepEqual(
    entries.filter((e) => e.parentId === near.id).map((e) => [e.author, e.body]),
    [["bo", "Fixed"]],
  );
  // A comment posted at once has its GitHub comment before the next read finds its thread: a reply to it is a reply.
  const far = entries.find((e) => e.body === "Far away")!;
  await db.updateTable("entries").set({ github_id: "C20" }).where("id", "=", far.id).execute();
  await addNote(db, { workspaceId: 1, body: "And here", parentId: far.id });
  const farPost = (await listPostable(db, 1, mergeBase, head)).find((p) => p.threadId === far.id)!;
  assert.deepEqual([farPost.github, farPost.placement, farPost.resolve], [true, "reply", null]);
  await syncThreads(
    db,
    1,
    [
      {
        ...thread,
        id: "T3",
        startLine: 18,
        endLine: 18,
        comments: [comment("C20", "Far away", "me")],
      },
    ],
    mergeBase,
  );
  assert.equal((await listed()).find((e) => e.id === far.id)!.githubThreadId, "T3");
  await addEntry(db, "question", {
    workspaceId: 1,
    body: "What does this do?",
    anchor: { ...anchor, startLine: 3, endLine: 3, code: "3" },
  });
  assert.ok(
    (await listPostable(db, 1, mergeBase, head)).every((p) => p.body !== "What does this do?"),
  );

  // A thread posted in the PR's conversation (off the diff) has its comment there: what's added goes there too.
  const conv = await addNote(db, {
    workspaceId: 1,
    body: "Off the diff",
    anchor: { ...anchor, startLine: 18, endLine: 18, code: "18" },
  });
  await db
    .updateTable("entries")
    .set({ github_id: "IC1", github_url: "https://github.com/test/repo/pull/7#issuecomment-1" })
    .where("id", "=", conv.id)
    .execute();
  await addNote(db, { workspaceId: 1, body: "More", parentId: conv.id });
  const convPost = (await listPostable(db, 1, mergeBase, head)).find(
    (p) => p.threadId === conv.id,
  )!;
  assert.deepEqual([convPost.placement, convPost.resolve], ["conversation", null]);
  // An edit on GitHub is taken over, the user's text after coxswain's header; a deletion only from a complete read,
  // and not of a thread holding an unposted note.
  assert.equal(textOf(withHeader("`f.txt`, line 18:", "Hi")), "Hi");
  await syncConversation(
    db,
    1,
    [{ id: "IC1", body: withHeader("about", "Off the diff, edited") }],
    true,
  );
  const body = async () => (await listed()).find((e) => e.id === conv.id)?.body;
  assert.equal(await body(), "Off the diff, edited");
  await syncConversation(db, 1, [], false);
  assert.equal(await body(), "Off the diff, edited", "an incomplete read deletes nothing");
  await syncConversation(db, 1, [], true);
  assert.equal(await body(), undefined, "deleted on GitHub");
  const more = (await listed()).find((e) => e.body === "More")!;
  assert.deepEqual(
    [more.parentId, more.githubId, more.path, more.startLine],
    [null, null, "f.txt", 18],
    "the unposted note stays, a local thread on the same lines",
  );

  // A complete read: the viewer's own comments are theirs (notes, posted), a thread gone from GitHub is gone here,
  // one whose first comment was deleted there is mirrored again from what's left, and one holding an unposted note
  // of the user's stays.
  const mineThread: ReviewThread = {
    ...thread,
    id: "T4",
    startLine: 5,
    endLine: 5,
    comments: [comment("C40", "Mine", "me"), comment("C41", "Theirs", "bo")],
  };
  const seen = { viewer: "me", complete: true };
  await syncThreads(db, 1, [thread, mineThread], mergeBase, seen);
  entries = await listed();
  const mine = entries.find((e) => e.githubThreadId === "T4")!;
  assert.deepEqual(
    [mine.kind, ...entries.filter((e) => e.parentId === mine.id).map((e) => e.kind)],
    ["note", "comment"],
  );
  assert.ok(!entries.some((e) => e.githubThreadId === "T2"), "T2 is gone from GitHub");
  assert.ok(!entries.some((e) => e.id === far.id), "T3 is gone from GitHub");
  const andHere = entries.find((e) => e.body === "And here")!;
  assert.deepEqual(
    [andHere.parentId, andHere.startLine],
    [null, 18],
    "its unposted note stays, a thread",
  );
  await syncThreads(
    db,
    1,
    [thread, { ...mineThread, comments: [comment("C41", "Theirs", "bo")] }],
    mergeBase,
    seen,
  );
  entries = await listed();
  const left = entries.filter((e) => e.githubThreadId === "T4");
  assert.deepEqual(
    left.map((e) => [e.kind, e.author, e.body]),
    [["comment", "bo", "Theirs"]],
  );
});

test("reads and posts of a workspace take turns; a failure doesn't hold up the next", async () => {
  const log: string[] = [];
  const step =
    (name: string, ms: number, fail = false) =>
    () =>
      new Promise<void>((done, failed) =>
        setTimeout(() => (log.push(name), fail ? failed(new Error(name)) : done()), ms),
      );
  const post = oneAtATime(1, step("post", 30, true));
  const read = oneAtATime(1, step("read", 0));
  const other = oneAtATime(2, step("other workspace", 0));
  await assert.rejects(post, /post/);
  await Promise.all([read, other]);
  assert.deepEqual(log, ["other workspace", "post", "read"]);
});
