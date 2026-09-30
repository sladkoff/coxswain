# 30. The workspace on screen is watched for commits

Date: 2026-09-28

## Status

Accepted

## Context

Summaries are made ahead for a workspace's committed changes ([ADR 0029](0029-file-summaries-and-activity.md)), but
coxswain noticed new commits only when it checked the worktree: on opening a workspace, on window focus after a
minute, and after its own agent turns. A commit made in a terminal, a pull or a reset went unseen until then, and so
did a push to the PR while the window had focus.

## Decision

1. **The core watches the HEAD of the workspace on screen** (`src/core/watch.ts`) every 3 s. HEAD moving is a change
   to the worktree: the UI refetches what depends on it (ADR 0017), and it's summarised ahead. Uncommitted edits aren't
   watched: they aren't summarised (ADR 0029), and refetching the diff on each would redraw it every few seconds while
   an agent edits. Instead the UI rereads the worktree when its window gets focus, so edits made in an editor or a
   terminal show on coming back. The UI says which workspace shows; one is watched at a time.
2. **GitHub is checked every 2 minutes** while a workspace shows, by the worktree check the UI already makes
   (`openWorktree`, as a query refetched on an interval, window in the background too), which fetches, fast-forwards a
   worktree without local changes, and summarises ahead.
3. **Activity counts the workspace on screen:** how many of its committed file diffs have a summary, as of its HEAD,
   counted when the list opens and again when a job starts or ends.

## Alternatives considered

- **File system events** (`fs.watch` on the worktree's git directory). No polling, but a commit changes files in two
  git directories (the worktree's and the clone's refs), and the events differ by platform. One git command every 3 s
  for one workspace costs next to nothing; events can come later as a hint that makes a check run sooner.
- **A sync state in the canvas bar** (commits behind and ahead of GitHub, uncommitted files, when GitHub was checked).
  Built and taken out: a ✓ most of the time said little, and the Commits pane already marks local commits.
- **Polling GitHub from the core.** The UI's worktree query would still check on its own and hold the head and merge
  base the canvas uses, so the core would have to tell it to refetch, asking GitHub twice.

## Consequences

- Terminal commits, pulls and resets show within seconds, and are summarised ahead.
- One `gh` call and a fetch every 2 minutes per window, while a workspace shows, whether or not the app has focus.
- The diff doesn't follow uncommitted edits made outside an agent turn until something else refetches it.
