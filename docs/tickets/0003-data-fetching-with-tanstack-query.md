# 3. Data fetching with TanStack Query

## Status

Done.

## Goal

G1, G2 ([GOALS.md](../GOALS.md)): the app feels instant.

## What

Switching between workspaces, tabs and files shows what was there at once, without panes flashing empty, and
refreshes behind it. After an agent turn, an answered question or a finished guide, every pane that shows the
changed data updates by itself.

## Notes

- [ADR 0017](../adr/0017-data-fetching-with-tanstack-query.md).
- Add `@tanstack/react-query`, pinned. One `QueryClient` in `main.tsx`.
- A key helper per core call (`keys.listEntries(workspaceId, base, head)`), so keys live in one place.
- Core side: send `changed` with `{ workspaceId, what }` from `src/main/index.ts` where a turn ends
  (`agents:run-turn`, `review:ask`), a guide group is described, and a round is wrapped up. Add
  `onChanged` to the preload.
- Remove the `version` prop (`App.tsx`, `Viewer.tsx`) and the reload callbacks (`onTurnEnd`, `onSent`) once their
  queries invalidate from `changed`.
- GitHub queries: `staleTime` a minute and refetch on window focus; that answers devlog debt "PR data loads once per
  workspace and never refreshes".
- The Navigator's tree remounts on a new array (`ponytail:` in `Navigator.tsx`); make sure a refetch with the same
  data keeps the same array (TanStack's structural sharing does) so the tree doesn't lose its state.
- Can be done pane by pane; start with the review round (entries, round, action items), which has the most reloads.
