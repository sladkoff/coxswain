# 23. Guides are made by the agent pane's session, with coxswain's tools

Date: 2026-09-27

## Status

Accepted

## Context

A guide (glossary) groups a PR's file diffs by theme, in reading order, so the user can review it top to bottom. A
fixed pipeline in the core (summarise each file, group, describe each group) can't be steered ("focus on the API",
"skip the tests"), can't look anything up in the repo, and can point only at whole files. The agent pane's session
can do all of that already; it lacks only a way to put what it finds on the canvas.

The user also wants the agent to be able to review, not just guide: a guide only helps the user read, a review adds
the agent's own thoughts. Reviewing is opt-in.

## Decision

1. **The agent pane's sessions get coxswain's tools.** The local HTTP MCP server
   ([ADR 0018](0018-agents-over-acp.md), 2) serves a stable path per workspace, `coxswain`, given to every agent pane
   session when it's opened, resumed or loaded, and allowed without asking (`mcp__coxswain`). Its tools:
   - `start_view`: a new view, a guide or another kind, pinned to the merge base → a snapshot of the worktree,
     local changes included ([ADR 0028](0028-branch-workspaces-and-snapshots.md). Returns the range, the changed files, how to read source files, and how to write a good view; no changes are required.
   - `write_section`: appends a section of markdown to a view, or replaces one. What a view holds is in
     [ADR 0026](0026-views-in-markdown-with-mermaid.md); embedded diff paths are checked against the changed files and source paths against the snapshot,
     and a file is embedded once.
   - `remove_section`: removes a section from a view. It and `write_section` change a view one at a time
     ([ADR 0029](0029-file-summaries-and-activity.md)).
   - `file_summaries`: the file summaries of a view's changed files, which `start_view` lists too
     ([ADR 0029](0029-file-summaries-and-activity.md)); it can wait for those being written.
   - `list_views`: the workspace's views, with their ids, titles, ranges and section headings.
   - `add_explanation`: an explanation (glossary) on lines of the view's range.
   - `add_finding`: a finding (glossary) on lines, the agent's own concern or suggestion. Its description says to use
     it only when the user asked for a review.
     The tools that write take the view's id (`view`, returned by `start_view` and listed by `list_views`) and write to
     the workspace's latest view without it, so an older view can be changed and two sessions each keep to their own.
     A short text appended to Claude Code's system prompt (`paneContext`) tells the agent it runs in coxswain, what the
     comment and review headers mean, and what the tools are for; how to use each stays in its description and result.
2. **Any message can make a view.** "Make me a guide" or "show me the data model" works, since the tools are always
   there. _New View_ in the canvas's bar also offers a guide, a review, a data model, a data flow or a message of
   the user's own, each a short message put in the agent pane's composer for the user to edit and send. How to guide
   lives in `start_view`'s result, not in a setting.
3. **Views show on the canvas.** A view shown puts its sections in order, and for a guide the files it doesn't embed
   after them under _Not in the guide_. Explanations and findings are entries (kinds `explanation`, `finding`) with the
   view's id, shown as threads between the lines only while their view is shown, so the user can reply or send them
   back to the agent.
4. **Views stay pinned and are kept until the user removes them.** A view shows its range (merge base → head then),
   like a commit diff, not the live worktree; once the worktree moves on (its snapshot changes) it's _stale_. Every view is kept and can be
   shown again from its chip in the canvas bar, for going back or for debugging. Removing one is the user's choice:
   right-click its chip → _Remove View…_, confirmed, deletes it with its explanations and findings (`entries.view_id`
   cascades). The agent can't remove a view. The newest is shown when it appears, and on opening a workspace if it
   isn't stale.
5. **Reviewed carries over between views** for file diffs that didn't change
   ([ADR 0014](0014-reviewed-follows-file-diff-contents.md)).

## Alternatives considered

- **A fixed pipeline of one-shot runs** (summaries, grouping, descriptions). Fast and predictable, but unsteerable
  and file-level only.
- **The agent writes the whole guide in one answer schema.** One call can't grow the guide as it reads; nothing shows
  until it's done, and a big PR won't fit one answer.
- **Explanations as a guide field, not entries.** They'd need their own rendering and couldn't be replied to; entries
  get threads, outdated handling and _Send to agent_ for free.
- **Show guides on the live diff.** Line numbers drift as the agent edits; the pinned range keeps explanations where
  they were written, and the user asked to keep guides pinned.

## Consequences

- A guide costs what the agent pane's session costs, on its model, and fills in as the agent calls the tools.
- A guide is made in whichever session the agent pane talks to; its reasoning stays in that transcript.
- Two sessions making views at once keep apart only if the agent passes `view`; without it, both write to the newest.
- Views include local changes through their pinned snapshot (ADR 0028).
