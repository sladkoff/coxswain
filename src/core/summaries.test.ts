import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { openDatabase } from "./db.ts";
import type { SummaryJob, SummaryRun } from "./summaries.ts";

// A disposable coxswain directory, as in views.test.ts; the summary agent is a fake.
const temp = mkdtempSync(join(os.tmpdir(), "coxswain-summaries-"));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { openWorktree } = await import("./git.ts");
const summaries = await import("./summaries.ts");
const { viewTools, listViews } = await import("./views.ts");
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
summaries.limits.retryMs = 1;

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

// Resolves with the job once it's no longer running.
const finished = (job: SummaryJob | null) =>
  new Promise<SummaryJob>((resolve) => {
    assert.ok(job, "a job started");
    const check = (jobs: SummaryJob[]) => {
      const j = jobs.find((x) => x.id === job.id);
      if (!j || j.state === "running") return;
      off();
      resolve(j);
    };
    const off = summaries.onSummaryJobs(check);
    check(summaries.listSummaryJobs());
  });

// Answers every file of a run, as the prompt numbers them.
const answerAll = (r: SummaryRun, except = "") => {
  const files = [...r.prompt.matchAll(/^### (\d+)\. \S+ \S+ \S+ (\S+)$/gm)].filter(
    (m) => m[2] !== except,
  );
  return {
    text: `Sure: ${JSON.stringify({ files: files.map((m) => ({ file: Number(m[1]), summary: `Changes ${m[2]}` })) })}`,
    model: "Haiku",
  };
};

test("summary jobs summarise what's missing, retry, and feed the view tools", async (t) => {
  const repo = join(temp, "coxswain/repos/test/repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "b.ts"), "export const b = 1;\n");
  writeFileSync(join(repo, "c.ts"), "export const c = 1;\n");
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
  writeFileSync(join(worktree, "a.ts"), "export const a = 2;\n");
  writeFileSync(join(worktree, "b.ts"), "export const b = 2;\n");
  writeFileSync(join(worktree, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  rmSync(join(worktree, "c.ts"));
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "change");

  // The first run fails, the retry leaves b.ts out, and b.ts is then asked for on its own.
  const runs: SummaryRun[] = [];
  summaries.setSummaryRunner(async (r) => {
    runs.push(r);
    if (runs.length === 1) throw new Error("overloaded");
    return answerAll(r, runs.length === 2 ? "b.ts" : "");
  });
  const job = await finished(await summaries.summariseAhead(db, 1));
  assert.equal(job.state, "done");
  assert.equal(job.files, 4);
  assert.equal(job.done, 4);
  assert.equal(job.failed, 0);
  assert.equal(job.calls, 3, "a failed run, a retry, and one for the file left out");
  assert.equal(job.ranOn, "Haiku");
  assert.equal(job.error, "overloaded", "the last error stays visible");
  assert.ok(
    runs.every((r) => !/pnpm-lock|c\.ts/.test(r.prompt)),
    "lockfiles and deleted files aren't sent to the model",
  );
  assert.equal(runs[0].model, "haiku");
  const rows = await db
    .selectFrom("file_summaries")
    .select(["path", "summary", "model"])
    .orderBy("path")
    .execute();
  assert.deepEqual(
    rows.map((r) => [r.path, r.model]),
    [
      ["a.ts", "Haiku"],
      ["b.ts", "Haiku"],
      ["c.ts", "coxswain"],
      ["pnpm-lock.yaml", "coxswain"],
    ],
  );
  assert.equal(await summaries.summariseAhead(db, 1), null, "nothing left to summarise");

  // Only the file diff that changed is summarised again; the view tools list the summaries.
  writeFileSync(join(worktree, "a.ts"), "export const a = 3;\n");
  runs.length = 0;
  summaries.setSummaryRunner(async (r) => {
    runs.push(r);
    return answerAll(r);
  });
  const tools = viewTools(db, 1);
  const call = (name: string, args: object) =>
    tools.find((tool) => tool.name === name)!.call(args as never);
  const started = await call("start_view", { title: "Guide", guide: true });
  assert.match(started, /b\.ts: Changes b\.ts/);
  assert.match(started, /c\.ts: Deleted/);
  const got = await call("file_summaries", { paths: ["a.ts"], wait: 5 });
  assert.match(got, /^a\.ts: Changes a\.ts$/m);
  assert.equal(runs.length, 1);
  assert.doesNotMatch(runs[0].prompt, /b\.ts/, "a file diff that didn't change keeps its summary");
  await assert.rejects(call("file_summaries", { paths: ["nope.ts"] }), /Not changed/);

  // Sections written at once all land.
  await Promise.all(
    ["a.ts", "b.ts", "c.ts", "pnpm-lock.yaml"].map((p) =>
      call("write_section", { markdown: `## ${p}\n\`\`\`diff path=${p}\n\`\`\`` }),
    ),
  );
  assert.equal((await listViews(db, 1))[0].sections.length, 4);

  // A problem retrying can't fix stops the job at once.
  writeFileSync(join(worktree, "b.ts"), "export const b = 3;\n");
  git(worktree, "commit", "-qam", "again");
  runs.length = 0;
  summaries.setSummaryRunner(async (r) => {
    runs.push(r);
    throw Object.assign(new Error('claude has no model "nope"'), { fatal: true });
  });
  const failed = await finished(await summaries.summariseAhead(db, 1));
  assert.equal(failed.state, "failed");
  assert.match(failed.error ?? "", /no model/);
  assert.equal(runs.length, 1);
  assert.equal(
    await summaries.summariseAhead(db, 1),
    null,
    "ahead waits for the settings to change after a failure retrying can't fix",
  );
  assert.deepEqual(
    (await summaries.fileSummaries(db, 1, failed.base, failed.head, ["b.ts"]))[0].state,
    "missing",
  );
});

test("replies are read leniently and checked", () => {
  const read = summaries.parseAnswer(
    'Here: {"files":[{"file":1,"summary":" One "},{"file":1,"summary":"dup"},{"file":9,"summary":"x"},{"file":2,"summary":""}]}',
    2,
  );
  assert.deepEqual([...read], [[1, "One"]]);
  assert.throws(() => summaries.parseAnswer("no json", 1), /no JSON/);
  assert.throws(() => summaries.parseAnswer("{nope}", 1), /didn't parse/);
});
