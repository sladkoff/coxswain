import type { Db } from "./db";
import {
  type ChangedFile,
  diffFingerprints,
  headCommit,
  listChangedFiles,
  openedBefore,
  openedWorktree,
  readFileDiff,
} from "./git.ts";
import { getWorkspaceRepo } from "./workspaces.ts";

// ADR 0029: a file summary (glossary) says in a sentence or two what changed in a file diff. A small model writes them
// ahead of time, so the agent pane's agent can plan a view from them without reading every diff first. Each is stored
// under its file diff's fingerprint (ADR 0014), so a summary is never updated: a file diff that changed has a new
// fingerprint and is summarised again. The work runs in summary jobs, which Activity shows.

export type SummaryAgent = "claude" | "codex";
// model: "" is the agent's own default. ahead: summarise a workspace's committed changes when it's opened or moves
// on, not only when a view asks.
export type SummarySettings = { agent: SummaryAgent; model: string; ahead: boolean };
const defaultModel: Record<SummaryAgent, string> = { claude: "haiku", codex: "" };

// A summary job: the file diffs of one range that had no summary yet. why: "ahead", the workspace was opened or its
// HEAD moved; "view", a view was started on it. model: as asked for; ranOn: what the agent says it ran. reused: had a
// summary already, or another job is making it. done: summarised by this job; failed: gave up on. calls: model runs,
// retries included. now: the files in the runs going on. error: the last one, even if a retry then worked.
export type SummaryJob = {
  id: number;
  workspaceId: number;
  workspace: string;
  why: "ahead" | "view";
  base: string;
  head: string;
  agent: SummaryAgent;
  model: string;
  ranOn: string | null;
  files: number;
  reused: number;
  done: number;
  failed: number;
  calls: number;
  now: string[];
  state: "running" | "done" | "failed" | "stopped";
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

// A file's summary for the agent's tools, at a view's range: ready, being made, or not there (failed, or never asked).
export type FileSummary = {
  path: string;
  state: "ready" | "pending" | "missing";
  summary: string | null;
};

// One run of the summary agent: the prompt, and a system prompt in place of the agent's own. Resolves with the reply's
// text and the model it ran on. Rejects with fatal set when trying again can't help (not installed, no such model).
export type SummaryRun = {
  agent: SummaryAgent;
  model: string;
  cwd: string;
  prompt: string;
  instructions: string;
  signal: AbortSignal;
};
export type SummaryRunner = (r: SummaryRun) => Promise<{ text: string; model: string | null }>;
// Set by the main process to a one-shot agent run (agents.ts); tests set their own.
let runner: SummaryRunner = async () => {
  throw Object.assign(new Error("No summary agent is set up"), { fatal: true });
};
export const setSummaryRunner = (r: SummaryRunner) => void (runner = r);

// Diffs go in the prompt cut to fileLines lines each; a run gets at most batchFiles files or batchLines lines, and at
// most parallel runs go at once across all jobs. A run that fails is tried again after retryMs, then 4× that, up to
// attempts in all; files a run left out are then asked for one at a time.
// ponytail: fixed sizes, from the old guide pipeline on #5311; settings if other PRs want others.
export const limits = {
  fileLines: 300,
  batchFiles: 25,
  batchLines: 1200,
  parallel: 6,
  attempts: 3,
  retryMs: 2000,
};
// How many jobs Activity shows, and how many are kept.
const listed = 50;
const kept = 500;

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

// Runs n at a time across all jobs; a finished run hands its slot to the next one waiting.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active < limits.parallel) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

// The running jobs, with a way to stop each; every job is also a row of summary_jobs, so Activity shows them after a
// restart too.
const live = new Map<number, SummaryJob>();
// The agent and model of the last job that failed in a way trying again can't fix: summarising ahead waits until the
// settings change, rather than failing again each time a workspace is checked. Views still try, and show the error.
let failedWith: string | null = null;
// The agent and model of the last run that worked: until one has, a job sends one run first, so a wrong model fails
// once and not once per slot.
let workedWith: string | null = null;
const settingsKey = (s: Pick<SummarySettings, "agent" | "model">) => `${s.agent}\0${s.model}`;
const stops = new Map<number, AbortController>();
// The file diffs being summarised by some job, by key, resolving once done or given up on.
const making = new Map<string, Promise<void>>();
const keyOf = (workspaceId: number, path: string, fingerprint: string) =>
  `${workspaceId}\0${path}\0${fingerprint}`;

const listeners = new Set<(jobs: SummaryJob[]) => void>();
export function onSummaryJobs(listener: (jobs: SummaryJob[]) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// The latest jobs, newest first: the running ones as they are now, the rest as stored.
export async function listSummaryJobs(db: Db): Promise<SummaryJob[]> {
  const rows = await db
    .selectFrom("summary_jobs")
    .selectAll()
    .orderBy("id", "desc")
    .limit(listed)
    .execute();
  return rows.map((r) => {
    const running = live.get(r.id);
    if (running) return { ...running, now: [...running.now] };
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      workspace: r.workspace,
      why: r.why,
      base: r.base,
      head: r.head,
      agent: r.agent,
      model: r.model,
      ranOn: r.ran_on,
      files: r.files,
      reused: r.reused,
      done: r.done,
      failed: r.failed,
      calls: r.calls,
      now: [],
      state: r.state,
      error: r.error,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    };
  });
}

// A job as its row: what it did so far, or all of it once finished.
const saveJob = (db: Db, j: SummaryJob) =>
  db
    .updateTable("summary_jobs")
    .set({
      ran_on: j.ranOn,
      files: j.files,
      reused: j.reused,
      done: j.done,
      failed: j.failed,
      calls: j.calls,
      state: j.state,
      error: j.error,
      finished_at: j.finishedAt,
      updated_at: new Date().toISOString(),
    })
    .where("id", "=", j.id)
    .execute();

// Stores the running jobs' progress and tells the listeners, at most every 100 ms.
let telling: ReturnType<typeof setTimeout> | undefined;
const tell = (db: Db) => {
  telling ??= setTimeout(async () => {
    telling = undefined;
    try {
      await Promise.all([...live.values()].map((j) => saveJob(db, j)));
      const list = await listSummaryJobs(db);
      listeners.forEach((l) => l(list));
    } catch (e) {
      console.error("summaries:", (e as Error).message);
    }
  }, 100);
};

// Jobs that were running when coxswain last quit ended then; called once at startup.
export async function stopInterruptedJobs(db: Db) {
  await db
    .updateTable("summary_jobs")
    .set((eb) => ({
      state: "stopped",
      error: "coxswain quit while it ran",
      finished_at: eb.ref("updated_at"),
    }))
    .where("state", "=", "running")
    .execute();
}

export function stopSummaryJob(id: number) {
  stops.get(id)?.abort();
}

// Summarises what the workspace's HEAD has on top of its merge base, if the user wants that done ahead. The
// uncommitted changes are left for a view to ask for: they change with every save.
export async function summariseAhead(db: Db, workspaceId: number): Promise<SummaryJob | null> {
  const settings = await getSummarySettings(db);
  if (!settings.ahead || failedWith === settingsKey(settings)) return null;
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

// Starts a job for the range's file diffs that have no summary and aren't being made, unless one runs for the same
// range already. Returns it, or null when there's nothing to do. A new job ahead stops the workspace's older ones: its
// HEAD moved on. Never throws: a job that can't start shows as failed.
export async function summarise(
  db: Db,
  workspaceId: number,
  base: string,
  head: string,
  why: SummaryJob["why"],
): Promise<SummaryJob | null> {
  const same = [...live.values()].find(
    (j) =>
      j.workspaceId === workspaceId && j.base === base && j.head === head && j.state === "running",
  );
  if (same) return same;
  const settings = await getSummarySettings(db);
  const job: SummaryJob = {
    id: 0, // its row's, once added
    workspaceId,
    workspace: await workspaceLabel(db, workspaceId),
    why,
    base,
    head,
    agent: settings.agent,
    model: settings.model,
    ranOn: null,
    files: 0,
    reused: 0,
    done: 0,
    failed: 0,
    calls: 0,
    now: [],
    state: "running",
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  let mine: { file: ChangedFile; key: string; fingerprint: string }[];
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
    job.files = files.length;
    job.reused = files.length - mine.length;
  } catch (e) {
    return finish(db, await add(db, job), "failed", (e as Error).message);
  }
  if (!mine.length) return null;
  if (why === "ahead")
    for (const j of live.values())
      if (j.workspaceId === workspaceId && j.why === "ahead") stopSummaryJob(j.id);
  await add(db, job);
  const stop = new AbortController();
  stops.set(job.id, stop);
  const done = new Map<string, () => void>();
  for (const m of mine) making.set(m.key, new Promise<void>((r) => done.set(m.key, r)));
  // Once per file: a later job may be making the same file diff again by then.
  const release = (key: string) => {
    const resolve = done.get(key);
    if (!resolve) return;
    done.delete(key);
    making.delete(key);
    resolve();
  };
  void work(db, job, mine, stop, release, settings)
    .catch((e: Error) => console.error(`summaries ${job.id}:`, e.message))
    .finally(() => {
      stops.delete(job.id);
      for (const m of mine) release(m.key);
    });
  return job;
}

async function work(
  db: Db,
  job: SummaryJob,
  mine: { file: ChangedFile; key: string; fingerprint: string }[],
  stop: AbortController,
  release: (key: string) => void,
  settings: SummarySettings,
) {
  let fatal: string | null = null;
  let agentFailed = false;
  const save = async (m: (typeof mine)[number], summary: string, by: string) => {
    await db
      .insertInto("file_summaries")
      .values({
        workspace_id: job.workspaceId,
        path: m.file.path,
        fingerprint: m.fingerprint,
        summary,
        model: by,
        created_at: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.columns(["workspace_id", "path", "fingerprint"]).doUpdateSet({ summary, model: by }),
      )
      .execute();
    job.done++;
    release(m.key);
  };
  const giveUp = (files: typeof mine) => {
    job.failed += files.length;
    files.forEach((m) => release(m.key));
    tell(db);
  };
  try {
    const cwd = await openedWorktree(db, job.workspaceId);
    const byModel: typeof mine = [];
    for (const m of mine) {
      const s = byName(m.file);
      if (s) await save(m, s, "coxswain");
      else byModel.push(m);
    }
    tell(db);
    // In path order, so a run tends to get one folder.
    const batches: (typeof mine)[] = [];
    const lines = (m: (typeof mine)[number]) =>
      Math.min(m.file.additions + m.file.deletions, limits.fileLines);
    for (const m of byModel) {
      const last = batches.at(-1);
      const size = last?.reduce((n, x) => n + lines(x), 0) ?? 0;
      if (!last || last.length >= limits.batchFiles || size + lines(m) > limits.batchLines)
        batches.push([m]);
      else last.push(m);
    }
    const attempt = async (files: typeof mine, n: number): Promise<void> => {
      if (stop.signal.aborted) return;
      let answers: Map<string, string>;
      try {
        answers = await slot(() => ask(files));
      } catch (e) {
        if (stop.signal.aborted) return;
        job.error = (e as Error).message;
        if ((e as { fatal?: boolean }).fatal) {
          fatal = job.error;
          agentFailed = true;
          stop.abort();
          return;
        }
        if (n >= limits.attempts) return giveUp(files);
        tell(db);
        await sleep(limits.retryMs * 4 ** (n - 1), stop.signal);
        return attempt(files, n + 1);
      }
      for (const m of files) {
        const s = answers.get(m.file.path);
        if (s)
          await save(m, s, s.startsWith("Binary file") ? "coxswain" : (job.ranOn ?? job.model));
      }
      tell(db);
      const left = files.filter((m) => !answers.has(m.file.path));
      if (!left.length) return;
      if (n >= limits.attempts) {
        job.error = `No summary came back for ${left.map((m) => m.file.path).join(", ")}`;
        giveUp(left);
        return tell(db);
      }
      await Promise.all(left.map((m) => attempt([m], n + 1)));
    };
    // One run: the files' diffs in a prompt, binary ones summarised here instead.
    const ask = async (files: typeof mine): Promise<Map<string, string>> => {
      if (stop.signal.aborted) return new Map();
      const diffs = await Promise.all(
        files.map((m) =>
          readFileDiff(db, job.workspaceId, job.base, job.head, m.file).catch(
            (e: Error) => `(couldn't read the diff: ${e.message})`,
          ),
        ),
      );
      const answers = new Map<string, string>();
      const asked: { file: ChangedFile; diff: string }[] = [];
      files.forEach((m, i) =>
        isBinary(diffs[i])
          ? answers.set(m.file.path, `Binary file ${m.file.status}.`)
          : asked.push({ file: m.file, diff: diffs[i] }),
      );
      if (!asked.length) return answers;
      job.calls++;
      job.now.push(...asked.map((a) => a.file.path));
      tell(db);
      try {
        const out = await runner({
          agent: settings.agent,
          model: settings.model,
          cwd,
          prompt: summaryPrompt(asked),
          instructions,
          signal: stop.signal,
        });
        job.ranOn = out.model ?? job.ranOn;
        workedWith = settingsKey(settings);
        for (const [n, s] of parseAnswer(out.text, asked.length))
          answers.set(asked[n - 1].file.path, s);
        return answers;
      } finally {
        const running = new Set(asked.map((a) => a.file.path));
        job.now = job.now.filter((p) => !running.has(p));
      }
    };
    if (workedWith !== settingsKey(settings) && batches.length > 1)
      await attempt(batches.shift()!, 1);
    await Promise.all(batches.map((b) => attempt(b, 1)));
  } catch (e) {
    fatal = (e as Error).message;
  }
  const left = mine.length - job.done - job.failed;
  if (fatal) {
    if (agentFailed) failedWith = settingsKey(settings);
    await finish(db, job, "failed", fatal);
  } else if (stop.signal.aborted || left > 0) await finish(db, job, "stopped", job.error);
  else await finish(db, job, job.failed && !job.done ? "failed" : "done", job.error);
}

// Stores a new job, and drops the oldest beyond those kept.
async function add(db: Db, job: SummaryJob): Promise<SummaryJob> {
  const now = new Date().toISOString();
  const { id } = await db
    .insertInto("summary_jobs")
    .values({
      workspace_id: job.workspaceId,
      workspace: job.workspace,
      why: job.why,
      base: job.base,
      head: job.head,
      agent: job.agent,
      model: job.model,
      ran_on: null,
      files: job.files,
      reused: job.reused,
      done: 0,
      failed: 0,
      calls: 0,
      state: "running",
      error: null,
      started_at: job.startedAt,
      finished_at: null,
      updated_at: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  job.id = id;
  live.set(id, job);
  await db
    .deleteFrom("summary_jobs")
    .where("id", "<=", id - kept)
    .execute();
  tell(db);
  return job;
}

async function finish(
  db: Db,
  job: SummaryJob,
  state: SummaryJob["state"],
  error: string | null,
): Promise<SummaryJob> {
  job.state = state;
  job.error = error;
  job.now = [];
  job.finishedAt = new Date().toISOString();
  const s = (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000;
  console.log(
    `summaries ${job.id} (${job.workspace}, ${job.why}): ${state}, ${job.files} files, ${job.reused} reused, ${job.done} summarised, ${job.failed} failed, ${job.calls} runs on ${job.agent} ${job.ranOn ?? (job.model || "default")} in ${s.toFixed(1)} s${error ? `; ${error}` : ""}`,
  );
  await saveJob(db, job);
  live.delete(job.id);
  tell(db);
  return job;
}

async function workspaceLabel(db: Db, workspaceId: number): Promise<string> {
  const w = await getWorkspaceRepo(db, workspaceId).catch(() => null);
  if (!w) return `Workspace ${workspaceId}`;
  return w.prNumber !== null ? `${w.name} #${w.prNumber}` : `${w.name} ${w.branch}`;
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

export async function getSummarySettings(db: Db): Promise<SummarySettings> {
  const rows = await db
    .selectFrom("settings")
    .select(["key", "value"])
    .where("key", "like", "summaries.%")
    .execute();
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const agent: SummaryAgent = get("summaries.agent") === "codex" ? "codex" : "claude";
  return {
    agent,
    model: get(`summaries.model.${agent}`) ?? defaultModel[agent],
    ahead: get("summaries.ahead") !== "off",
  };
}

// Changes what's given. The model is kept per agent, the current one unless agent is given too, so switching agents
// finds the model picked for each before.
export async function setSummarySettings(db: Db, s: Partial<SummarySettings>) {
  const set = (key: string, value: string) =>
    db
      .insertInto("settings")
      .values({ key, value })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
      .execute();
  if (s.agent) await set("summaries.agent", s.agent);
  if (s.model !== undefined) {
    const agent = s.agent ?? (await getSummarySettings(db)).agent;
    await set(`summaries.model.${agent}`, s.model.trim());
  }
  if (s.ahead !== undefined) await set("summaries.ahead", s.ahead ? "on" : "off");
  failedWith = null;
}
