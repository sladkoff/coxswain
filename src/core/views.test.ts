import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";

// Give the real git/core code a disposable coxswain directory, without touching the user's repositories or sign-in.
const temp = mkdtempSync(join(os.tmpdir(), "coxswain-views-"));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { listFilesAt, readFileAt, snapshot } = await import("./git.ts");
const { parseSection, viewTools, listViews, setDiagramCheck } = await import("./views.ts");
const { listReviewed, setReviewed } = await import("./reviewed.ts");
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

test("sections mix prose, source files, diffs and diagrams", () => {
  const section = parseSection(
    '## Trace\nExplanation\n```file path="a b.ts" generated\n```\n```diff path=changed.ts\n```\n```mermaid\nflowchart TD\n A --> B\n```',
  );
  assert.equal(section.title, "Trace");
  assert.deepEqual(section.parts.slice(0, 3), [
    { kind: "prose", text: "Explanation" },
    { kind: "file", path: "a b.ts", generated: true },
    { kind: "diff", path: "changed.ts", generated: false },
  ]);
  assert.equal(section.parts[3].kind, "prose");
  assert.equal(parseSection("## Code\n```file\nordinary code\n```").parts[0].kind, "prose");
});

test("views without diffs pin files, validate embeds and keep file review separate", async (t) => {
  const repo = join(temp, "coxswain/repos/test/repo");
  mkdirSync(repo, { recursive: true });
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
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
  mkdirSync(join(repo, "directory"));
  writeFileSync(join(repo, "directory/a b.ts"), "hello\n");
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
  const tools = viewTools(db, 1);
  const call = (name: string, args: object) =>
    tools.find((tool) => tool.name === name)!.call(args as never);
  const start = await call("start_view", { title: "Trace", guide: false });
  assert.match(start, /none\. You can still explain existing code/);
  const [view] = await listViews(db, 1);
  assert.equal(view.base, view.head);
  const worktree = join(temp, "coxswain/worktrees/test/repo/branch-feature");
  await call("write_section", { view: view.id, markdown: "## Overview\nNo diff needed." });
  await call("write_section", {
    view: view.id,
    markdown: '## Source\n```file path=a.ts\n```\n```file path="directory/a b.ts"\n```',
  });
  for (const path of ["missing.ts", "directory", "../a.ts", "/a.ts"]) {
    await assert.rejects(
      call("write_section", { markdown: `## Invalid\n\`\`\`file path=${path}\n\`\`\`` }),
      /isn't a file/,
    );
  }
  await assert.rejects(
    call("write_section", { markdown: "## Duplicate\n```file path=a.ts\n```" }),
    /already embedded/,
  );
  await assert.rejects(
    call("write_section", { markdown: "## No diff\n```diff path=b.ts\n```" }),
    /isn't changed/,
  );
  setDiagramCheck(async () => ["broken"]);
  await assert.rejects(
    call("write_section", { markdown: "## Diagram\n```mermaid\nbad\n```" }),
    /doesn't draw/,
  );
  setDiagramCheck(async (codes) => codes.map(() => null));
  assert.equal((await listViews(db, 1))[0].sections.length, 2, "rejected sections are not saved");
  await call("add_explanation", {
    path: "a.ts",
    side: "new",
    start_line: 1,
    end_line: 1,
    body: "A constant",
  });
  await assert.rejects(
    call("add_explanation", {
      path: "a.ts",
      side: "old",
      start_line: 1,
      end_line: 1,
      body: "Wrong side",
    }),
    /isn't a file/,
  );
  await assert.rejects(
    call("add_explanation", {
      path: "a.ts",
      side: "new",
      start_line: 99,
      end_line: 99,
      body: "Wrong line",
    }),
    /has 2 lines/,
  );
  assert.equal(
    (await db.selectFrom("entries").select("code").executeTakeFirstOrThrow()).code,
    "export const a = 1;",
  );

  await setReviewed(db, 1, view.base, "a.ts", true, view.head, "file");
  assert.deepEqual(await listReviewed(db, 1, view.base, view.head, "file"), ["a.ts"]);
  assert.deepEqual(await listReviewed(db, 1, view.base, view.head), []);
  await setReviewed(db, 1, view.base, "a.ts", true, view.head);
  await setReviewed(db, 1, view.base, "a.ts", false, view.head, "file");
  assert.deepEqual(
    await listReviewed(db, 1, view.base, view.head),
    ["a.ts"],
    "unmarking a file does not unmark its diff",
  );
  await setReviewed(db, 1, view.base, "a.ts", true, view.head, "file");
  writeFileSync(join(worktree, "b.ts"), "export const b = 3;\n");
  const next = await snapshot(db, 1);
  assert.equal(next.status, "ok");
  if (next.status !== "ok") return;
  assert.deepEqual(
    await listReviewed(db, 1, next.sha, next.sha, "file"),
    ["a.ts"],
    "a new base and other edits do not invalidate a whole-file review",
  );
  writeFileSync(join(worktree, "a.ts"), "export const a = 4;\n");
  assert.deepEqual(await listReviewed(db, 1, view.base, undefined, "file"), []);
  assert.deepEqual(
    await listReviewed(db, 1, view.base, view.head, "file"),
    ["a.ts"],
    "the old view keeps its reviewed contents",
  );
  assert.deepEqual(await readFileAt(db, 1, view.head, "a.ts"), {
    status: "ok",
    text: "export const a = 1;\n",
    binary: false,
  });
  assert.deepEqual(await listFilesAt(db, 1, view.head), ["a.ts", "b.ts", "directory/a b.ts"]);

  await call("start_view", { title: "Mixed", guide: false });
  await call("write_section", {
    markdown: "## Mixed\n```diff path=b.ts\n```\n```file path=a.ts\n```",
  });
  await assert.rejects(
    call("write_section", { markdown: "## Duplicate kind\n```diff path=a.ts\n```" }),
    /already embedded/,
  );
  await call("start_view", { title: "Guide", guide: true });
  await assert.rejects(
    call("write_section", { markdown: "## Changed\n```file path=a.ts\n```" }),
    /embed its diff in a guide/,
  );
  // A view of one commit: its own range, not stale when the worktree moves on.
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: worktree,
    encoding: "utf8",
  }).trim();
  await call("start_view", {
    title: "Commit",
    guide: false,
    base: commit.slice(0, 8),
    head: commit,
  });
  const [ofCommit] = await listViews(db, 1);
  assert.deepEqual([ofCommit.base, ofCommit.head, ofCommit.worktree], [commit, commit, false]);
  await assert.rejects(
    call("start_view", { title: "Nope", guide: false, head: "abcdef1234" }),
    /isn't a commit/,
  );
  await call("start_view", { title: "Named", guide: false, base: "HEAD~0", head: "HEAD" });
  assert.equal((await listViews(db, 1))[0].head, commit, "names resolve to their commit");
  for (const rev of ["--output=x", "HEAD..main", "a b"])
    await assert.rejects(
      call("start_view", { title: "Bad", guide: false, head: rev }),
      /Not a commit/,
    );
  await call("start_view", { title: "Guide", guide: true });
  const coverage = await call("write_section", {
    markdown: "## Changes\n```diff path=a.ts\n```\n```diff path=b.ts\n```",
  });
  assert.match(coverage, /Every changed file is in a section/);
});
