# 19. Every round readable; a round resolves when its action items are done

Date: 2026-09-26

## Status

Accepted. Builds on [ADR 0012](0012-wrap-up-and-action-items.md) and
[ADR 0015](0015-entries-pinned-and-outdated.md). Answers [ticket 0001](../tickets/0001-read-a-wrapped-up-round.md).

## Context

Only the latest review round was reachable: once wrapped up, its entries left the views, and a new round hid it
from the bar. A round whose wrap-up drafted no action items was lost altogether. There was also no way to say the
work from a round was done, so the loop (review, hand off, look at the result in a new round) had no end. And the
hand-off went only to L4, while the user often works with their own agent outside coxswain.

## Decision

1. **The core lists every round of a workspace** (`listRounds`), oldest first, each with its whole stream of entries
   and its action items. It replaces `getRound`. The Round bar steps through them (‹ ›) and *Show round* opens the
   selected one: its action items, then its stream, questions with their threads. The diff still shows only the
   latest round's entries while they're current (ADR 0015).
2. **An action item can be ticked done** (`action_items.done_at`). A round is **resolved** once it's wrapped up and
   all its action items are done, so a round with none is resolved when wrapped up. Resolved is derived, not
   stored: unticking an item reopens the round, and wrapping up again (which replaces the items) does too.
3. **Wrap up takes a round**, not a workspace, so an earlier round can be wrapped up again.
4. **Copy as prompt** puts the hand-off prompt of the selected round (its open action items and its stream, as sent
   to L4) on the clipboard, for an agent outside coxswain. Done items are left out of every hand-off. The core
   builds the text; the main process writes the clipboard.
5. ***Post to PR*** is on the bar but not built yet.

## Alternatives considered

- **A stored `resolved_at` on the round** with its own button: two states to keep in step with the items, and a
  resolved round with open items would mean nothing.
- **A native menu of rounds** instead of ‹ ›: nicer with many rounds, but a PR rarely has more than a few.
- **The clipboard in the renderer** (`navigator.clipboard`): works, but the UI does no work of its own (ADR 0002).

## Consequences

- `listRounds` reads every entry of a workspace on each change to entries. Fine for dozens; page it if rounds grow.
- Wrapping up again loses which items were done.
- Nothing yet tells whether an item was actually addressed in the code; the user ticks it.
