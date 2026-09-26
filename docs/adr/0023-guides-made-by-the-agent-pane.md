# 23. Guides are made by the agent pane's session, with coxswain's tools

Date: 2026-09-27

## Status

Accepted. Supersedes [ADR 0009](0009-guides-from-structured-output.md) (guides from structured output),
[ADR 0010](0010-faster-guides.md) (faster guides: summaries, grouping, describing) and
[ADR 0014](0014-guides-pinned-to-the-pr-head.md) (guides pinned to the PR head; the pinning itself is kept, below).

## Context

A guide was made by a fixed pipeline in the core: file summaries on a summary model, one grouping call, then one call
per group, each a one-shot run with an answer schema. It was shown in its own *Guide* tab, which the agent-first layout
removed (ADR 0021, 0022). The pipeline can't be steered ("focus on the API", "skip the tests"), can't look anything up
in the repo, and can't point at lines, only at whole files. The agent pane's session can do all of that already; it
lacks only a way to put what it finds on the canvas.

The user also wants the agent to be able to review, not just guide: a guide only helps the user read, a review adds
the agent's own thoughts. Reviewing is opt-in.

## Decision

1. **The agent pane's sessions get coxswain's tools.** The local HTTP MCP server that served the answer tool
   ([ADR 0018](0018-agents-over-acp.md), 2) serves a stable path per workspace, `coxswain`, given to every agent pane
   session when it's opened, resumed or loaded, and allowed without asking (`mcp__coxswain`). Its tools:
   - `start_guide`: a new guide, pinned to the merge base → the PR head as coxswain last saw it. Returns the range, the
     changed files and how to make a good guide.
   - `add_group`: appends a guide group (title, description, a file note per file, *generated* or not) to the
     workspace's latest guide. Paths are checked against the guide's changed files; a file goes in one group.
   - `add_explanation`: an explanation (glossary) on lines of the guide's range.
   - `add_finding`: a finding (glossary) on lines, the agent's own concern or suggestion. Its description says to use
     it only when the user asked for a review.
2. **Any message can make a guide.** "Make me a guide" works, since the tools are always there. *Guide* in the canvas's
   bar also offers *Make a Guide* and *Make a Guide with Review*, which send a short message to the agent pane's
   session like *Send all to agent* does. How to guide lives in `start_guide`'s result, not in a setting.
3. **Guides show in *Changes*.** A guide shown puts its groups in reading order (generated last, then *Not in the
   guide*), with each group's title and description above its first file diff and each file note above its file diff.
   Explanations and findings are entries (kinds `explanation`, `finding`) with the guide's id, shown as threads
   between the lines only while their guide is shown, so the user can reply or send them back to the agent.
4. **Guides stay pinned and are all kept.** A guide shows its range (merge base → head then), like a commit diff, not
   the live worktree; once the PR head moves on it's *stale*. Every guide is kept and can be shown again from the
   *Guide* menu, for going back or for debugging. The newest is shown when it appears, and on opening a workspace if
   it isn't stale.
5. **The pipeline is gone**: file summaries, the guide prompt, the guide model and the summary model's role in
   guides, the old `guides` table and its guides. Migration 21 drops `guides` and `file_summaries`, makes a new
   `guides` table, and rebuilds `entries` with the new kinds and `guide_id`. The summary model stays as the change
   summaries' model (ADR 0020), in Settings under *Change summaries*.

## Alternatives considered

- **Keep the pipeline, run it from a tool.** Fast and predictable, but still unsteerable and file-level only.
- **The agent writes the whole guide in one answer schema.** One call can't grow the guide as it reads; nothing shows
  until it's done, and a big PR won't fit one answer.
- **Explanations as a guide field, not entries.** They'd need their own rendering and couldn't be replied to; entries
  get threads, outdated handling and *Send to agent* for free.
- **Show guides on the live diff.** Line numbers drift as the agent edits; the pinned range keeps explanations where
  they were written, and the user asked to keep guides pinned.

## Consequences

- A guide costs what the agent pane's session costs, on its model, and fills in as the agent calls the tools.
- A guide is made in whichever session the agent pane talks to; its reasoning stays in that transcript.
- The workspace's latest guide is the one the tools add to, so two sessions making guides at once would mix them.
- Local changes aren't in a guide, as before.
- `timeline.ts` now owns the one-shot `ask` and the summary model setting.
