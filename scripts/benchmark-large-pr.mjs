// Reproducible synthetic benchmark; does not read or modify user projects/database.
// Run: node --experimental-strip-types scripts/benchmark-large-pr.mjs [file-count] [lines-per-file]
import os from "node:os";
import { mock } from "node:test";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { openDatabase } from "../src/core/db.ts";

const count = Number(process.argv[2] ?? 1200);
const lines = Number(process.argv[3] ?? 120);
if (
  !Number.isSafeInteger(count) ||
  count < 1 ||
  count > 3000 ||
  !Number.isSafeInteger(lines) ||
  lines < 1 ||
  lines > 1000
)
  throw new Error("Use 1–3000 files and 1–1000 lines per file");
const temp = mkdtempSync(join(os.tmpdir(), "coxswain-large-pr-"));
const home = mock.method(os, "homedir", () => temp);
syncBuiltinESMExports();
const { openWorktree, openedWorktree, listChangedFiles, diffFingerprints, readTexts } =
  await import("../src/core/git.ts");
const { listChangedSinceReview } = await import("../src/core/reviewed.ts");
home.mock.restore();
syncBuiltinESMExports();
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Benchmark",
      GIT_AUTHOR_EMAIL: "benchmark@example.invalid",
      GIT_COMMITTER_NAME: "Benchmark",
      GIT_COMMITTER_EMAIL: "benchmark@example.invalid",
    },
  }).trim();
const repo = join(temp, "repo");
mkdirSync(repo);
const db = openDatabase(join(temp, "benchmark.db"));
const paths = Array.from({ length: count }, (_, i) => `file-${String(i).padStart(4, "0")}.ts`);
const contents = (file, changed) =>
  Array.from(
    { length: lines },
    (_, line) =>
      `export const value_${file}_${line} = "${changed && line === 0 ? "changed" : "original"}_${"x".repeat(110)}";`,
  ).join("\n") + "\n";
const results = [];
async function measure(name, action) {
  await new Promise((resolve) => setTimeout(resolve, 20));
  const lag = monitorEventLoopDelay({ resolution: 5 });
  lag.enable();
  let peakRSS = process.memoryUsage().rss;
  const sample = setInterval(() => {
    peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
  }, 5);
  const start = performance.now();
  await action();
  const elapsedMs = performance.now() - start;
  peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
  await new Promise((resolve) => setTimeout(resolve, 10));
  clearInterval(sample);
  lag.disable();
  const row = {
    name,
    ms: +elapsedMs.toFixed(1),
    maxEventLoopDelayMs: +(lag.max / 1e6).toFixed(1),
    peakProcessRSSMiB: +(peakRSS / 1048576).toFixed(1),
  };
  results.push(row);
  console.log(JSON.stringify(row));
}
try {
  git(repo, "init", "-b", "main");
  for (let i = 0; i < paths.length; i++) writeFileSync(join(repo, paths[i]), contents(i, false));
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
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
  const opened = await openWorktree(db, 1);
  if (opened.status !== "ok") throw new Error(opened.message);
  const worktree = await openedWorktree(db, 1);
  for (let i = 0; i < paths.length; i++) writeFileSync(join(worktree, paths[i]), contents(i, true));
  git(worktree, "add", ".");
  git(worktree, "commit", "-m", "feature");
  const head = git(worktree, "rev-parse", "HEAD");
  console.log(
    JSON.stringify({
      fixture: {
        files: count,
        linesPerFile: lines,
        totalTextMiBPerSide: +(
          paths.reduce((bytes, _, i) => bytes + Buffer.byteLength(contents(i, true)), 0) / 1048576
        ).toFixed(1),
        note: "First-call is not cold disk; repository generation warms OS caches. RSS is whole process, not operation delta.",
      },
    }),
  );
  await measure("changed-file metadata", () => listChangedFiles(db, 1, base, head));
  await measure("visible file contents (10 files)", () =>
    readTexts(db, 1, paths.slice(0, 10), head),
  );
  await measure("fingerprint all files (first call)", () =>
    diffFingerprints(db, 1, base, paths, head),
  );
  await measure("fingerprint all files (repeat)", () => diffFingerprints(db, 1, base, paths, head));
  await measure("changed-since-review, no marks or baselines", () =>
    listChangedSinceReview(db, 1, base, head),
  );
  await measure("overlapping full and subset fingerprint requests", () =>
    Promise.all([
      diffFingerprints(db, 1, base, paths, head),
      diffFingerprints(db, 1, base, paths.slice(0, Math.ceil(count / 3)), head),
      diffFingerprints(db, 1, base, paths, head),
    ]),
  );
  await measure("live worktree fingerprint all files", () => diffFingerprints(db, 1, base, paths));
} finally {
  await db.destroy();
  rmSync(temp, { recursive: true, force: true });
}
