# 4. Every agent run over ACP

## Status

Open.

## Goal

G3, G4, G5 ([GOALS.md](../GOALS.md)).

## What

Agent sessions in L4, a round's questions, guides and wrap-ups all run over ACP, still on the user's own Claude Code
and sign-in. When an agent session wants a tool that auto mode would block, L4 (or the question's thread) asks the
user, with the agent's options (allow once, always, reject), and the turn carries on with the answer. Runs after the
first start faster. Existing agent sessions still open with their history. Guides are no slower than today.

## Notes

- [ADR 0018](../adr/0018-agents-over-acp.md), superseding ADR 0007.
- Add `@agentclientprotocol/sdk` and `@agentclientprotocol/claude-agent-acp`, pinned. Start one adapter with
  `CLAUDE_CODE_EXECUTABLE` set to `claude` found on `PATH`; check with `claude --version` in the chat that it's the
  user's own.
- One entry point in `src/core/agents.ts`, e.g. `run(agent, { cwd, prompt, model, tools, instructions, thinking,
  persist, mode, answer?: schema }, onUpdate)`. Agent sessions, questions, `runClaude` in `guides.ts` and wrap-up in
  `review.ts` all call it; `runClaude` and the `claude -p` spawns go.
- The Claude agent record maps options to `_meta.claudeCode.options`: `tools: []` or read-only tools,
  `systemPrompt`, `strictMcpConfig: true`, `thinking` off for summaries, `persistSession: false` for one-shot runs.
  Check the names against the adapter's pinned version (`OPTION_REBUILDS_SESSION` in its `acp-agent.js` lists them).
- Answer tool: a localhost HTTP MCP server in the core (the adapter supports HTTP MCP), one `answer` tool per run
  with the run's schema, arguments checked against it before the run resolves. Pick a free port at start.
- Replaces `transcriptPath` and `readTranscript` (now `session/load`) and `stopTurn`/`stopGuides` (now
  `session/cancel`). Keep `ChatEntry` and the IPC shape so the UI changes only for the permission prompt.
- `startAgentSession` no longer makes the UUID; it comes from `session/new`.
- Measure a guide on #5311 before and after: ADR 0010's timing line in the main process's log. Summaries run 16 at
  once; check the adapter copes with 16 parallel sessions.
- UX: the permission prompt in L4 and in a thread is new; add it to [UX.md](../UX.md).
- Codex (`@zed-industries/codex-acp`) is a follow-up, not part of this ticket.
- Removes the `ponytail:` on `runTurn` and the devlog debt "Blocked tools can't be approved".
