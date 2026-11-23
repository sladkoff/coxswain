# 23. One Guide per workspace

## Status

Accepted

## Context

The Guide explains changes beside their code. Multiple saved documents with repeated Guide titles make updates ambiguous and add navigation that the reading workflow does not need.

## Decision

Each workspace has one Guide with a stable identity and one durable Guide session in the right Chat sidebar. Opening a workspace, worktree/GitHub changes and explicit Update Guide requests route through core events to that session. All turns use the standard ACP `runTurn` queue, transcript, permission requests and Stop controls (ADR 0018); Guide generation never calls `askOnce` or creates a `JobSpec`. The binding `guides.session.<workspace>` persists in SQLite settings and is resumed across restarts. Automatic updates retain that session even if other Chat sessions are opened; they do not change the user’s selected conversation. Manual requests and retries also leave Chat visibility and selection unchanged. Only the explicit View session action opens/selects the Guide conversation.

Guide agent/model/effort defaults are configurable in Settings and remembered per agent. Defaults select the first session’s provider and each update’s model/effort. A session’s provider is immutable: only an explicit manual agent override creates and binds a replacement Guide session. Model/effort overrides apply to that turn, restoring the session’s previous choices afterwards without changing the composer’s saved preferences. Without an explicit Guide choice, use Claude Code/Opus; retired summary preferences do not supply Guide defaults.

Update Guide opens a dialog for workspace focus/style instructions, persisted for later automatic updates. Instructions take precedence over app-wide default prompt customizations. The Guide session reads the repository and exact pinned diff; it has the normal workspace tools rather than bounded, tool-free evidence. The prompt requests `publish_guide` with a request ID and complete sections. The core validates file coverage and current snapshot before publishing atomically. The old Guide remains readable on failure or stale output. Interactive `start_guide`/section writes are rejected while a requested Guide turn is running, protecting the preceding document.

Preparation checks coalesce; while a Guide turn is active, newer requests coalesce into one follow-up in the same session instead of interrupting user conversation. Manual request ordering preserves the latest model/effort override. The Guide sidebar reports progress/failure and offers View session and Retry; Chat contains the detailed transcript. Run metadata persists in `guides.run.<workspace>`; an interrupted process does not appear to be actively generating after restart. An unchanged failed range waits for explicit Retry. Historical Guide job rows remain inert. Model/effort discovery may use temporary sessions for option discovery only; generation always uses the visible durable session.

The canvas offers Guide, Changes, Files and the PR overview. There is no saved View library, New View action, repeated Guide titles, View removal or saved View prompt library. Legacy rows remain inert in SQLite without a destructive migration; the latest existing Guide is adopted and subsequent updates reuse it. Internal `views`/`view_id` names remain storage details for compatibility with entries and history.

Agent tools `publish_guide`, `start_guide`, `write_section`, `remove_section`, `read_guide`, `list_changed_files`, `add_explanation` and `add_finding` write to the same workspace Guide. `start_guide` resets it for interactive writing; requested session updates use publish_guide atomically. Findings remain opt-in. Source/diff embedding uses ADR 0026; immutable snapshots preserve code and review marks (ADR 0028, ADR 0014).

Guide updates also assess open code comment/question/finding threads from the pinned snapshot. The request captures each full conversation. `publish_guide` accepts optional verified resolutions with a short summary; only captured, unchanged, still-open threads in that workspace qualify. Invalid/duplicate IDs and empty summaries reject publication, and stale snapshots cannot publish. Automatic resolutions remain local pending Submit Review, regardless of Post to GitHub; the generated explanation is never posted as a comment. Reopening clears it. The summary lives on the root entry in SQLite and follows existing entry invalidation events. This serves G3/G4 without an additional runner.

## Alternatives considered

- Keep numbered Guide versions in the navigation: obscures which document is current.
- Delete old records through a migration: unnecessarily removes historic entry anchors.
- Disposable tool-free background Guide sessions: hide the conversation and prevent automatic updates from sharing the user-visible session.

## Consequences

A Guide update changes its content and pinned range while preserving its identity. File review marks remain keyed to contents. Legacy documents and saved prompts are no longer exposed in the UI. Custom focus applies to later automatic updates until changed. The Guide session can inspect the repository directly; the former bounded diff-evidence shortcut is retired.

The default Guide prompt groups implementation thematically, followed by a dedicated Tests section and a dedicated Generated section, omitting empty groups. File group metadata uses the same shared path classifier as Changes.
