import type { Db } from "./db";
import { emit } from "./events.ts";
import { headCommit, openWorktree, upstreamCommit, type WorktreeResult } from "./git.ts";
import type { PullRequestResult } from "./github.ts";
import { readPullRequest } from "./pull-requests.ts";

// ADR 0030: the core keeps the workspace on screen fresh; the UI reads what it found and refetches on its events.
// Every few seconds it looks, in git, at HEAD and at the branch's origin/ ref: HEAD moving (a commit, a pull, a reset)
// is a change to the worktree; the origin/ ref moving (a push from coxswain, an agent or a terminal) is a reason to
// check GitHub at once. GitHub is checked when the workspace shows, every minute, and when the window gets focus.
// ponytail: one workspace at a time, polled with git; fs events if many workspaces make that slow.
export const watchLimits = { everyMs: 3000, githubEveryMs: 60_000, freshForMs: 10_000 };

// What the last check of GitHub found for a workspace: what its worktree is on, its PR (null without one), and where
// its origin/ ref was then. Offline or signed out, a check keeps what the last good one found.
type Checked = {
  worktree: WorktreeResult;
  pr: PullRequestResult | null;
  upstream: string | null;
  at: number;
};
const checked = new Map<number, Checked>();
const checking = new Map<number, Promise<Checked>>();
// The running check's worktree, in before its PR is read: the first open shows the diff without waiting for GitHub's
// review threads.
const opening = new Map<number, Promise<WorktreeResult>>();

// Checks GitHub for the workspace now, or joins the check already running: fetches and fast-forwards its worktree
// (git.ts openWorktree) and reads its PR, mirroring its review threads (ADR 0037). Emits github when either changed.
export function checkGitHub(db: Db, workspaceId: number): Promise<Checked> {
  let running = checking.get(workspaceId);
  if (!running) {
    let worktreeIn!: (w: WorktreeResult) => void;
    opening.set(workspaceId, new Promise((done) => (worktreeIn = done)));
    running = check(db, workspaceId, worktreeIn).finally(() => {
      checking.delete(workspaceId);
      opening.delete(workspaceId);
    });
    checking.set(workspaceId, running);
  }
  return running;
}

async function check(
  db: Db,
  workspaceId: number,
  worktreeIn: (w: WorktreeResult) => void,
): Promise<Checked> {
  const before = checked.get(workspaceId);
  const opened = await openWorktree(db, workspaceId);
  const kept = before?.worktree.status === "ok" ? before.worktree : null;
  const worktree: WorktreeResult =
    opened.status !== "ok" && kept
      ? { ...kept, notice: "Could not check GitHub for new commits" }
      : opened;
  worktreeIn(worktree);
  const prNumber = worktree.status === "ok" ? worktree.prNumber : null;
  let pr: PullRequestResult | null = null;
  if (prNumber !== null) {
    const read = await readPullRequest(db, workspaceId);
    if (read.changed) emit({ workspaceId, what: "entries" });
    pr = read.pr.status !== "ok" && before?.pr?.status === "ok" ? before.pr : read.pr;
  }
  const upstream = await upstreamCommit(db, workspaceId).catch(() => null);
  const now: Checked = { worktree, pr, upstream, at: Date.now() };
  checked.set(workspaceId, now);
  if (opened.status === "ok") emit({ workspaceId, what: "opened" });
  if (before && JSON.stringify([before.worktree, before.pr]) !== JSON.stringify([worktree, pr]))
    emit({ workspaceId, what: "github" });
  return now;
}

// What the UI shows: the last check's, at once, or the first one's as soon as its worktree is open.
export async function checkedWorktree(db: Db, workspaceId: number): Promise<WorktreeResult> {
  const last = checked.get(workspaceId);
  if (last) return last.worktree;
  const running = checkGitHub(db, workspaceId).then((c) => c.worktree);
  return Promise.race([opening.get(workspaceId) ?? running, running]);
}
export async function checkedPullRequest(db: Db, workspaceId: number): Promise<PullRequestResult> {
  const { pr } = checked.get(workspaceId) ?? (await checkGitHub(db, workspaceId));
  if (!pr) throw new Error("The workspace has no pull request");
  return pr;
}

type Watched = {
  workspaceId: number;
  timers: ReturnType<typeof setInterval>[];
  head: string | null;
  busy: boolean;
  recheck: () => void;
};
let watched: Watched | null = null;

// Watches this workspace, and stops watching the one before; null stops.
export function watchWorkspace(db: Db, workspaceId: number | null) {
  if (watched?.workspaceId === workspaceId) return;
  watched?.timers.forEach(clearInterval);
  watched = null;
  if (workspaceId === null) return;
  const refresh = () => void checkGitHub(db, workspaceId).catch(() => {});
  const w: Watched = {
    workspaceId,
    timers: [],
    head: null,
    busy: false,
    // Unless a check just ran: switching back and forth, or coming back to the window, asks GitHub once.
    recheck: () => {
      const last = checked.get(workspaceId);
      if (!last || Date.now() - last.at > watchLimits.freshForMs) refresh();
    },
  };
  const look = async () => {
    if (w.busy) return;
    w.busy = true;
    try {
      const [head, upstream] = await Promise.all([
        headCommit(db, workspaceId),
        upstreamCommit(db, workspaceId),
      ]);
      const was = w.head;
      w.head = head;
      if (watched !== w) return;
      if (was && head !== was) emit({ workspaceId, what: "worktree" });
      // A check's own fetch moves the ref too; it records where, so only a push afterwards differs.
      const last = checked.get(workspaceId);
      if (last && upstream !== last.upstream && !checking.has(workspaceId)) refresh();
    } catch {
      // The worktree isn't there yet, or git failed once; the next look tries again.
    } finally {
      w.busy = false;
    }
  };
  w.timers = [
    setInterval(look, watchLimits.everyMs),
    setInterval(refresh, watchLimits.githubEveryMs),
  ];
  watched = w;
  void look();
  w.recheck();
}

// The window got focus: edits made in an editor or a terminal meanwhile show, and GitHub is checked.
export function windowFocused() {
  if (!watched) return;
  emit({ workspaceId: watched.workspaceId, what: "worktree" });
  watched.recheck();
}
