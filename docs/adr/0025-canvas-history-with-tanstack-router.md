# 25. The canvas's history with TanStack Router

Date: 2026-09-27

## Status

Accepted.

## Context

View > Back and Forward (⌥⌘← ⌥⌘→, and the chevrons in the canvas bar) step through what the canvas showed: whole
files, files picked in _Changes_, the _Changes_/_Files_ switch, commits, guides. What the canvas shows was React state spread over
`App.tsx` (the view, the opened file, the commit, the guide), and a hand-made history inferred steps from changes to it.
Each new thing the canvas can show had to be fitted in by hand, and nothing said which changes were steps.

Each step also has to come back scrolled where it was left, in large file diffs and files, which are virtualized and
drawn after they're read.

## Decision

1. **What the canvas shows is the location's search**, in TanStack Router (`@tanstack/react-router`, pinned) with
   memory history: `CanvasSearch` in `src/renderer/src/router.ts` (workspace, _Changes_/_Files_ switch, whole file and line,
   file picked in _Changes_, commit, view). There's one route; the canvas has no pages. Every change is a
   `navigate()`, so every change is an entry, and Back and Forward are `history.back()` and `history.forward()`.
2. **One history for the window, across workspaces.** Opening a workspace is an entry; Back or Forward to another
   workspace's entry opens that workspace again. The workspace shown still comes from SQLite (the latest opened); the
   location follows it.
3. **Scroll is ours, per entry.** A map from the entry's key to where the canvas was scrolled: a whole file by offset,
   the file diffs by the one at the top and how far into it. Restored on Back and Forward, then again until it holds,
   since Pierre's Virtualizer applies the fix-up it worked out for the old place after a jump.
4. **The file diffs stay mounted** (hidden) while a whole file shows, so they keep their scroll and the files they read.
5. **The main process takes ⌥⌘←/→** in `before-input-event`, before the page: the file tree takes them otherwise. The
   renderer tells it whether Back and Forward can go, to grey the menu items out.

## Alternatives considered

- **Our own history** (an array of steps and an index). Less code, but it inferred steps from state changes; that's
  what this replaces.
- **`@tanstack/history` alone.** Push, back, forward and `canGoBack`, without the router's typed search. The router is
  that plus typed state, and room for real routes if screens (Settings, Projects) move into it.
- **React Router (memory router).** Same routing; its scroll restoration covers only the window, not a pane.
- **Pierre's `Virtualizer.scrollTo`** (via `useVirtualizer()`) in place of setting the scroll. Tried: it lands where
  setting `scrollTop` does, since its next pass keeps a file diff from the old place steady all the same. A call to
  scroll to a file diff, upstream, would let the retry go.
- **`content-visibility: auto` on each file diff, without the Virtualizer.** The browser would keep the scroll steady
  itself, but every line of every file diff would be built and highlighted; not measured yet on a large PR.
- **The router's own scroll restoration.** It restores offsets once after a navigation, which lands wrong in the file
  diffs (the ones above grow once read) and in a whole file that isn't drawn yet.
- **Electron's history** (`webContents.navigationHistory` with hash URLs). Native back and forward, but it lives in
  the main process, and the renderer would still push every change as a URL: nothing over memory history.

## Consequences

- A new thing the canvas shows is a field of `CanvasSearch` and a `navigate()`; Back and Forward come with it.
- The history is gone on restart, like the rest of the canvas's state.
- Screens (Settings, Projects, New Workspace) are still `screen` state in `App.tsx`, outside the history.
- The scroll restore depends on the DOM: file diffs found by their `diff:<path>` id, and a retry against the
  Virtualizer. A change in Pierre's layout can break it quietly.
