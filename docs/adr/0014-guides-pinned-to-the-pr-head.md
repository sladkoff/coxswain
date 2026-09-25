# 14. A guide is pinned to the PR head it was made at, and Viewed to file diff contents

Date: 2026-09-25

## Status

Accepted. Changes how guides (ADR 0009, 0010) read the diff and how Viewed is stored.

## Context

A guide showed the live diff, merge base → worktree, and Viewed held only while a file's worktree contents
were unchanged. After an agent's turn changed 56 files, those files dropped to not viewed in the Guide, and the
guide itself gave no sign that the code had moved on. The user wants a guide to stay as it was made, and to be
told when it's stale. Local changes (an agent's edits, local commits) are out of scope for now.

## Decision

1. **A guide is pinned to a range of commits.** A guide to all changes covers the merge base → the PR head
   when it was made (`guides.head`, `guides.kind = 'all'`); a guide to one commit covers its parent → the commit
   (`kind = 'commit'`). The Guide reads its file diffs from that range, never from the worktree, so local changes
   don't show in it.
2. **A guide to all changes is stale when the PR head moves.** The Guide says so and offers *Regenerate*. A
   commit guide is never stale. Guides made before this have no head and still show the live diff.
3. **Viewed belongs to a file diff's contents**: the fingerprint of its old side (the range's base) and its new
   side's contents. For a pinned guide the contents are read at its head (`git cat-file --batch`); for the live
   Diff tab, from the worktree. A file with no local changes has the same fingerprint in both, so they agree.
   `viewed_files` keeps one row per fingerprint, so a pinned ✓ and a live one don't replace each other.
4. **A new guide carries Viewed over** for every file diff that didn't change since: same base, same contents,
   same fingerprint. File summaries use the same fingerprint, so they carry over too.

## Alternatives considered

- **Snapshots of the worktree** (`git stash create`) to pin local changes as well: not needed while local changes
  are out of scope.
- **Viewed per guide**: a new guide would start with nothing viewed, even for file diffs that didn't change.
- **Keep Viewed live, and mark files "changed since viewed"**: the guide still drifts.

## Consequences

- The Guide and the Diff tab can disagree on a file with local changes: viewed in one, not in the other.
- Rows for fingerprints no longer in use stay in `viewed_files`.
- After a rebase the merge base changes, so nothing carries over.
