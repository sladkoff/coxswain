# 13. Agent sessions run in Claude Code's auto permission mode

Date: 2026-09-25

## Status

Accepted

## Context

Agent sessions work in the workspace's worktree ([ADR 0008](0008-clones-and-pr-worktrees.md)). They need to
run shell commands (tests, builds) and MCP tools (such as Linear) to act on a review. Asking the user about
every tool use would make a long turn unattended impossible; allowing everything would run what nobody
should run without a look.

## Decision

Agent sessions run in Claude Code's `auto` permission mode: its classifier approves or blocks each tool use
that would prompt. What it would block is asked of the user as a permission prompt, in the agent pane or in
the thread whose comment started the turn ([ADR 0018](0018-agents-over-acp.md), 8).

## Alternatives considered

- **Allow rules** in the repository's or the user's settings: exact, but only covers what is listed,
  and each repository needs its own.
- **`default` mode, every prompt to the user**: safe, but the user has to approve every command.
- **`bypassPermissions`**: runs everything, including what the classifier would block.

## Consequences

- An agent session can run commands, use MCP tools and reach the network in its worktree without the
  user approving each use. The worktree is coxswain's own, and pushing still needs the classifier to
  allow it.
- Needs a Claude Code version with auto mode.
