# 45. Optional implementation connections

## Status

Accepted.

## Context

Review agents leave files unchanged by default. Users may delegate implementation to an external tool and inspect its existing threads from coxswain. Choosing that tool is a Settings preference, not a fixed provider in the review prompt. External conversations and credentials already have an owner (ADR 0005).

## Decision

- Settings → Connections explicitly connects or disconnects supported implementation providers. Providers live behind one core interface for checking access, listing threads, reading a thread and sending a follow-up. Amp is the first provider.
- Persist only the connection's enabled flag in SQLite settings, with no migration. Connecting checks read access using the provider's existing CLI sign-in; a failed check leaves the preference unchanged. Every settings write emits the normal settings event.
- Generic MCP tools discover only enabled connections and perform list/read/send operations. Each invocation checks the persisted preference, so disconnect blocks future calls even from an already-open session. Stable tool names allow connecting without restarting a review session. Provider-neutral instructions tell the reviewer to discover connections, offer only connected tools and send work only on explicit user request. Without a connection, it prepares implementation instructions.
- Amp uses its installed CLI: `threads list --json`, `threads markdown` and `threads continue --orb-execute --execute=<message>`. Existing thread IDs/URLs are validated. Messages travel literally as one explicit `--execute=<message>` argument, without a shell. Stdin closes immediately so interactive CLI/MCP startup cannot consume the prompt. The prompt is consequently visible in local process arguments while the command runs. Sign-in and transcripts remain Amp-owned; coxswain stores neither. Sends submit to the selected thread’s existing remote executor, which can run tools and edit files in its own working directory. The CLI never claims a local executor or starts local work as a fallback. A matching thread URL acknowledges submission; the tool returns `submitted` with `completed: false`, and the reviewer reads the thread again to check progress/results. A missing acknowledgment is uncertain delivery, not success. CLI calls have bounded output and timeouts; a timed-out send must be checked in the thread before retrying. Disconnect does not undo work already sent.
- Review sessions continue to use ACP (ADR 0018). Implementation connections operate existing external threads; they are not selectable review-session providers. There is no automatic forwarding, new-thread creation or alternate background runner.

## Alternatives considered

- Naming Amp in the shared system prompt: suggests an unavailable provider and prevents user choice.
- Making Amp another review-session agent: conflates the review role with external implementation and requires a separate ACP adapter.
- Copying credentials or transcripts into coxswain: duplicates provider-owned data.
- Arbitrary shell templates: unnecessary quoting and command-injection risk for a typed provider interface.

## Consequences

Connection preferences are app-wide; the agent must select a thread relevant to the workspace and check its context before sending. External thread operations can fail after sign-out or CLI changes, and the provider's own permissions still govern implementation. Adding a provider extends the core registry without changing the review policy or generic tools. Review instructions prohibit direct implementation, including reverts/cleanup, and Claude disables native file-edit tools. Shell inspection remains available; this is not a filesystem sandbox. Existing external work can continue after a disconnect.

CLI failures are classified from bounded diagnostics into service authorization, unsupported options, authentication, thread access or unknown failure. Raw diagnostics and authorization URLs are not returned to the agent. Unknown failures do not assert a sign-in cause or claim the message never ran.
