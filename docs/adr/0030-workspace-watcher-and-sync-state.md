# 30. The workspace on screen is watched, and shows its sync state

Date: 2026-09-28

## Status

Accepted

## Context

Summaries are made ahead for a workspace's committed changes ([ADR 0029](0029-file-summaries-and-activity.md)), but
coxswain noticed new commits only when it checked the worktree: on opening a workspace, on window focus after a
minute, and after its own agent turns. A commit made in a terminal, a pull or a reset went unseen until then, and so
did a push to the PR while the window had focus. Nothing on screen said whether the worktree was behind GitHub, had
commits not pushed, or had uncommitted files, or when GitHub was last asked.

## Decision

1. **The core watches the workspace on screen** (`src/core/watch.ts`): every 3 s it reads the worktree's HEAD and
   `git status`. HEAD moving is a change to the worktree: the UI refetches what depends on it (ADR 0017), and it's
   summarised ahead. Other changes to what's uncommitted only change the sync state; they don't refetch the diff, which
   an agent editing would otherwise do every few seconds, and they aren't summarised (ADR 0029). The UI says which
   workspace shows; one is watched at a time.
2. **GitHub is checked every 2 minutes** while a workspace shows, by the worktree check the UI already makes
   (`openWorktree`, as a query refetched on an interval, window in the background too), which fetches, fast-forwards a
   worktree without local changes, and summarises ahead. Each check is timed, and its problem kept.
3. **The sync state** (`readSyncState`): commits on GitHub's head the worktree hasn't (behind: not fast-forwarded
   because of local changes), commits not on it (ahead: not pushed; for a branch never pushed, every commit since the
   merge base), files with uncommitted changes, and when GitHub was last checked and why that failed. The canvas bar
   shows it before Activity: `↓2 ↑1 ●3`, or ✓.
4. **Activity counts the workspace on screen:** how many of its committed file diffs have a summary, as of its HEAD,
   counted when the list opens and again when a job starts or ends.

## Alternatives considered

- **File system events** (`fs.watch` on the worktree's git directory). No polling, but a commit changes files in two
  git directories (the worktree's and the clone's refs), editors and agents write many times a second, and the events
  differ by platform. Two git commands every 3 s for one workspace cost next to nothing; events can come later as a
  hint that makes a check run sooner.
- **Summarising uncommitted changes as they're seen.** Most of those contents are never shown in a view (ADR 0029).
- **The sync state in the Activity icon.** Activity is work coxswain does; whether the worktree is in sync is the
  workspace's state. One icon for both would say neither clearly.
- **Polling GitHub from the core.** The UI's worktree query would still check on its own and hold the head and merge
  base the canvas uses, so the core would have to tell it to refetch, asking GitHub twice.

## Consequences

- Terminal commits, pulls and resets show within seconds, and are summarised ahead.
- One `gh` call and a fetch every 2 minutes per window, while a workspace shows, whether or not the app has focus.
- The diff doesn't follow uncommitted edits made outside an agent turn until something else refetches it; the sync
  state's ● count does.
