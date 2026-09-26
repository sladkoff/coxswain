# 22. No review rounds: entries belong to the workspace

Date: 2026-09-26

## Status

Accepted. Supersedes [ADR 0011](0011-review-rounds-and-entries.md) (review rounds), [ADR 0012](0012-wrap-up-and-action-items.md)
(wrap up and action items) and [ADR 0019](0019-round-history-and-resolving.md) (round history and resolving), and point 4
of [ADR 0021](0021-comments-go-to-the-agent-pane.md) (old question sessions kept).

## Context

With the agent-first layout, comments are threads and a comment sent to the agent is a turn in the agent pane's
session (ADR 0021). Rounds grouped entries into passes, each with its own question session, a wrap-up that drafted
action items, and a hand-off of those items to an agent. None of that fits the new model: the agent already sees
every comment sent to it, and acts on it directly. The user asked to remove the round concept entirely.

## Decision

1. **An entry belongs to its workspace** (`entries.workspace_id`), not a round. The canvas shows all of the
   workspace's entries, current or outdated (ADR 0015); there is no *wrapped-up* state.
2. **Rounds, wrap up, action items, hand-off and *Copy as prompt* are gone**, in the core, the IPC and the UI (the
   round bar, the handed-off chip in the agent pane, round events on the timeline, action items in change summaries).
3. **Migration 20** rebuilds `entries` with `workspace_id` (taken from each entry's round) and without `sent_at`,
   rebuilds `agent_sessions` without `review_round_id`, dropping the old per-round question sessions, and drops
   `action_items` and `review_rounds`. Entries and their threads are kept.

## Alternatives considered

- **Hide rounds in the UI, keep the tables.** Leaves a data model nobody reads and code paths that can't be reached.

## Consequences

- Every entry a workspace ever had shows on its canvas; nothing archives old ones yet (a `ponytail:` note in
  `workspaceEntries`).
- Action items and wrap-ups made before are lost, and so are the transcripts' links to old question sessions (the
  agent's own transcripts stay on disk).
- There's no way yet to turn a review into a list of changes for an agent; the agent pane and threads are the way
  for now.
