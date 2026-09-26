# 14. Reviewed belongs to a file diff's contents

Date: 2026-09-25

## Status

Accepted

## Context

The canvas shows file diffs from different ranges: the live diff (merge base → worktree), a guide pinned to the
PR head it was made at ([ADR 0023](0023-guides-made-by-the-agent-pane.md)), and a commit diff. An agent's turn can
change dozens of files in the worktree. A file diff the user marked _Reviewed_ should stay reviewed exactly as long
as what they reviewed is unchanged, in whichever range it shows up.

## Decision

1. **Reviewed belongs to a file diff's contents**: a fingerprint of its old side (the range's base) and its new
   side's contents. For a pinned range the contents are read at its head (`git cat-file --batch`); for the live
   diff, from the worktree. A file with no local changes has the same fingerprint in both, so they agree.
2. **`reviewed_files` keeps one row per fingerprint**, so a pinned ✓ and a live one don't replace each other.
3. **A file diff that changes is no longer reviewed.** A new guide, or the live diff after a push, shows ✓ for
   every file diff that didn't change: same base, same contents, same fingerprint.

## Alternatives considered

- **Reviewed per guide**: a new guide would start with nothing reviewed, even for file diffs that didn't change.
- **Reviewed per path, marked "changed since reviewed"**: the mark survives changes the user never saw.

## Consequences

- A pinned guide and the live diff can disagree on a file with local changes: reviewed in one, not in the other.
- Rows for fingerprints no longer in use stay in `reviewed_files`.
- After a rebase the merge base changes, so nothing carries over.
