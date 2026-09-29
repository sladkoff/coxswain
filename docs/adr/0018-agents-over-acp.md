# 18. Every agent run over the Agent Client Protocol

Date: 2026-09-25

## Status

Accepted

## Context

coxswain runs a coding agent in each workspace: the agent pane's sessions, which the user chats with, sends
comments to ([ADR 0021](0021-comments-go-to-the-agent-pane.md)) and asks for guides
([ADR 0023](0023-guides-made-by-the-agent-pane.md)). The agent must use the user's own sign-in, so their
subscription pays, with no API key in coxswain. Libraries that call a model API directly (LangChain, the Vercel AI
SDK) can't: they need an API key. Running `claude -p` per turn means parsing Claude Code's private formats, paying
its start-up on every turn, no way to ask the user to approve a tool, and a second copy of everything for Codex,
which the glossary and G3 name.

The **Agent Client Protocol** (ACP, from Zed) is JSON-RPC over stdio between an editor and a coding agent: create or
load a session, send a prompt, receive updates (text, tool calls, plans) as they stream, answer permission requests,
cancel. A session can be given MCP servers by the client. One agent process holds many sessions. Adapters exist for
Claude Code (`@agentclientprotocol/claude-agent-acp`, built on the Claude Agent SDK) and Codex
(`@agentclientprotocol/codex-acp`); Gemini CLI speaks it natively. Each agent keeps its own sign-in and settings.

## Decision

1. **Every agent run is an ACP session.** The core is an ACP client (`@agentclientprotocol/sdk`) in
   `src/core/agents.ts`, and nothing else in the core starts an agent.
2. **coxswain's tools come from a local MCP server.** The core serves them over HTTP on localhost, a path per
   workspace, and gives that server to each session it opens.
3. **One adapter process per agent**, started when first needed and kept while the app runs; each session lives in
   it. A crashed adapter is started again and open sessions loaded.
4. **Each agent is a record** in one place: the command that starts its adapter, a function from a run's options to
   its `session/new` `_meta`, the ID of its auto mode ([ADR 0013](0013-auto-permission-mode.md)), and the picks it
   gets when the user has made none.
5. **Claude Code through `claude-agent-acp`, pointed at the user's own `claude`**: the core finds `claude` on `PATH`
   and passes it as `CLAUDE_CODE_EXECUTABLE`, so the user's version, sign-in, settings, hooks and MCP servers are used.
   Without it the adapter would run the copy bundled with its SDK. Until the user picks a model, sessions are set to
   Claude Code's default model, since the adapter resolves some model aliases differently from Claude Code.
6. **The agent picks the session ID.** `session/new` returns it; the core stores it in
   `agent_sessions.agent_session_id`. For Claude Code it is Claude Code's session ID.
7. **History comes from `session/load`**, which replays the session as updates. The core doesn't read
   `~/.claude/projects/` itself. The core keeps an in-memory session projection: history plus live entries,
   running status, pending permission and error. Concurrent first reads share one replay, and a turn waits for that
   replay before it starts. Reads during a turn return this projection without another ACP replay. It survives pane
   unmounts; the agent still owns durable history. Versioned snapshots reach the renderer independently of the pane,
   so returning to a workspace or reloading a window can reattach to the active session.
8. **Permission requests reach the user.** `session/request_permission` becomes a prompt with the options the agent
   offers, in the agent pane, or in the thread whose comment started the turn.
9. **Chat entries are made from ACP updates**, not from Claude Code's message shapes. `ChatEntry` is the UI's type.
   Attachment previews are restored from coxswain's own records, linked by a prompt header ([ADR 0032](0032-agent-attachments.md)).
   Prompt content is gated by the agent's `promptCapabilities` returned by initialization.
10. **Codex through `codex-acp`, pointed at the user's own `codex`** (`CODEX_PATH`), in its _Approve for me_ mode.
    The agent pane's instructions go in as Codex config (`CODEX_CONFIG`'s `developer_instructions`), since its
    sessions take no system prompt. `agent_sessions.agent` says which agent a session is on; it never changes.
11. **Model and effort are session config options.** The composer's choices are the ones the agent's latest session
    offers (`category` `model` and `thought_level`), so no model list lives in coxswain. The user's picks are stored per
    agent in `settings` and set on each session as its turn starts, model first, since the effort levels depend on it.

12. **Background tasks, subagents and turns the agent starts itself, the same for every agent.** The client
    advertises two draft ACP extensions (`clientCapabilities._meta.jetbrains.air`, JetBrains' AIR name), which both
    adapters implement: `asyncTasks`, for commands left running in the background (`async_task_*` updates, stopped with
    `_session/async_task/stop`), and `nativeSubagentSessions`, where each subagent is a session of its own
    (`subagent_spawned`, `subagent_state_update`). The SDK checks every `session/update` against its schema and drops
    these, so they are handled on the incoming stream before it sees them: tasks and subagents go to the session
    projection, and a subagent's start and end are put in the stream's place as a tool call and its update, so the chat
    shows its line live and in a replayed history. A subagent's own session stays out of the chat; its permission
    requests are asked in the session the user chats with. No adapter offers to stop one subagent; the turn's Stop does.
    Updates that reach no run (Claude Code answering a background task that ended) go straight to the projection.
    `claude-agent-acp` 0.81.2 is patched (`patches/`) so its replay announces a subagent where its Agent call is; it
    announced one only at the subagent's own messages, which its history doesn't hold. Drop the patch once upstream
    fixes it.

13. **One turn at a time per session; the queue is coxswain's.** ACP runs one `session/prompt` at a time. A message
    sent while a turn runs waits in the session projection's queue, where the pane shows it and can take it off, and
    runs when the turn ends, before any other turn can start. `claude-agent-acp` would queue a second `session/prompt`
    itself, but out of sight, and a message handed over can't be taken back. _Send now_ uses `_session/steering`, an
    extension both adapters advertise (`InitializeResponse._meta.steering.supported`): the message goes into the
    running turn instead of cancelling it. With `idleBehavior: "promptRequired"` Claude Code hands it back if the turn
    had just ended, and it runs next; Codex ignores that and starts a turn of its own, which the chat shows like any
    turn the agent starts.

## Alternatives considered

- **The Claude Agent SDK directly**, with its `canUseTool`. Everything we need for Claude, in-process and typed, but
  Claude only; Codex would need its own runner. The ACP adapter is this SDK behind a protocol.
- **Our own `Agent` interface over per-agent runners** (`claude -p`, `codex exec`). A clean abstraction too, but ours
  to maintain per agent, with each agent's formats to parse. ACP is that interface, maintained by the agents' side.
- **LangChain, the Vercel AI SDK or our own agent loop.** Call a model API with an API key, so the user's subscription
  isn't used, and we'd rebuild the tools, context and settings Claude Code already has.

## Consequences

- One way to run an agent. Codex is a record, not new code.
- Picks are per agent, not per session: picking a model in one session moves the agent's other sessions to it at their
  next turn.
- The core runs a small HTTP MCP server on localhost; it answers only the paths it set up.
- Three dependencies. The Claude adapter pulls in the Claude Agent SDK, which bundles a Claude Code binary we don't
  use (install size). Both are pinned; the adapter is young and fast-moving.
- We depend on the adapter's behaviour and its `_meta` options instead of Claude Code's formats and flags.
- A long-lived adapter process to keep, restart and stop. In return, turns skip Claude Code's start-up after the
  first.
- A model set in the user's Claude Code settings is ignored until the user picks one in coxswain.
