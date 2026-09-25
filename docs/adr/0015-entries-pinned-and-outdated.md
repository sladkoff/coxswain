# 15. Entries record where they were written, and show only while their code is unchanged

Date: 2026-09-25

## Status

Accepted. Answers the open point of [ADR 0011](0011-review-rounds-and-entries.md) on what anchors a round to what
was reviewed, and changes what [ADR 0012](0012-wrap-up-and-action-items.md) shows after a wrap-up.

## Context

An entry stored its anchor (path, side, lines and the code as it was) but not which diff it was written in. Every
view (the live Diff tab, a pinned guide, a commit diff) matched the latest round's entries by path alone, and a
wrapped-up round kept showing until the next entry. After an agent implemented round 2's action items, a guide to
its commit showed round 2's notes on files whose code they were no longer about.

## Decision

1. **An entry records the range of the view it was written in**: `entries.base` and `entries.head` (null: the
   worktree, the live Diff tab). **A round records its first entry's**: `review_rounds.merge_base` and `head`.
   Neither decides anything yet beyond the prompts saying "as at commit abc1234"; they're kept because they can't
   be recovered later.
2. **An entry is current in a view while the lines at its anchor read exactly as its stored code**, on the side
   it's on in that view (the new side at the view's head or the worktree, the old side at its base). Otherwise it's
   **outdated** (glossary). No search for code that moved. A follow-up or answer takes its question's state.
3. **Only current entries go between the lines** and into the ✎ counts. A file diff's header says *N outdated*,
   which opens them above the file diff with the code they were about.
4. **A wrapped-up round's entries leave the views.** They live on in its action items and stay stored.
5. The core works the states out (`listEntries` with the view's base and head), reading each file once.

## Alternatives considered

- **Pin only the round**: wrong once one round has entries in a commit diff and in the full diff.
- **Find code that moved** and move the entry there: friendlier after lines are added above, but a heuristic that
  can land on the wrong copy of a line.
- **Outdated entries between the lines, marked**: they'd sit next to lines they're no longer about.

## Consequences

- An entry goes outdated as soon as a line in its range changes, even trivially, and when lines are added above it.
- The Round bar still counts all of the round's entries; the ✎ counts only the current ones.
- Entries from before have no range; the code check works for them the same.
