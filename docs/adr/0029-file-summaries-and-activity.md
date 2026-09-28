# 29. File summaries, made ahead by a small model, shown in Activity

Date: 2026-09-28

## Status

Accepted

## Context

Views are made by the agent pane's session ([ADR 0023](0023-guides-made-by-the-agent-pane.md)). On a big change
(#36) that is slow: the agent reads the diffs one or a few at a time, one turn each, on the pane's model, in one context
that keeps growing, and a second view starts from zero. The fixed pipeline it replaced was fast on the same PRs
because a small model summarised files in parallel batches and the summaries were cached, but it couldn't be steered.
The user wants the speed back without giving up the agent, and wants the background work to be reliable and to be
seen: what runs, on which model, and why it failed.

## Decision

1. **A file summary is a sentence or two on what changed in one file diff**, written by the summary agent (Claude
   Code or Codex, and a model, in Settings; Claude Code's smallest Haiku by default). It's stored in `file_summaries`
   under the file diff's fingerprint ([ADR 0014](0014-reviewed-follows-file-diff-contents.md)), so it's never
   updated: a file diff that changes has a new fingerprint and is summarised again, and the old one stays for the
   contents it was about. Deleted files, lockfiles, pure renames and binary files get one written by coxswain, with
   no model call.
2. **Summary jobs do the work** (`src/core/summaries.ts`). A job takes the file diffs of one range that have no
   summary and aren't being made by another job, and summarises them in batches (diffs cut to 300 lines, at most 25
   files or 1200 lines a run), at most 6 runs at once across all jobs. Each run is one-shot (`askOnce`): a session of
   its own over ACP ([ADR 0018](0018-agents-over-acp.md)), no tools or MCP servers, Claude Code's system prompt
   replaced and thinking off, closed after; it answers with JSON, checked in the core. A run that fails is tried
   again after 2 s and 8 s; files an answer left out are asked for one at a time; then they're given up on. A
   failure retrying can't fix (the agent isn't installed, it has no such model) stops the job at once. Until a run
   has worked with the settings, a job sends one run before the rest, so a wrong model fails once.
3. **When:** _ahead_, when a workspace's worktree is opened or checked again and after each agent turn, for the merge
   base → the worktree's HEAD: committed changes, which don't change under us. A new job ahead stops the workspace's
   older ones. Uncommitted changes change with every save, so they're summarised only for a view: `start_view` starts
   a job for its snapshot. Summarising ahead can be turned off; after a failure retrying can't fix it waits until the
   settings change.
4. **The agent never waits for summaries.** `start_view` lists each changed file with its summary, or says it's
   being written or missing, and the new `file_summaries` tool gets them for a view (some paths or all, optionally
   waiting up to 120 s for those being written). The guide instructions say to plan from them and read a diff before
   writing about a file: they're a small model's reading of one diff, hints, not facts.
5. **Activity shows the jobs**, at the canvas bar's right: a button that turns while one runs and gets a red dot when
   one failed, opening a list of the jobs, newest first: state, workspace, why, progress, files reused, summarised
   and failed, agent and the model it ran on, runs, range, the files being summarised now, the last error, and Stop.
   Jobs are stored in `summary_jobs` (their progress at most every 100 ms), so Activity shows them after a restart:
   the latest 50, of the 500 kept. One still running when coxswain quit is marked stopped at the next start. Each
   finished job is logged by the main process too.
6. **`write_section` and `remove_section` change a view one at a time**, each on the view as the one before left it,
   so sections written at once by two sessions or subagents all land.

## Alternatives considered

- **The old pipeline back** (summarise, group, describe). Fastest, but it can't be steered or look anything up, which
  is why ADR 0023 dropped it.
- **Only a prompt change: split big views across subagents.** Parallel, but every subagent runs on the pane's model,
  nothing is cached, and Codex shows subagents only in ACP's fallback mode (one flat transcript, turns ending before
  the subagents do).
- **Summarise uncommitted changes as they happen.** They change on every save, so most of those calls would be about
  contents nobody makes a view of.
- **Keep the jobs in memory only.** What's missing can always be worked out again from the file diffs and the
  table, but after a restart a workspace summarised earlier showed no activity at all, which read as if nothing had
  run. The history is coxswain's own, so storing it fits ADR 0005.
- **Make `start_view` wait for summaries.** Simpler for the agent, but a big first view would sit for a minute or more
  with nothing to show; the agent can wait with `file_summaries` when it wants to.

## Consequences

- Opening a workspace spends model calls on its changes, whether or not it ever gets a view; the setting turns that
  off.
- The first view of a big change is as slow as before if nothing was summarised ahead; later ones and views after a
  small push reuse almost everything.
- Summaries of file diffs no range has any more stay until their workspace is removed; jobs beyond the 500 kept are
  dropped.
- Codex sessions keep the pane's instructions in one-shot runs, since Codex's config is per adapter process.
