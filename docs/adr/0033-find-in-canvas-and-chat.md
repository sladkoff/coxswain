# 33. Find in the canvas and agent chat

Date: 2026-09-29

## Status

Accepted.

## Context

Issue #15 asks for ⌘F in diffs, views and the agent conversation. The canvas presents many file diffs as one
scrolling document, so Find must cross file boundaries. Pierre virtualizes lines and coxswain postpones reads for
files outside the viewport. A page-text search would miss these files and could mix canvas and chat results.

## Decision

1. **One Find bar for the last-used pane**, with independent in-memory queries for canvas and chat. Find,
   Find Next and Find Previous are registry actions reached through the native Edit menu and command palette.
2. **Canvas scope follows the content already selected.** Search the rendered range/view's file diffs and source
   embeds, in reading order, including off-screen files. A whole-file canvas searches that file. Hidden reviewed
   files are excluded; muted files remain included. A file diff searches changes and shown context, counting split
   context once. Collapsed unchanged lines join the results when expanded. View prose/diagrams are deferred.
3. **Targets register their searchable content and how to reveal a result.** File targets use the existing typed
   core reads through TanStack Query. Preparing at most four targets at a time bounds git work; superseded searches
   stop scheduling reads and cannot publish stale results. Search does not mount all off-screen viewers.
4. **Pierre remains read-only.** Its public post-render hook exposes the instance, and virtualized line positions
   allow an estimated jump before the matching text mounts. CSS Highlight ranges mark text inside its shadow root
   without replacing nodes or disturbing the line selection used for comments.
5. **Conversation search covers the selected session's rendered text.** It reveals clipped card/tool text and
   suspends automatic scrolling while Find is open. Streaming retains the current result when it still exists.
6. **Search is transient presentation state.** No database migration, additional storage or history entry per
   match. Switching workspace/content/session clears affected results. File failures are reported; binary files
   have no searchable code.

## Alternatives considered

- **Find only in one file diff.** Simpler, but the file boundary is surprising in the scrolling canvas.
- **Electron findInPage.** No element-scoped target and cannot provide complete results for unmounted code.
- **Mount every viewer before searching.** Defeats lazy rendering and queues too many reads on large changes.
- **Enable Pierre's editor search.** Couples a read-only feature to edit sessions and still lacks canvas/chat scope.
- **Repository-wide indexing or ripgrep.** Useful for another feature; this search follows selected revisions and
  view embeds, using contents the existing core already serves.

## Consequences

- No new dependency or file-reading API. An uncached large canvas can take time to search; the bar says Searching
  until its results are ready. Already-started core reads finish and populate the cache after a query changes.
- Pierre integration is isolated in `code-find.ts`; its public line metadata drives ordering and navigation, while
  shadow-root selectors locate rendered text for highlights. Revisit those selectors on Pierre upgrades.
- Read-only view prose, diagrams and searching other agent sessions remain outside this scope.
