# 39. Skills for views, served by coxswain's tools

Date: 2026-10-03

## Status

Accepted

## Context

How the agent pane's agent makes a view is told by the tools' own texts ([ADR 0023](0023-guides-made-by-the-agent-pane.md),
[ADR 0026](0026-views-in-markdown-with-mermaid.md)): `start_view`'s result says how to write a view and a guide. Guides
came out as a tour of the files with instructions for the reviewer ("Check that …"), because that is what the text
asked for, and their overviews narrated the diff instead of showing its shape and its risk.

Others have written and tried instructions for exactly these jobs: [mattpocock/skills](https://github.com/mattpocock/skills)
(MIT) has `pr` (a PR body as the smallest visual of the change, and its merge danger, from Dex Horthy's `show-me`),
`code-review` (two separate axes, standards and spec, and a baseline of code smells) and `writing-beats` (ordering
material so each part leans only on what came before). They are written for a coding agent working in a repository,
not for coxswain's view tools, so they need telling how they apply.

## Decision

1. **Skills ship whole, in the app** (`resources/skills/`): `pr`, `code-review` and `writing-beats`, each folder copied
   unchanged from upstream, with its license and the commit it came from (`resources/skills/README.md`). Updating one
   is copying it again.
2. **The agent reads them with a coxswain tool**, `read_skill` (several in one call), on the agent pane's MCP server
   next to the view tools. Each comes with a note first (`src/core/skills.ts`) that says which of its parts apply
   in coxswain and how they map to the tools: `pr` makes a view's overview, `writing-beats`' grounding orders its
   sections, `code-review`'s axes become findings on lines with `add_finding`.
3. **The view instructions delegate to them** at the step they serve: `start_view`'s result tells a guide to read
   `pr` and `writing-beats` first, and `code-review` in a review; another view opens the way `pr` opens a summary. What
   coxswain itself says is what only it knows: its fences, its tools, and that a guide's prose is made of claims about
   the code, not instructions to the reviewer.
4. **The instructions coxswain writes for agents follow `writing-for-agents`**, a skill for whoever edits them, in
   `.claude/skills/` (copied whole likewise); it isn't shipped.

## Alternatives considered

- **Native skills** (a Claude Code plugin directory passed to the session). The agent would find them itself, but
  Codex sessions wouldn't have them, they'd sit next to the user's own skills under the same names, and they'd carry
  no note on how they apply here.
- **Inline the parts that apply** into `start_view`'s result. One call fewer, but the skills are then rewritten by
  us, drift from upstream, and every view's result grows by their length whether a part is needed or not.
- **Write our own instructions from scratch.** What we had; the skills carry more tested judgement than we'd write.

## Consequences

- A guide costs one more tool call (both skills at once), and the skills' text is in the agent's context for the turn.
- Upstream changes reach coxswain only when someone copies them; the README says from which commit.
- The notes in `skills.ts` and the skills' own text can disagree (a skill's steps for an issue tracker, its
  sub-agents, an article file); the note says what holds, and it comes first.
- A packaged app reads the skills from its `resources/`; the main process says where.
