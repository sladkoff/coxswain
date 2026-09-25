# 13. Agent sessions run in Claude Code's auto permission mode

Date: 2026-09-25

## Status

Accepted. Supersedes decision 8 of [ADR 0008](0008-clones-and-pr-worktrees.md).

## Context

Agent sessions in L4 run `claude -p` with `--permission-mode acceptEdits` (ADR 0008). Print mode has
nobody to ask, so every tool use that would prompt is refused: most shell commands, and MCP tools
such as Linear. A hand-off of #5311's action items couldn't read the Linear issue it needed, or run
the tests. coxswain can't show permission prompts yet (ADR 0007).

## Decision

Agent sessions in L4 run with `--permission-mode auto`: Claude Code's classifier approves or blocks
each tool use that would prompt, and anything it blocks is refused as before. Questions keep
`--permission-mode default`, so they still can't change files.

## Alternatives considered

- **Allow rules** in the repository's or the user's settings: exact, but only covers what is listed,
  and each repository needs its own.
- **Permission prompts in L4** (`--permission-prompt-tool`): the user decides each one. The right end
  state, and more work: an MCP server in the main process and UI for pending prompts.
- **`bypassPermissions`**: runs everything, including what the classifier would block.

## Consequences

- An agent session can run commands, use MCP tools and reach the network in its worktree without the
  user approving each use. The worktree is coxswain's own, and pushing still needs the classifier to
  allow it.
- What the classifier blocks can't be approved from coxswain until L4 shows permission prompts.
- Needs a Claude Code version with auto mode.
