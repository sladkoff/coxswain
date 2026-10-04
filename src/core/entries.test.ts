import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";

// The real git and core code, on a disposable coxswain directory.
const temp = mkdtempSync(join(os.tmpdir(), "coxswain-review-"));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { addNote, listEntries } = await import("./entries.ts");
home.mock.restore();
syncBuiltinESMExports();
after(() => rmSync(temp, { recursive: true, force: true }));

test("an entry follows its lines from its revision: moved, shown per range, outdated once they change", async (t) => {
  const worktree = join(temp, "coxswain/worktrees/test/repo/branch-feature");
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
  const write = (text: string) => writeFileSync(join(worktree, "f.txt"), text);
  git("init", "-q", "-b", "feature");
  write("1\n2\n3\n4\n5\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const mergeBase = git("rev-parse", "HEAD");
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

  // A note on the live diff, over an uncommitted change: pinned to a snapshot, kept from gc.
  write("1\n2\nthree\n4\n5\n");
  const anchor = { path: "f.txt", startLine: 2, endLine: 3, base: mergeBase };
  const note = await addNote(db, {
    workspaceId: 1,
    body: "Why three?",
    anchor: { ...anchor, side: "new", code: "2\nthree", head: null },
  });
  assert.notEqual(note.revision, mergeBase);
  assert.match(git("show-ref", `refs/coxswain/revisions/${note.revision}`), /revisions/);
  const removed = await addNote(db, {
    workspaceId: 1,
    body: "Keep 3",
    anchor: { ...anchor, side: "old", startLine: 3, endLine: 3, code: "3", head: null },
  });
  assert.equal(removed.revision, mergeBase);
  // Written on the live diff before revisions: nothing to follow from.
  await db
    .insertInto("entries")
    .values({
      workspace_id: 1,
      kind: "note",
      body: "Legacy",
      parent_id: null,
      view_id: null,
      path: "f.txt",
      side: "new",
      start_line: 1,
      end_line: 1,
      code: "1",
      base: mergeBase,
      head: null,
      revision: null,
      created_at: "",
    })
    .execute();
  const listed = async (base = mergeBase, head?: string) => {
    const entries = await listEntries(db, 1, mergeBase, base, head);
    return entries.map((e) => [e.body, e.state, e.shown, e.startLine, e.now]);
  };

  assert.deepEqual(await listed(), [
    ["Why three?", "current", true, 2, null],
    ["Keep 3", "current", true, 3, null],
    ["Legacy", "outdated", false, 1, null],
  ]);
  // Lines added above move it; an edit next to it leaves it current.
  write("0\n1\n2\nthree\nfour\n5\n");
  assert.deepEqual((await listed())[0], ["Why three?", "current", true, 3, null]);
  // In a range without its lines, e.g. a commit diff at the merge base: current still, but not shown there.
  assert.deepEqual((await listed(mergeBase, mergeBase))[0], [
    "Why three?",
    "current",
    false,
    2,
    null,
  ]);
  // Its own lines changed: outdated everywhere, with what stands there now.
  write("0\n1\n2\nTHREE\nfour\n5\n");
  assert.deepEqual((await listed())[0], ["Why three?", "outdated", false, 2, "2\nTHREE\nfour"]);

  // ADR 0036: a note on a view's prose, current while its section is as it was, outdated once it's rewritten.
  const sections = (...md: string[]) => JSON.stringify(md);
  await db
    .insertInto("views")
    .values({
      id: 1,
      workspace_id: 1,
      base: mergeBase,
      head: mergeBase,
      title: "Data flow",
      guide: 0,
      sections: sections("## One\n\nThe cache is filled lazily.", "## Two\n\nThen it's read."),
      created_at: "",
    })
    .execute();
  const prose = { viewId: 1, section: 0, quote: "filled lazily", at: 13 };
  await addNote(db, { workspaceId: 1, body: "When exactly?", anchor: prose });
  await assert.rejects(
    addNote(db, { workspaceId: 1, body: "?", anchor: { ...prose, section: 5 } }),
    /No section 5/,
  );
  const onProse = async () =>
    (await listEntries(db, 1, mergeBase, mergeBase)).find((e) => e.body === "When exactly?")!;
  const written = await onProse();
  assert.deepEqual(
    [
      written.path,
      written.viewId,
      written.section,
      written.code,
      written.quoteAt,
      written.state,
      written.shown,
    ],
    [null, 1, 0, "filled lazily", 13, "current", true],
  );
  // Another section rewritten leaves it current; its own, outdated.
  const rewrite = (md: string) =>
    db.updateTable("views").set({ sections: md }).where("id", "=", 1).execute();
  await rewrite(sections("## One\n\nThe cache is filled lazily.", "## Two\n\nRead later."));
  assert.equal((await onProse()).state, "current");
  await rewrite(sections("## One\n\nThe cache is filled at start.", "## Two\n\nRead later."));
  assert.deepEqual([(await onProse()).state, (await onProse()).shown], ["outdated", false]);
});
