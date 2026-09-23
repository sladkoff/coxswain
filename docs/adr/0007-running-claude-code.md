# 7. Running Claude Code

Date: 2026-09-24

## Status

Accepted

## Context

Agent sessions (G3–G5) need coxswain to talk to a local Claude Code: send it a message, show its
reply as it arrives, and carry on the same conversation later, also after a restart.
[ADR 0002](0002-standalone-electron-app.md) puts this work in the core, and
[ADR 0005](0005-local-data-storage.md) says transcripts stay in the agent's own files, read by the
agent's session ID.

Claude Code can be driven three ways: its interactive terminal UI, the Claude Agent SDK
(`@anthropic-ai/claude-agent-sdk`), or its print mode (`claude -p`), which with
`--output-format stream-json` writes one JSON message per line.

## Decision

1. **Print mode, one process per turn.** The core runs
   `claude -p <message> --output-format stream-json --verbose` in the workspace's worktree. The first
   turn passes `--session-id <uuid>`, later turns `--resume <uuid>`. The process ends with the turn.
2. **coxswain picks the session ID.** It is generated when the agent session is created and stored in
   `agent_sessions.agent_session_id`, so the row and Claude Code's transcript match from the start.
3. **The user's own `claude`.** It is found on `PATH` and uses the user's own sign-in, settings,
   hooks and MCP servers. coxswain adds no API key and no configuration.
4. **Transcripts are read from Claude Code's file**, `~/.claude/projects/*/<session ID>.jsonl`,
   whose messages have the same shape as the stream. One parser turns both into chat entries.

## Alternatives considered

- **Claude Agent SDK.** Typed, and it can answer permission requests in code. Rejected for now: a new
  dependency that bundles its own copy of Claude Code, which may differ from the one the user has
  set up. Revisit when coxswain must approve tool use, which print mode can only do through an MCP
  permission tool (`--permission-prompt-tool`).
- **One long-lived process per agent session** (`--input-format stream-json`). Saves the start-up
  time of each turn, but the core then has to keep processes alive and restart them after a crash.
  Resuming by ID costs little, and a turn in progress is the only state a restart loses.
- **Driving the terminal UI in a pseudo-terminal.** Shows exactly what Claude Code shows, but the
  output is for humans, not for parsing.

## Consequences

- Each turn pays Claude Code's start-up time (a second or two, plus hooks).
- Tools that need approval are refused in print mode, so an agent session can read and answer but not
  yet change code. Approving tool use is the next decision for this area.
- We depend on the stream-json and transcript formats; a Claude Code update can break the parser.
- Codex needs its own runner; the `agent` column in `agent_sessions` says which one a session uses.
