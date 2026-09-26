# 21. Comments sent to the agent are turns in the agent pane's session

Date: 2026-09-26

## Status

Accepted

## Context

coxswain's layout is agent-first: the agent pane on the left, the canvas on the right (UX.md). Every comment is a
thread, and a comment can be sent to the agent. The agent the user talks to in the agent pane should see those
comments, so there is one agent with one context per workspace. The user wants comments sent to the agent to show
in the agent chat as a card (*Comment on `a.ts:3` sent to Claude*, the comment, *View thread*), and the agent's
reply attached to the thread.

## Decision

1. **A comment sent to the agent is a turn in the workspace's current agent session**, the one the agent pane
   shows (the latest; a new one if it has none). It runs with that session's options: every tool, auto mode
   (ADR 0013), so the agent may act on it.
2. **The prompt starts with a header line**, `[Comment on <path:lines> · thread #<id>]`, then the comment, then
   what the agent hasn't seen of the thread (the lines, earlier notes) after a `---`. The core reads the header back
   from the transcript into the chat entry (`comment`), and the chat draws it as a card. The agent's own transcript
   stays the only record of the chat (ADR 0005).
3. **The reply streams to both** the thread and the agent pane, and its text is kept as an answer entry in the
   thread. A tool use to approve is asked in the thread.
4. ***Send all to agent*** sends every thread in one message, the same way, under a `[Review · N threads]` header,
   shown as a card too. Explanations and findings nobody replied to, and resolved threads, are left out.

## Alternatives considered

- **A hidden question session per workspace, in a read-only mode, mirrored as cards in the chat.** Two agents, two
  contexts; the cards couldn't be placed among the chat's turns, since a transcript has no times.
- **Store sent comments by session and turn** in place of the header. Cleaner, but a table for something the
  transcript already carries; worth it if the header gets in the way (a `ponytail:` note marks it).

## Consequences

- One agent per workspace sees the whole review; it can change files when asked in a comment.
- A comment sent while the agent pane's turn runs fails with *A turn is already running*, shown in the thread.
- A comment can't go to a session other than the latest.
- The agent pane doesn't show *Working…* for a comment's turn; it streams in, and the thread shows *Working…*.
