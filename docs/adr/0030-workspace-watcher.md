# 30. The core keeps the workspace on screen fresh

Date: 2026-09-28, revised 2026-10-03

## Status

Accepted

## Context

Summaries are made ahead for a workspace's committed changes ([ADR 0029](0029-file-summaries-and-activity.md)), and
the canvas, the Commits pane, the PR panel and the review threads mirrored from GitHub
([ADR 0037](0037-pull-request-sync-and-posting.md)) all show what a workspace is on, locally and on GitHub. Any of it
can change without coxswain doing anything: a commit, pull or reset in a terminal, a push by an agent, a new commit,
comment or check run on GitHub.

GitHub used to be checked by the UI: the worktree check (`openWorktree`, which asks GitHub for the PR's head, fetches
and fast-forwards) and the PR read (which mirrors review threads into entries) were TanStack queries refetched on an
interval and on window focus. That left the UI deciding when the core talks to GitHub (against
[ADR 0038](0038-background-jobs-and-core-events.md)), made two reads with side effects run whenever the query cache
saw fit, missed pushes made by an agent or a terminal for up to two minutes, and missed window focus altogether
(TanStack listens for the page being hidden, which a window behind another isn't).

## Decision

1. **The core watches the workspace on screen** (`src/core/watch.ts`); the UI says which one shows, one at a time.
   Every 3 s it reads two refs in git: HEAD, and the branch's `origin/` ref.
   - **HEAD moving** (a commit, a pull, a reset, in coxswain or not) is a change to the worktree: the core emits
     `worktree`, the UI refetches what depends on it ([ADR 0017](0017-data-fetching-with-tanstack-query.md)), and it's
     summarised ahead.
   - **The `origin/` ref moving** without a check having moved it is a push, from coxswain, an agent or a terminal:
     GitHub is checked at once.
   - Uncommitted edits aren't watched: they aren't summarised (ADR 0029), and refetching the diff on each would redraw
     it every few seconds while an agent edits. The worktree is reread when an agent turn ends and when the window gets
     focus (the main process's `focus` event), so edits made in an editor or a terminal show on coming back.
2. **The core checks GitHub** for the workspace on screen: when it starts to show (unless checked in the last 10 s),
   every minute, on a push (above), when the window gets focus (unless checked in the last 10 s), and right after
   coxswain changed something there (push, open a PR, post a review, a change in the PR panel). A check fetches and
   fast-forwards a worktree without local changes, reads the PR and mirrors its review threads into entries. It keeps
   what it found; when that differs from the check before, it emits `github`, and `entries` if threads changed.
   Offline or signed out, it keeps the last good result, with a notice saying GitHub couldn't be checked.
3. **The UI's reads of it are pure.** `openWorktree` and `readPullRequest` return what the last check found, at once,
   or wait for the first check when there's none yet. The UI refetches them on `github`. It holds no interval and no
   focus handler for the workspace's data.
4. **Activity counts the workspace on screen:** how many of its committed file diffs have a summary, as of its HEAD,
   counted when the list opens and again when a job starts or ends.

## Alternatives considered

- **Polling GitHub from the UI** (the earlier version of this ADR): `openWorktree` and `readPullRequest` as queries
  refetched on an interval. Polling from the core was rejected then because the UI's query would still ask GitHub on
  its own, asking twice. With the UI's reads only reading what the core found, that objection is gone, and ADR 0038
  has since said the UI holds no timers for the core's work.
- **File system events** (`fs.watch` on the worktree's git directory). No polling, but a commit changes files in two
  git directories (the worktree's and the clone's refs), and the events differ by platform. Two git commands every
  3 s for one workspace cost next to nothing; events can come later as a hint that makes a look run sooner.
- **Checking GitHub after every agent turn.** Catches an agent's push, but costs a GitHub call per turn, and misses a
  push from a terminal; the `origin/` ref catches both for free.
- **A sync state in the canvas bar** (commits behind and ahead of GitHub, uncommitted files, when GitHub was checked).
  Built and taken out: a ✓ most of the time said little, and the Commits pane already marks local commits.

## Consequences

- Terminal commits, pulls and resets show within 3 s; a push from anywhere on this machine within 3 s plus a GitHub
  check; changes made on GitHub by others within a minute, or on coming back to the window.
- One `gh` call, a fetch and a PR read every minute while a workspace shows, whether or not the app has focus.
- What the checks found lives in memory: the first open after a restart waits for GitHub and the fetch (~2.5 s).
- The diff doesn't follow uncommitted edits made outside an agent turn until the window gets focus again.
