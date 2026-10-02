import type { Db } from "./db";
import {
  type ChangedFile,
  diffFingerprints,
  headCommit,
  listChangedFiles,
  openedBefore,
  readFileDiff,
} from "./git.ts";
import {
  aheadIsOff,
  failJob,
  getSummarySettings,
  type Job,
  runningJobs,
  startJob,
  stopJob,
} from "./jobs.ts";

// ADR 0029: a file summary (glossary) says in a sentence or two what changed in a file diff. A small model writes them
// ahead of time, so the agent pane's agent can plan a view from them without reading every diff first. Each is stored
// under its file diff's fingerprint (ADR 0014), so a summary is never updated: a file diff that changed has a new
// fingerprint and is summarised again. The work runs in background jobs of kind "files" (jobs.ts, ADR 0038).

// A file's summary for the agent's tools, at a view's range: ready, being made, or not there (failed, or never asked).
export type FileSummary = {
  path: string;
  state: "ready" | "pending" | "missing";
  summary: string | null;
};

// Diffs go in the prompt cut to fileLines lines each; a run gets at most batchFiles files or batchLines lines.
// ponytail: fixed sizes, from the old guide pipeline on #5311; settings if other PRs want others.
export const limits = { fileLines: 300, batchFiles: 25, batchLines: 1200 };

const instructions =
  "You summarise code changes for a reviewer. Everything you need is in the message: don't use tools. Answer with the JSON asked for and nothing else.";

// Files a package manager or git writes, summarised without a model.
// ponytail: lockfiles by name only; the agent tags other generated files itself.
const lockfile =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|Podfile\.lock|flake\.lock|mix\.lock|pubspec\.lock)$/;
function byName(f: ChangedFile): string | null {
  if (f.status === "deleted") return `Deleted (${f.deletions} lines).`;
  if (lockfile.test(f.path))
    return `Lockfile, written by a package manager: +${f.additions} −${f.deletions} lines.`;
  if (f.status === "renamed" && !f.additions && !f.deletions)
    return `Renamed from ${f.previousPath}, contents unchanged.`;
  return null;
}
// The key a summary is stored under: its file diff's fingerprint, and the prompt's version, so a new prompt makes new
// summaries rather than keeping those written to the old one. Bump it with every change to summaryPrompt.
const promptVersion = 2;
const summaryFingerprints = async (...args: Parameters<typeof diffFingerprints>) =>
  new Map(
    [...(await diffFingerprints(...args))].map(([path, f]) => [path, `${f}.v${promptVersion}`]),
  );

const isBinary = (diff: string) => /^Binary files .* differ$/m.test(diff);

