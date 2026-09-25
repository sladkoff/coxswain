# 17. Data fetching with TanStack Query and change events from the core

Date: 2026-09-25

## Status

Accepted.

## Context

The UI loads everything with `useEffect` and `useState` (51 `useEffect`s over 38 IPC calls). Nothing is cached:
switching workspaces or tabs refetches everything, and panes flash empty while they do. To reread after a change,
components bump a `version` counter passed down as a prop (`App.tsx`, `Viewer.tsx`) or reload from a callback
(`onTurnEnd`, `onSent`). Each new place that changes data needs another counter or callback wired to every place that
shows it.

The data comes from four places: SQLite (projects, workspaces, review rounds, guides), git (diffs, files, commits),
GitHub (PRs), and the agents' own files (transcripts). All of it is reached through the core over IPC, on the same
machine.

The app should feel instant. A sync engine (Replicache, Zero, Electric, LiveStore) is the usual answer for that in web
apps.

## Decision

1. **TanStack Query in the renderer** for every read from the core. One `QueryClient` for the window. Query keys start
   with the core call's name and its arguments, e.g. `['listEntries', workspaceId, base, head]`.
2. **Writes are mutations** that invalidate the queries they change when they succeed. Where a write is small and
   certain (a note added, viewed toggled), the cache is updated right away and put back if the call fails.
3. **The core says what changed.** When data changes outside a mutation from this window (an agent turn ends, a
   question is answered, a guide group is described, the worktree changes), the core sends one IPC event,
   `changed`, with the workspace and what changed, e.g. `{ workspaceId, what: 'entries' }`. The renderer maps it to
   `invalidateQueries`. This replaces the `version` counters and reload callbacks.
4. **Streams stay events.** Chat entries and guide progress still arrive through their own IPC events
   (`agents:entry`, `guides:progress`) and are shown as they arrive; `changed` follows when the turn or guide ends.
5. **Freshness per source.** Core data from SQLite and git: stale at once, but only refetched on a `changed` event or
   when a pane mounts. GitHub: a `staleTime` of a minute, refetched when the window gains focus. This is the polling of
   [ADR 0006](0006-github-integration.md) decision 7, done in the UI; ETags stay a core concern.
6. **Nothing is persisted in the renderer.** The cache lives only while the window does (ADR 0005).

## Alternatives considered

- **A sync engine.** Built for keeping a client in step with a remote server, offline, with conflicts to resolve.
  Here the "server" is the core one IPC call away, and most of the data (diffs, PRs, transcripts) isn't in a database
  a sync engine could replicate. It would need its own store and schema next to SQLite, against ADR 0005.
- **SWR.** Similar and smaller, but weaker mutations and invalidation by key prefix, which the `changed` events need.
- **Keep `useEffect` and add a small cache.** We'd end up writing invalidation, deduplication and keeping the old data
  on screen while refetching, which is what TanStack Query is.
- **Push every change's data** (the core sends new rows, not "what changed"). Saves a round trip, but the core has to
  know what each pane shows. A local IPC call costs about a millisecond.

## Consequences

- Switching back to a workspace or tab shows the cached data at once and refreshes behind it.
- The core has to send `changed` wherever it changes data on its own. A missed one shows as stale data until the pane
  remounts, never as wrong data after a mutation from the UI.
- Query keys are a second place where core call names live; a key helper per call keeps them in one place.
- One more dependency in the renderer.
