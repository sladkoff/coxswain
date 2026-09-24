# 10. Faster guides: diffs in the prompt, cached summaries, grouping before describing

Date: 2026-09-25

## Status

Accepted. Supersedes decisions 2, 3 and 7 of [ADR 0009](0009-guides-from-structured-output.md); the
rest of it stands.

## Context

A guide to #5311 (297 files) took about 6½ minutes. Claude Code's session logs showed where: each
summary agent took 16–27 turns reading diffs with `git diff`, and since every turn rereads the
conversation, a batch of ~40 one-line summaries cost 450k–1.1M input tokens and 10–15k output tokens.
The grouping agent then wrote 16k output tokens, much of it the 297 paths again, plus the
descriptions, before anything showed. Every call also paid ~33k input tokens for Claude Code's own
system prompt and tool definitions. We expect large PRs to be the common case.

## Decision

1. **Diffs go in the prompt; no tools.** coxswain reads each file diff (`readFileDiff`,
   `git diff --no-ext-diff`, cut to 300 lines) and puts it in the prompt. Every call is one turn with
   `--tools ""` and `--system-prompt` replacing Claude Code's own. Still `--strict-mcp-config`.
2. **Every file is summarised first**, on the summary model, in batches of runs in path order (at
   most 25 files or 1200 changed lines), up to 16 at once. Small PRs too: one batch.
3. **Summaries are kept** in `file_summaries`, one row per workspace and path, with the file diff's
   fingerprint (`diffFingerprint`, as for Viewed). A new guide reuses a summary while the file diff is
   unchanged, so *Regenerate* and a PR that moved on only summarise what changed.
4. **Grouping answers with titles and file numbers only.** Files are numbered in the prompt. Numbers
   out of range or repeated are dropped; files left out go in a last group, *Other changes*.
5. **Then each group is described by its own agent**, up to 16 at once, on the model: a description and
   a file note per file, from the group's diffs up to 3000 lines (the rest by their summaries). The
   guide is stored as soon as it's grouped (`finished_at` null), updated as each group arrives, and
   the progress events carry it, so the Guide tab shows it while groups are still being described.
   A failed group keeps an empty description.
6. **Timing is recorded**: `started_at` and `finished_at` on `guides`, and a line in the main
   process's log with each phase's seconds.

## Alternatives considered

- **Keep agents reading diffs themselves.** Lets an agent read only what it needs, but the turns
  are what's slow and expensive.
- **Group from the diffs directly, without summaries.** One call, but 297 diffs don't fit, and the
  summaries are what make regenerating cheap.
- **Rules for generated files** (lockfiles, OpenAPI clients, ORM models) before any agent. Faster, but
  we want such rules in the guide prompt, where the user can change them. Deferred.
- **The Anthropic API directly** instead of `claude -p`. Less overhead per call, but needs a key and
  leaves the local-agent setup of ADR 0007.
- **Descriptions in the grouping answer**, as before. Nothing shows until all of it is written.

## Consequences

- A guide is worth showing about a minute in, before it's finished; one cut off by quitting stays
  unfinished, with some groups lacking a description, until regenerated.
- Diffs over 300 lines are cut, so an agent sees only their start; a group over 3000 lines is
  described partly from summaries.
- Every file diff goes through the summary model, even on small PRs: one more call than before for
  them.
- The guide prompt is used for two steps, grouping and describing, so it should describe the whole
  guide rather than one answer.
- We depend on `--tools ""` and `--system-prompt` working with `--json-schema`.