export function summaryPrompt(files: { file: ChangedFile; diff: string }[]): string {
  const cut = (diff: string) => {
    const lines = diff.split("\n");
    return lines.length <= limits.fileLines
      ? diff
      : `${lines.slice(0, limits.fileLines).join("\n")}\n… ${lines.length - limits.fileLines} more lines`;
  };
  return [
    "Summarise each changed file below for a reviewer in one sentence of at most 25 words: what changed in it and, if the diff shows it, why. Name the main function, type or setting that changed. Don't review or judge. Name files by path, never by number.",
    'Answer with JSON only, one entry per file: {"files":[{"file":<its number>,"summary":"<text>"}]}',
    `Files (number, status, lines added and removed, path), each with its diff:\n\n${files
      .map(
        ({ file: f, diff }, i) =>
          `### ${i + 1}. ${f.status} +${f.additions} -${f.deletions} ${f.previousPath ? `${f.previousPath} -> ` : ""}${f.path}\n${cut(diff)}`,
      )
      .join("\n\n")}`,
  ].join("\n\n");
}

// The summaries in a reply, by file number; entries that don't fit are left out. Throws if there's no JSON to read.
export function parseAnswer(text: string, count: number): Map<number, string> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The reply had no JSON in it");
  let answer: { files?: unknown };
  try {
    answer = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The reply's JSON didn't parse");
  }
  if (!Array.isArray(answer?.files)) throw new Error('The reply had no "files" list');
  const out = new Map<number, string>();
  for (const a of answer.files as { file?: unknown; summary?: unknown }[]) {
    const n = a?.file;
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > count || out.has(n as number))
      continue;
    if (typeof a.summary === "string" && a.summary.trim())
      out.set(n as number, a.summary.trim().slice(0, 300));
  }
  return out;
}

// The file diffs being summarised by some job, by key, resolving once done or given up on.
const making = new Map<string, Promise<void>>();
const keyOf = (workspaceId: number, path: string, fingerprint: string) =>
  `${workspaceId}\0${path}\0${fingerprint}`;

// Summarises what the workspace's HEAD has on top of its merge base, if the user wants that done ahead. The
// uncommitted changes are left for a view to ask for: they change with every save.
export async function summariseAhead(db: Db, workspaceId: number): Promise<Job | null> {
  if (aheadIsOff(await getSummarySettings(db))) return null;
  const at = await openedBefore(db, workspaceId);
  if (at?.status !== "ok") return null;
  let head: string;
  try {
    head = await headCommit(db, workspaceId);
  } catch {
    return null;
  }
  return summarise(db, workspaceId, at.mergeBase, head, "ahead");
}

type Missing = { file: ChangedFile; key: string; fingerprint: string };

// Starts a job for the range's file diffs that have no summary and aren't being made, unless one runs for the same
// range already. Returns it, or null when there's nothing to do. A new job ahead stops the workspace's older ones: its
// HEAD moved on. Never throws: a job that can't start shows as failed.
export async function summarise(
  db: Db,
  workspaceId: number,
  base: string,
  head: string,
  why: Job["why"],
): Promise<Job | null> {
  const mineOf = (j: Job) => j.kind === "files" && j.workspaceId === workspaceId;
  const same = runningJobs().find((j) => mineOf(j) && j.base === base && j.head === head);
  if (same) return same;
  const about = { kind: "files" as const, workspaceId, why, base, head };
  let mine: Missing[];
  let total: number;
  try {
    const listed = await listChangedFiles(db, workspaceId, base, head);
    if (listed.status !== "ok") throw new Error(listed.message);
    const files = listed.files;
    const fingerprints = await summaryFingerprints(
      db,
      workspaceId,
      base,
      files.map((f) => f.path),
      head,
    );
    const have = await stored(db, workspaceId, [...fingerprints.values()]);
    mine = files.flatMap((file) => {
      const fingerprint = fingerprints.get(file.path)!;
      const key = keyOf(workspaceId, file.path, fingerprint);
      return have.has(key) || making.has(key) ? [] : [{ file, key, fingerprint }];
    });
    total = files.length;
  } catch (e) {
    return failJob(db, about, (e as Error).message);
  }
  if (!mine.length) return null;
  if (why === "ahead")
    for (const j of runningJobs()) if (mineOf(j) && j.why === "ahead") stopJob(j.id);
  const done = new Map<string, () => void>();
  for (const m of mine) making.set(m.key, new Promise<void>((r) => done.set(m.key, r)));
  const lines = (m: Missing) => Math.min(m.file.additions + m.file.deletions, limits.fileLines);
  return startJob<Missing>(db, {
    ...about,
    total,
    reused: total - mine.length,
    items: mine,
    name: (m) => m.file.path,
    byHand: (m) => byName(m.file),
    // In path order, so a run tends to get one folder.
    batches: (byModel) => {
      const batches: Missing[][] = [];
      for (const m of byModel) {
        const last = batches.at(-1);
        const size = last?.reduce((n, x) => n + lines(x), 0) ?? 0;
        if (!last || last.length >= limits.batchFiles || size + lines(m) > limits.batchLines)
          batches.push([m]);
        else last.push(m);
      }
      return batches;
    },
    // One run: the files' diffs in a prompt, binary ones summarised here instead.
    ask: async (files, run) => {
      const diffs = await Promise.all(
        files.map((m) =>
          readFileDiff(db, workspaceId, base, head, m.file).catch(
            (e: Error) => `(couldn't read the diff: ${e.message})`,
          ),
        ),
      );
      const answers = new Map<Missing, string>();
      const asked: Missing[] = [];
      const prompted: { file: ChangedFile; diff: string }[] = [];
      files.forEach((m, i) => {
        if (isBinary(diffs[i])) return answers.set(m, `Binary file ${m.file.status}.`);
        asked.push(m);
        prompted.push({ file: m.file, diff: diffs[i] });
      });
      if (!asked.length) return answers;
      const text = await run(summaryPrompt(prompted), instructions, asked);
      for (const [n, s] of parseAnswer(text, asked.length)) answers.set(asked[n - 1], s);
      return answers;
    },
    save: (m, summary, by) => {
      const model = summary.startsWith("Binary file") ? "coxswain" : by;
      return db
        .insertInto("file_summaries")
        .values({
          workspace_id: workspaceId,
          path: m.file.path,
          fingerprint: m.fingerprint,
          summary,
          model,
          created_at: new Date().toISOString(),
        })
        .onConflict((oc) =>
          oc.columns(["workspace_id", "path", "fingerprint"]).doUpdateSet({ summary, model }),
        )
        .execute();
    },
    // Once per file: a later job may be making the same file diff again by then.
    settled: (m) => {
      const resolve = done.get(m.key);
      if (!resolve) return;
      done.delete(m.key);
      making.delete(m.key);
      resolve();
    },
  });
}

