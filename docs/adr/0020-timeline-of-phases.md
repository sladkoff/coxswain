# 20. The Overview is a timeline of phases, one per PR head seen

Date: 2026-09-26

## Status

Accepted. Replaces the Overview's plain description. Builds on [ADR 0005](0005-local-data-storage.md) (store only
what nobody else has) and [ADR 0014](0014-guides-pinned-to-the-pr-head.md) (pinned ranges).

## Context

The Overview showed only the PR's title and description. To understand where a PR stands, the user has to piece it
together: what the change was when it opened, what later pushes changed and why, what was asked and noted in each
round, and what collaborators said on GitHub. The user wants one place for that history, the **timeline**, split
into **phases** by new commits, each with a summary written by an agent. It's also meant to become the **context**
that agents get later.

## Decision

1. **A phase is one PR head coxswain saw.** Every time `openWorktree` gets the PR's head from GitHub,
   `recordHead` compares it with the workspace's latest phase and adds a phase if it's new (the `phases` table:
   `head`, `base`, `merge_base`, `seen_at`). `base` is the old side of what the phase changed: the merge base for
   the first phase, the previous head when the new head builds on it, and the merge base again after a rebase or a
   force-push. The phase's kind (*created*, *pushed*, *rebased*) comes from that, and isn't stored.
2. **Each phase gets a change summary on its own**, made right after the phase is recorded: one run on the summary
   model (Settings, *Guide*), no tools, with the phase's diff in the prompt (cut like a guide's), its commit
   messages, and the PR's title and description (first phase) or the action items of rounds wrapped up in the
   phase before (later phases). The answer is a short piece of prose that the prompt steers towards the change's intent and its why, stored on the
   phase (`summary`) with the model. It's prose, not fields, so it reads as a story and the prompt can change without
   a migration. Unlike a
   guide, it isn't waited for: it's one cheap call. A phase without a summary (the app quit, the run failed) gets
   one the next time its workspace is opened, and the Overview can make it again.
3. **The timeline is put together when it's read** (`getTimeline`), not stored as events. The core combines:
   - the phases, with their files, lines and commits counted from git (`base` → `head`);
   - every entry and wrap-up of every round, from SQLite;
   - GitHub's issue timeline (`GET /repos/{o}/{r}/issues/{n}/timeline`): comments, reviews (with how many review
     comments they have), and the PR being merged, closed, reopened, marked ready or draft, or force-pushed;
   - the PR's title, description, author and creation time.

   Each event goes in the latest phase seen at or before it happened; a GitHub review goes in the phase of the
   commit it was made on, if one matches. Events from before the first phase go in the first. Offline or signed
   out, the timeline still shows what coxswain stores, and says GitHub couldn't be reached.
4. **The core says `timeline` changed** when a phase is recorded or summarised. Entries changing already refetch it.

## Alternatives considered

- **An `events` table** written as things happen: stores copies of what GitHub and our own tables already hold, and
  needs keeping in step (a deleted entry, an edited comment).
- **Phases from GitHub's `committed` events**: they carry commit dates, not push times, so they can't tell pushes
  apart. GitHub doesn't list pushes on a PR, apart from force-pushes.
- **A phase per review round**: rounds end when the user wraps up, not when the code changes, and a phase has to
  follow the code.
- **Summaries on request only, like guides**: a guide takes minutes; a change summary is one call on a small model,
  and a timeline without them says little.

## Consequences

- coxswain only sees heads while it's open and the workspace is loaded, so pushes made while it was closed show as
  one phase, and the first phase covers every commit up to the first head seen, not the PR as first opened.
- A phase after a rebase summarises the whole PR again, not what the rebase changed.
- `getTimeline` asks GitHub on every read, and it's read again whenever entries change. A few requests each; cache
  it if the rate limit starts to show.
- The summaries are written for the UI. When the context goes to agents, their shape may change.
