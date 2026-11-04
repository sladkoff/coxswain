# 38. Background jobs and core events

Date: 2026-10-02

## Status

Accepted

## Context

coxswain generates reading guides and summarizes agent threads as review comments. Comment summaries use the job runner; Guide generation uses a durable visible Chat session (ADR 0023).

## Decision

1. Background comment summaries run through `JobSpec` in `src/core/jobs.ts`, with shared slots, retries, cancellation and persisted job history. Historical Guide/file job rows remain readable.
2. Core writes emit typed events. The main process forwards them to renderer queries; `background.ts` routes opened/worktree/GitHub and explicit guide events to the workspace’s Guide session. The UI owns no runner or polling timers.
3. Guide generation is a normal queued Chat turn, not a background-agent job. It reuses the persisted session, surfaces permissions and transcript in Chat, and publishes a complete pinned replacement atomically after validation. Preparation and follow-ups coalesce; stale publication is rejected. The Guide sidebar shows progress and links to the session. There is no Activity panel.
4. Guide defaults and per-update model/effort overrides remain independent of comment-summary preferences. Explicit agent changes replace the Guide session; automatic updates retain its identity. Run metadata and session binding live in SQLite settings. See ADR 0023 for lifecycle and retry behavior.
5. File-summary jobs, caches, tools and work-ahead controls are retired. Historical job rows and immutable schema migrations remain readable; no destructive schema migration is needed.

6. Review-request discovery is a core remote watcher, like workspace GitHub watching: startup, project events and a one-minute cadence check added repositories. It creates workspace records only, preserving selection and deferring checkout until open. It does not use agent summary jobs, which require an existing workspace. Individual requested reviewers qualify; teams do not.

## Alternatives considered

- **A timer in the UI** that asks the core for work a moment after something changes. A few lines, but the UI then
  decides when model runs happen (against ADR 0002), it stops when its component isn't there, and its runs have no
  retries and have no persisted job history.
- **A second job runner for thread summaries**, beside the file summaries'. Each would grow its own retries, limits and history;
  the two are the same shape.
- **A stored queue** (jobs written before they run, picked up by workers, resumed after a restart). Needed once work
  is long or must not be lost; what there is now can be worked out again from the workspace, so a job that died is
  simply started again by the next event.
- **Node's `EventEmitter` with a topic per event.** No less code than a typed listener set, and untyped topics.
- **Events from the database** (triggers, or polling tables). Catches every write, but not the worktree, and the
  core already knows when it writes.

## Consequences

- A thread summary costs a model run only when the user asks for one.
- `summary_jobs` became `jobs` (a migration); a job has a `kind`, and its count is `items`, not `files`.
- A job is tied to one workspace and runs on the summary agent; work that fits neither needs the spec widened.
