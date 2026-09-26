# 15. Entries belong to their workspace, record where they were written, and show only while their code is unchanged

Date: 2026-09-25

## Status

Accepted

## Context

An entry (glossary) is anchored to lines: path, side, line range and the code as it was. The canvas shows code
from several ranges (the live diff, a pinned guide, a commit diff), and the code moves on as the agent edits and
the PR gets pushes. A comment shown next to lines it is no longer about misleads.

## Decision

1. **An entry belongs to its workspace** (`entries.workspace_id`). The canvas shows all of the workspace's
   entries, current or outdated; there's no grouping into passes.
2. **An entry records the range of the view it was written in**: `entries.base` and `entries.head` (null: the
   worktree, the live diff). Nothing decides on them yet beyond the prompts saying "as at commit abc1234"; they're
   kept because they can't be recovered later.
3. **An entry is current in a view while the lines at its anchor read exactly as its stored code**, on the side
   it's on in that view (the new side at the view's head or the worktree, the old side at its base). Otherwise it's
   **outdated** (glossary). No search for code that moved. A reply or answer takes its thread's state.
4. **Only current entries go between the lines** and into the ✎ counts. A file diff's header says _N outdated_,
   which opens them above the file diff with the code they were about.
5. The core works the states out (`listEntries` with the view's base and head), reading each file once.

## Alternatives considered

- **Find code that moved** and move the entry there: friendlier after lines are added above, but a heuristic that
  can land on the wrong copy of a line.
- **Outdated entries between the lines, marked**: they'd sit next to lines they're no longer about.
- **Group entries into review rounds** with a wrap-up: the agent already sees every comment sent to it and acts
  on it, so rounds only added steps.

## Consequences

- An entry goes outdated as soon as a line in its range changes, even trivially, and when lines are added above it.
- Every entry a workspace ever had is listed; nothing archives old ones.
