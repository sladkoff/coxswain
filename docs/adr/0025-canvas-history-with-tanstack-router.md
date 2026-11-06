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
   workspace's entry opens that workspace again. The location chooses the workspace and its canvas together. SQLite's latest-opened workspace is only the
   startup/project default, and opening a location records that workspace in SQLite. Workspace tab switches restore the
   last location for that workspace; Back/Forward restore their exact entry. A saved Guide resolves directly to its immutable range while the live worktree/GitHub check proceeds; its entries and Reviewed marks are read at that pinned revision, so neither an empty live diff nor a network-loading screen flashes first. Live Changes waits for the actual worktree check.
3. **Scroll is ours, per entry.** A map from the entry's key to where the canvas was scrolled: a whole file by offset,
   the file diffs by the one at the top and how far into it. Restored on Back and Forward, then again until it holds,
   since Pierre's Virtualizer applies the fix-up it worked out for the old place after a jump. Workspace tab switches
   also restore the workspace's last scroll. When a saved reading position is restored, file/section/thread selection effects do not replay the original destination; a new explicit pick still takes over. Each new restoration cancels any previous restoration on the same canvas, including queued resize work. Pending restores are cancelled when navigation supersedes them or the reader uses the wheel, keyboard, pointer or touch input. Ready cached positions restore in a layout effect before paint. Guide, Changes and individual file surfaces keep separate scroll positions; returning from Settings restores the remounted canvas.
4. **The file diffs stay mounted** (hidden) while a whole file shows, so they keep their scroll and the files they read.
5. **A thread destination is a location too.** It selects the entry's view or recorded range and enables Show
   Reviewed Files before scrolling. Its Viewer loads even if offscreen and opens outdated threads when needed.
   Navigation waits for the mounted annotation, and cancels the wait when superseded. The Guide navigator independently reads the workspace’s current saved Guide and its review/thread state, so opening a recorded thread range does not remove its sections. Guide section/file picks clear that recorded range and select the current Guide. Without a saved Guide, the navigator lists the displayed range’s workspace threads.
6. **Section navigation is a location.** The Navigator defaults to Guide (`view: sections`) and also offers Changes and Files; `CanvasSearch.section` identifies a section anchor in the current view. Picks scroll below the toolbar; Back/Forward restores the saved position.
7. **The main process takes ⌥⌘←/→** in `before-input-event`, before the page: the file tree takes them otherwise. The
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

Closed workspace tabs persist in per-workspace SQLite settings. Startup waits for that preference before choosing open tabs; explicit reopening (including history navigation) clears the closed preference. Closing the active tab navigates to a neighboring open tab, or the empty workspace screen. Guide scroll and reading-marker memory remains per-window.

Visited Changes/Files sidebar trees remain mounted within the current workspace, preserving expansion and scroll when switching Guide/Changes/Files. Switching workspaces releases these tree models; this is not an unbounded workspace cache.

Saved Guide workspace selections prepare their immutable range, entries, review state and first cards before committing navigation; this is a renderer query-cache read through the existing preload API, with no GitHub wait or separate background runner. A request sequence cancels obsolete switch completions. Previously read cards retain query-owned Pierre file identities and start from cache when remounted, avoiding lazy placeholder flashes.

Guide, Changes and Files retain separate mounted canvas surfaces within the active workspace. Inactive canvases preserve layout dimensions and Pierre instances using visibility/inert rather than display:none or unmounting. At most three surfaces live in this boundary; switching workspace releases them. A first visit stages visible pending code rows before presenting the destination, bounded to 30 animation frames so an error cannot trap navigation. Anchor/thread lookup is scoped to the requested canvas, and Find excludes visibility-hidden targets, since file/section ids can exist in both surfaces. Collapsed reviewed cards render their header without fetching offscreen contents.

Files records its ordered file tabs and last active file in CanvasSearch alongside the selected path/revision. Opening and closing tabs navigates the router, so Back/Forward includes tab changes and each workspace location retains its editor selection. This is per-window session state, with no SQLite or browser storage added. Only the active file Viewer is mounted inside the retained Files surface; query-cached file contents and existing per-file scroll restoration handle tab returns.
