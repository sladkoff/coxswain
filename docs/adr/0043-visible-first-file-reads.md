# 0043 — Visible-first file reads and immutable content digests

## Status

Accepted.

## Context

Large PRs can schedule many file reads while review indicators repeatedly hash the same revision contents. Loading placeholders that collapse bring more cards into the lookahead margin and amplify this work.

## Decision

Keep pending card estimates in the renderer. Awaited content reads share one core-owned, four-slot priority queue: lookahead may occupy two slots, actual viewport reads three, explicit navigation four. Requests coalesce by worktree, revision and path and pending requests can be promoted. These are awaited reads, not background jobs, and do not alter persisted state.

Cache immutable content digests by worktree, revision, path and fingerprint kind in a bounded 20,000-entry LRU. Share pending paths across overlapping batches; retain digests rather than source buffers. Preserve stored fingerprint formats. Do not cache live worktree contents. Select changed-since-review candidates from baseline and review metadata before reading contents.

## Alternatives considered

- Smaller lookahead alone: does not prevent placeholder collapse or repeated hashing.
- Persist digests: git already owns revision contents; ephemeral derived state needs no database migration.
- Replace fingerprints with git blob IDs: changes the existing raw-content hash semantics.
- Window every file immediately: requires broader navigation, draft and Guide-layout work.

## Consequences

Navigation retains capacity during prefetch and repeated immutable reviews avoid git reads. Priority is scheduling state, not query identity. No dependency or schema change is required. Abandoned queued requests still finish; consumer cancellation/reference counting remains a follow-up. Cold batch buffering and synchronous bulk live reads remain separate costs. ADR 0044 covers file/sidebar windowing and worker diff parsing.