// ADR 0030: how many of the workspace's committed file diffs (merge base → HEAD, what's summarised ahead) have a
// summary; null before its worktree is opened.
export type SummaryCoverage = { files: number; summarised: number; head: string };
export async function summaryCoverage(
  db: Db,
  workspaceId: number,
): Promise<SummaryCoverage | null> {
  const at = await openedBefore(db, workspaceId);
  if (at?.status !== "ok") return null;
  const head = await headCommit(db, workspaceId);
  const listed = await listChangedFiles(db, workspaceId, at.mergeBase, head);
  if (listed.status !== "ok") return null;
  const paths = listed.files.map((f) => f.path);
  const fingerprints = await summaryFingerprints(db, workspaceId, at.mergeBase, paths, head);
  const have = await stored(db, workspaceId, [...fingerprints.values()]);
  return { files: paths.length, summarised: have.size, head };
}

// The keys of the fingerprints given that have a summary.
async function stored(db: Db, workspaceId: number, fingerprints: string[]): Promise<Set<string>> {
  if (!fingerprints.length) return new Set();
  const rows = await db
    .selectFrom("file_summaries")
    .select(["path", "fingerprint"])
    .where("workspace_id", "=", workspaceId)
    .where("fingerprint", "in", fingerprints)
    .execute();
  return new Set(rows.map((r) => keyOf(workspaceId, r.path, r.fingerprint)));
}

// The summaries of files of a range, in the order given. wait: up to that many ms for those being made.
export async function fileSummaries(
  db: Db,
  workspaceId: number,
  base: string,
  head: string,
  paths: string[],
  wait = 0,
): Promise<FileSummary[]> {
  const fingerprints = await summaryFingerprints(db, workspaceId, base, paths, head);
  const keys = paths.map((p) => keyOf(workspaceId, p, fingerprints.get(p)!));
  const pending = keys.flatMap((k) => making.get(k) ?? []);
  if (wait > 0 && pending.length)
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, wait))]);
  const rows = fingerprints.size
    ? await db
        .selectFrom("file_summaries")
        .select(["path", "fingerprint", "summary"])
        .where("workspace_id", "=", workspaceId)
        .where("fingerprint", "in", [...fingerprints.values()])
        .execute()
    : [];
  const byKey = new Map(rows.map((r) => [keyOf(workspaceId, r.path, r.fingerprint), r.summary]));
  return paths.map((path, i) => {
    const summary = byKey.get(keys[i]) ?? null;
    return {
      path,
      summary,
      state: summary !== null ? "ready" : making.has(keys[i]) ? "pending" : "missing",
    };
  });
}

// ponytail: summaries of file diffs no range has any more are never pruned; drop those older than a month if the table
// grows. A workspace's go with it (the cascade).
