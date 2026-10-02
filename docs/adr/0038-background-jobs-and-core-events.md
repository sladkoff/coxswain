# 38. Background jobs and core events

Date: 2026-10-02

## Status

Accepted

## Context

File summaries ([ADR 0029](0029-file-summaries-and-activity.md)) were the only work coxswain did that nobody waits
for, and their jobs (batches, retries, a stored history, Activity) lived in `summaries.ts`, started by calls spread
over the main process's handlers. Thread conclusions ([ADR 0037](0037-pull-request-sync-and-posting.md)) are the same
kind of work: a small model writes something short about a part of a workspace, ahead of when it's needed. Their
first version ran from a timer in the bottom bar, in the UI, with none of the jobs' retries or visibility. More such
work is coming, and the app is young enough to settle one way of doing it.

## Decision

1. **Work nobody waits for is a background job** (`src/core/jobs.ts`). A job is some items of one workspace for the
   summary agent (ADR 0029's agent and model, in Settings): it runs them in batches, at most 6 runs at once across
   all jobs, retries a failed run after 2 s and 8 s, asks again one at a time for items an answer left out, stops at
   once on a failure retrying can't fix, and stores each answer as it comes. It is a row of `jobs` (progress at most
   every 100 ms; the latest 50 shown, 500 kept; one running when coxswain quit is marked stopped at the next start),
   so Activity shows it, also after a restart.
2. **A kind says what a job is about** (`JobSpec`): its items, which need no model, how they batch, the prompt and
   how the reply is read, and where an answer is stored. Two kinds: `files`, file summaries, stored in
   `file_summaries` by fingerprint; `conclusions`, thread conclusions, stored in `thread_conclusions` by the
   fingerprint of the thread's entries. A new kind is a spec; the engine, the table and Activity stay as they are.
3. **The core has one event bus** (`src/core/events.ts`): whoever changes something in a workspace emits what changed
   (`entries`, `worktree`, `transcript`, `sessions`, `view`) or that its worktree was `opened`. In memory, in order,
   nothing stored. Adding an entry emits `entries` itself, in the core.
4. **Two things listen.** The main process forwards the changes to the window, which refetches
   ([ADR 0017](0017-data-fetching-with-tanstack-query.md)). `src/core/background.ts` starts the jobs that follow from
   an event, and is the one place that says what runs when: `opened` and `worktree` summarise the committed changes
   ahead; `entries` concludes the threads that changed, once they've been still for 30 s, leaving out a thread an agent
   is answering.
5. **Work ahead is one setting.** _Ahead_ in Settings turns both off: summaries are then made for a view, conclusions
   when Submit Review opens. After a failure retrying can't fix, work ahead waits until the settings change; work
   that was asked for still tries and shows its error.
6. **The UI starts no background work.** It asks for what it needs (`draftReview`, which starts a job for what's
   missing and can wait for it) and shows jobs; it holds no timers for the core.

## Alternatives considered

- **A timer in the UI** that asks the core for the draft a moment after the threads change. A few lines, but the UI
  then decides when model runs happen (against ADR 0002), it stops when its component isn't there, and its runs have
  no retries and don't show in Activity.
- **A second job runner for conclusions**, beside the summaries'. Each would grow its own retries, limits and history;
  the two are the same shape.
- **A stored queue** (jobs written before they run, picked up by workers, resumed after a restart). Needed once work
  is long or must not be lost; what there is now can be worked out again from the workspace, so a job that died is
  simply started again by the next event.
- **Node's `EventEmitter` with a topic per event.** No less code than a typed listener set, and untyped topics.
- **Events from the database** (triggers, or polling tables). Catches every write, but not the worktree, and the
  core already knows when it writes.

## Consequences

- A change to entries the UI makes itself and tells nobody (resolve, edit, delete) emits no core event; conclusions
  of such a thread are written when Submit Review opens. Emitting from those writes too is the next step.
- Every changed thread with more than the user's one comment costs a model run, submitted or not, unless work ahead
  is off.
- `summary_jobs` became `jobs` (a migration); a job has a `kind`, and its count is `items`, not `files`.
- A job is tied to one workspace and runs on the summary agent; work that fits neither needs the spec widened.
