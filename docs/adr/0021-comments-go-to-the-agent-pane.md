# 21. Comments sent to the agent are turns in the agent pane's session

Date: 2026-09-26

## Status

Accepted. Supersedes the per-round question session of [ADR 0011](0011-review-rounds-and-entries.md) and the
question permission mode of [ADR 0018](0018-agents-over-acp.md) (point 8).

## Context

coxswain is moving to an agent-first layout: the agent pane on the left, the canvas on the right (UX.md). Every
comment is a thread, and a comment can be sent to the agent. Until now a question went to a hidden agent session
of its own, one per review round, in *ask* mode, told not to change files. So the agent the user talks to in the
agent pane never saw the comments, and there were two agents with two contexts on one workspace. The user wants
comments sent to the agent to show in the agent chat as a card (*Comment on `a.ts:3` sent to Claude*, the comment,
*View thread*), and the agent's reply attached to the thread.

## Decision

1. **A comment sent to the agent is a turn in the workspace's current agent session**, the one the agent pane
   shows (the latest; a new one if it has none). It runs with that session's options: every tool, auto mode
   (ADR 0013), so the agent may act on it.
2. **The prompt starts with a header line**, `[Comment on <path:lines> · thread #<id>]`, then the comment, then
   what the agent hasn't seen of the thread (the lines, earlier notes) after a `---`. The core reads the header back
   from the transcript into the chat entry (`comment`), and the chat draws it as a card. The agent's own transcript
   stays the only record of the chat (ADR 0005).
3. **The reply streams to both** the thread and the agent pane, and its text is kept as an answer entry in the
   thread, as before. A tool use to approve is still asked in the thread.
4. **No schema change.** Old per-round question sessions stay in `agent_sessions` with their `review_round_id` and
   stay out of the agent pane's list.

## Alternatives considered

- **Keep the question session and mirror its questions as cards in the chat.** Two agents, two contexts; the cards
  couldn't be placed among the chat's turns, since a transcript has no times.
- **Store sent comments by session and turn** in place of the header. Cleaner, but a table for something the
  transcript already carries; worth it if the header gets in the way (a `ponytail:` note marks it).

## Consequences

- One agent per workspace sees the whole review; it can change files when asked in a comment.
- A comment sent while the agent pane's turn runs fails with *A turn is already running*, shown in the thread.
- A comment can't go to a session other than the latest.
- The agent pane doesn't show *Working…* for a comment's turn; it streams in, and the thread shows *Working…*.
