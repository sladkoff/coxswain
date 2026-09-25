# 18. Every agent run over the Agent Client Protocol

Date: 2026-09-25

## Status

Accepted. Supersedes [ADR 0007](0007-running-claude-code.md). Changes how the agents of
[ADR 0009](0009-guides-from-structured-output.md), [ADR 0010](0010-faster-guides.md) and
[ADR 0012](0012-wrap-up-and-action-items.md) are run, not what they do. Changes how
[ADR 0013](0013-auto-permission-mode.md)'s blocked tools are handled.

## Context

coxswain runs Claude Code two ways:

- **Agent sessions** (L4 and a round's questions): `claude -p --output-format stream-json`, one process per turn
  (ADR 0007).
- **One-shot runs** (guide summaries, grouping and descriptions; wrap-ups): `claude -p --output-format json
  --json-schema`, with `--tools ""`, `--system-prompt` replacing Claude Code's own, `--strict-mcp-config` and, for
  summaries, thinking off (ADR 0010's speed-ups).

Both parse Claude Code's private formats, and neither can ask the user to approve a tool: print mode only refuses, so
what auto mode blocks stays blocked (devlog tech debt). Both are Claude-only; Codex, which the glossary and G3 name,
would need a second copy of each. Every turn pays Claude Code's start-up.

The agent must use the user's own sign-in, so their subscription pays, with no API key in coxswain. Libraries that
call a model API directly (LangChain, the Vercel AI SDK) can't: they need an API key.

The **Agent Client Protocol** (ACP, from Zed) is JSON-RPC over stdio between an editor and a coding agent: create or
load a session, send a prompt, receive updates (text, tool calls, plans) as they stream, answer permission requests,
cancel. A session can be given MCP servers by the client. One agent process holds many sessions. Adapters exist for
Claude Code (`@agentclientprotocol/claude-agent-acp`, built on the Claude Agent SDK) and Codex
(`@zed-industries/codex-acp`); Gemini CLI speaks it natively. Each agent keeps its own sign-in and settings.

ACP has no structured output. The Claude adapter accepts Claude Agent SDK options in `session/new`'s
`_meta.claudeCode.options` (including `outputFormat`), but doesn't pass the structured result back to the client.

## Decision

1. **Every agent run is an ACP session.** The core is an ACP client (`@agentclientprotocol/sdk`) in
   `src/core/agents.ts`, and nothing else in the core starts an agent. An agent session in L4, a question, a guide
   step and a wrap-up differ only in the options their session is opened with.
2. **Structured answers come from an answer tool.** A run that needs one is given one MCP server by the core, over
   HTTP on localhost, with a single tool, `answer`, whose input schema is the answer's JSON schema. The prompt ends
   with "give your answer by calling `answer`". The core checks the arguments against the schema, returns an error to
   the agent if they don't fit (so it tries again), and ends the session with the first answer that fits. A run that
   ends without one fails, as a run without `structured_output` does today. This is how Claude Code's own
   `--json-schema` works inside, and any ACP agent with MCP support can do it.
3. **One adapter process per agent**, started when first needed and kept while the app runs; each run is a session in
   it. Guides' parallel runs are parallel sessions. A crashed adapter is started again and open sessions loaded.
4. **Agent options are data, in one place.** Each agent is a record: the command that starts its adapter, and a
   function from a run's options to its `session/new` parameters. The options are what coxswain means, not what an
   agent calls them: `model`, `tools: 'all' | 'read-only' | 'none'`, `instructions` (a system prompt), `thinking`,
   `persist`, `mode: 'auto' | 'ask'`. For Claude Code they become `_meta.claudeCode.options` (`tools`,
   `systemPrompt`, `strictMcpConfig`, `thinking`, `persistSession`) and its permission mode, which keeps ADR 0010's
   speed-ups. An agent that can't honour one falls back: `instructions` go in front of the prompt, `tools: 'none'` is
   enforced by rejecting every permission request.
5. **Claude Code through `claude-agent-acp`, pointed at the user's own `claude`**: the core finds `claude` on `PATH`
   and passes it as `CLAUDE_CODE_EXECUTABLE`, so the user's version, sign-in, settings, hooks and MCP servers are used,
   as ADR 0007 required. Without it the adapter would run the copy bundled with its SDK.
6. **The agent picks the session ID.** `session/new` returns it; the core stores it in
   `agent_sessions.agent_session_id`. For Claude Code it is still Claude Code's session ID, so sessions made before
   this ADR load by their stored ID. One-shot runs aren't stored and aren't persisted (`persist: false`), so they
   don't fill Claude Code's session list.
7. **History comes from `session/load`**, which replays the session as updates. The core stops reading
   `~/.claude/projects/` itself.
8. **Permission requests reach the user.** In L4 and a question's thread, `session/request_permission` becomes a
   prompt with the options the agent offers. L4 sessions run in auto mode (ADR 0013), so only what the classifier would
   block asks; questions run read-only. One-shot runs have no one to ask and reject every request.
9. **Chat entries are made from ACP updates**, not from Claude Code's message shapes. `ChatEntry` stays the UI's type.
10. **Codex is a second agent record** and a value of `agent_sessions.agent`, when we add it.

## Alternatives considered

- **Keep one-shot runs on `claude -p --json-schema`** and use ACP only for agent sessions. Simplest to build, but two
  ways to run Claude Code that drift apart, and guides and wrap-ups stay Claude-only.
- **Ask for JSON in the prompt and parse the last message.** No MCP server, but nothing makes the agent stick to the
  schema, and there's no way to tell it its answer didn't fit.
- **The adapter's `outputFormat` option.** Claude-only, and the adapter doesn't return the result; we'd depend on
  patching it.
- **The Claude Agent SDK directly**, with its `outputFormat` and `canUseTool`. Everything we need for Claude, in-process
  and typed, but Claude only; Codex would need its own runner. The ACP adapter is this SDK behind a protocol.
- **Our own `Agent` interface over per-agent runners** (`claude -p`, `codex exec`). A clean abstraction too, but ours
  to maintain per agent, with each agent's formats to parse. ACP is that interface, maintained by the agents' side.
- **LangChain, the Vercel AI SDK or our own agent loop.** Call a model API with an API key, so the user's subscription
  isn't used, and we'd rebuild the tools, context and settings Claude Code already has.

## Consequences

- One way to run an agent, for every use. A guide or wrap-up on Codex is a setting, not new code.
- The core runs a small HTTP MCP server on localhost for answer tools; it answers only the sessions it opened.
- Answers cost an extra tool call, and a malformed answer a retry, where `--json-schema` did this inside Claude Code.
- ADR 0010's speed-ups hold only for agents that honour `tools`, `instructions` and `thinking`. Guides on another
  agent may be slower; measure before relying on it.
- Two new dependencies. The Claude adapter pulls in the Claude Agent SDK, which bundles a Claude Code binary we don't
  use (install size). Both are pinned; the adapter is young and fast-moving.
- We depend on the adapter's behaviour and its `_meta` options instead of Claude Code's formats and flags.
- A long-lived adapter process to keep, restart and stop, the cost ADR 0007 avoided. In return, runs skip Claude
  Code's start-up after the first.
- L4 and question threads need a permission prompt.
