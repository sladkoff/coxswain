# 17. Data fetching with TanStack Query and change events from the core

Date: 2026-09-25, revised 2026-10-03

## Status

Accepted.

## Context

The UI loads everything with `useEffect` and `useState` (51 `useEffect`s over 38 IPC calls). Nothing is cached:
switching workspaces or tabs refetches everything, and panes flash empty while they do. To reread after a change,
components bump a `version` counter passed down as a prop (`App.tsx`, `Viewer.tsx`) or reload from a callback
(`onTurnEnd`, `onSent`). Each new place that changes data needs another counter or callback wired to every place that
shows it.

The data comes from four places: SQLite (projects, workspaces, entries, guides), git (diffs, files, commits),
GitHub (PRs), and the agents' own files (transcripts). All of it is reached through the core over IPC, on the same
machine.

The app should feel instant. A sync engine (Replicache, Zero, Electric, LiveStore) is the usual answer for that in web
apps.

## Decision

1. **TanStack Query in the renderer** for every read from the core. One `QueryClient` for the window. Query keys start
   with the core call's name and its arguments, e.g. `['listEntries', workspaceId, base, head]`.
2. **Every write in the core says what it changed**, whoever made it: the UI, an agent's tool, a background job, a
   check of GitHub. It emits a core event ([ADR 0038](0038-background-jobs-and-core-events.md)), which the main process
   sends to the window as `changed`: what changed and, for a change in a workspace, which, e.g.
   `{ workspaceId, what: 'entries' }`; or `{ what: 'settings' }` for one outside any. The UI never invalidates queries
   itself. Where a write is small and certain (Reviewed toggled, a new workspace selected at once), the UI may update
   the cache right away and put it back if the call fails; the core's event still follows.
3. **One map says what a change makes stale** (`affects` in `queries.ts`): for each kind of change, the reads it
   affects, in the workspace it happened in, or in all of them for a change outside one or for a read keyed by
   something else (the sidebar's PR titles). A new read or a new write updates the map, not the screens.
4. **Streams stay events.** The core's versioned agent-session snapshots arrive through `agents:state`, coalesced
   over 16 ms, and update the query cache for every session, even when its pane is absent. A delayed query response
   cannot overwrite a newer revision. Inline question replies keep their own events; `changed` still follows when
   a turn ends. Session state is read once on attachment if absent from the cache; it needs no transcript replay on
   pane remount ([ADR 0018](0018-agents-over-acp.md)).
5. **Freshness per source.** Every read from the core is stale at once, but refetched only on a `changed` event or
   when a pane mounts; the UI holds no intervals. How fresh the source is, is the core's business:
   - SQLite: at once, since every write emits.
   - The worktree of the workspace on screen: HEAD within 3 s; uncommitted edits when an agent turn ends and when the
     window gets focus ([ADR 0030](0030-workspace-watcher.md)).
   - GitHub, for the workspace on screen: checked by the core every minute, on window focus, on a push from this
     machine and after a change made from coxswain (ADR 0030).
   - GitHub, for the project's lists (the sidebar's PR titles, New Workspace's PRs): read by the UI, with a
     `staleTime` of a minute, refetched when the window gets focus. Focus is the window's `focus` and `blur`
     (`focusManager`), not TanStack's default of the page being hidden.
6. **A refetch never blanks what's shown.** A query whose key changes with what's listed keeps showing the last list
   until the new one is in (`placeholderData`); a GitHub read that fails offline or signed out keeps what it read
   before, whether the core keeps it (the workspace's) or the UI does (the project's lists).
7. **Nothing is persisted in the renderer.** The cache lives only while the window does (ADR 0005).

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
- Every write in the core has to emit. A missed one shows as stale data until the pane remounts; it's fixed in the
  core, where the write is, never with an invalidation in a screen.
- After launch, the sidebar shows PR numbers until GitHub answers with titles: nothing from GitHub is stored
  ([ADR 0005](0005-local-data-storage.md)).
- Query keys are a second place where core call names live; a key helper per call keeps them in one place.
- One more dependency in the renderer.
