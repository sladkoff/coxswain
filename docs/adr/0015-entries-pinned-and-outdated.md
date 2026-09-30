# 15. Entries belong to their workspace, are pinned to a revision, and go outdated when their own lines change

Date: 2026-09-25, revised 2026-10-01 (#31)

## Status

Accepted

## Context

An entry (glossary) is anchored to lines: path, side, line range and the code as it was. The canvas shows code
from several ranges (the live diff, a pinned view, a commit diff), and the code moves on as the agent edits and
the PR gets pushes. A comment shown next to lines it is no longer about misleads; one marked outdated because the
range on screen is another, or because lines were added above it, misleads too.

## Decision

1. **An entry belongs to its workspace** (`entries.workspace_id`). The canvas lists all of the workspace's entries;
   there's no grouping into passes.
2. **An entry records the range it was written in** (`entries.base`, `entries.head`; head null: the live diff), which
   navigating to it opens, **and its revision** (`entries.revision`): the commit its side's code is at, the range's
   base for the old side and its head for the new, or a snapshot of the worktree on the live diff
   ([ADR 0028](0028-branch-workspaces-and-snapshots.md); HEAD itself when nothing is uncommitted). Revisions are kept
   from git gc under `refs/coxswain/revisions/`, so a force-push or rebase doesn't lose them.
3. **An entry follows its lines** with a line diff (Myers, `core/follow.ts`) from its revision to another version of
   the file: they're there if every one is kept and they're still together, wherever they moved.
4. **Current or outdated is judged once, against the live diff**: the worktree for the new side, the current merge
   base for the old. Outdated once its own lines change; an edit next to them, or lines added above, leave it
   current. The same whatever range is on screen. Worked out each time, not stored: an edit undone makes it current
   again. An entry without a revision (written on the live diff before revisions) is outdated. A reply or answer
   takes its thread's state.
5. **Where it shows is judged per range**: between the lines of any range that has its lines, unchanged, on that
   range's side, at the lines they moved to. The threads list says where the others were written (_in All_, _in
   abc1234_). A file diff's header says _N outdated_ for its outdated entries not between its lines, which opens them
   above it with their code then and what stands there now.
6. **Outdated entries stay open**: only the user resolves. _Hand off_ sends them with what their lines read now and a
   request to check whether each still applies.
7. The core works it all out (`listEntries` in `core/entries.ts`, with the merge base and the range on screen),
   reading each file once per version and each file at a commit once per session.

## Alternatives considered

- **Judge against the range on screen**, as before: a comment from _All_ read as outdated in a commit diff.
- **Exact text at the stored lines**, as before: lines added above made every comment below outdated.
- **Outdated when its hunk changes**: git regroups hunks as context shifts, so it would follow edits unrelated to
  the comment.
- **Judge against the PR's head on GitHub**: hides the agent's uncommitted edits, which are what the user waits to
  see; worth it once comments are posted to GitHub.
- **Outdated entries between the lines, marked**: they'd sit next to lines they're no longer about.

## Consequences

- A comment on removed lines goes outdated only when a rebase or a merge of the base branch changes them; lines put
  back in the worktree aren't noticed, and the user resolves it.
- A comment on lines a commit diff removes that the PR added earlier isn't at the merge base, so it reads as outdated
  at once; it shows in that commit diff still.
- Entries written on the live diff before revisions read as outdated, with no _Now_.
- Past 2000 edits between two versions the line diff gives up, and only the lines both versions start and end with
  count as kept (`ponytail:` in `core/follow.ts`).
- Every entry a workspace ever had is listed, and every revision kept; nothing archives old ones.
