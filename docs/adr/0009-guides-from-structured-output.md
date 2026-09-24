# 9. Guides from Claude Code's structured output

Date: 2026-09-24

## Status

Accepted

## Context

The Guide tab ([UX](../UX.md) L3) shows a workspace's file diffs in guide groups made by an agent
(glossary: *guide*). Unlike a chat turn ([ADR 0007](0007-running-claude-code.md)), the result is data
the UI lays out, not text to show, so it must come back in a fixed shape. Making one costs tens of
seconds to minutes and money, so it shouldn't be made again on every visit, and nobody else keeps it
([ADR 0005](0005-local-data-storage.md)).

## Decision

1. **`claude -p --output-format json --json-schema <schema>`** in the workspace's worktree. The
   answer is read from the result's `structured_output`. Prompts go on stdin.
2. **No diff in the prompts.** Each agent gets the changed files (status, +/− lines, path) and is told
   to read diffs itself with `git diff --no-ext-diff <merge base> -- <path>`. Its tools are Read, Grep,
   Glob and Bash limited to `git diff`, `git show` and `git log`, so it can't change anything.
   `--strict-mcp-config` leaves out the user's MCP servers, whose tool definitions alone overflowed
   Haiku's context.
3. **Map, then reduce, for big PRs.** The changed files are cut into batches in path order (at most
   40 files or 2000 changed lines each). With more than one batch, each batch goes to its own agent
   on the *summary model* (default `haiku`), eight at a time, which returns one sentence per file.
   Then one agent on the *model* gets the guide prompt and the file list with those summaries, and
   groups the files. A small PR skips the map step. A failed batch leaves its files unsummarised
   rather than failing the guide.
4. **Guides are stored** in the `guides` table: workspace, merge base, model, the groups as JSON and
   when it was made. The Guide tab shows the latest guide for the current merge base; regenerating
   adds a row. The groups are JSON because they're only ever read and written whole.
5. **The models are recorded** from each result's `modelUsage` (the model with the most output), e.g.
   `claude-opus-5-5[1m], summaries by claude-haiku-4-5-20251001`.
6. **Settings live in a `settings` key–value table**: `guide.prompt`, `guide.model` (empty means
   Claude Code's default) and `guide.summary-model`. An unset key means the core's default, so a
   better default prompt reaches users who never changed it.
7. **Paths are checked**: only changed files are kept, each in its first group, and empty groups are
   dropped. Changed files left out show under *Not in the guide*.

## Alternatives considered

- **Putting the patch in the prompt.** Tried first: a big PR's patch had to be cut to fit, and one
  agent had to take it all in. Reading on demand lets each agent read only its own files.
- **Claude Code's own subagents** (its Task tool). Same fan-out, but the agent decides it, so coxswain
  can't pick the model per step, show progress or later cache per file.
- **One agent session over several turns**, a batch per turn. One batch at a time, and the context
  grows with every turn.
- **Parse JSON out of a text answer.** No schema to hold the agent to; breaks on any prose around it.
- **Claude Agent SDK.** Same reasons as in ADR 0007.
- **Normalised tables for groups and their files.** Nothing queries a single group; JSON is enough.
- **Keep guides in memory only.** Every restart would pay minutes and money again.

## Consequences

- A guide can go stale: files changed after it was made only show under *Not in the guide*, and a new
  merge base hides it until regenerated.
- Groups are whole file diffs; a file with changes on two themes lands in one group.
- Summaries aren't kept, so *Regenerate* summarises every batch again. Caching them by file diff
  fingerprint is the next step if that's slow.
- The grouping agent sees summaries, not diffs, unless it reads them; groups are as good as the
  summaries.
- We depend on `--json-schema` and the `structured_output` and `modelUsage` fields of Claude Code's
  JSON result.
