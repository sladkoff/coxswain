# 1. Read a wrapped-up round's stream

## Status

Open.

## Goal

G3, G4 ([GOALS.md](../GOALS.md)).

## What

A wrapped-up review round's notes, questions and answers can be read again. The Round bar gets *Show round*
next to *Show action items*: the round's whole stream in order, each entry with where it points and its thread,
as the wrap-up read it. Earlier rounds too, not only the latest.

## Notes

- Since [ADR 0015](../adr/0015-entries-pinned-and-outdated.md) a wrapped-up round's entries leave the views and
  live on in its action items. A round whose wrap-up drafts none is then unreachable: #5311's round 3, one question
  on `db/migrations/20260925121520_wipe_legacy_pbc_data.sql` with a follow-up and the agent's four options for
  the wipe, wrapped up with 0 action items. It's all still in `entries` (round 3).
- The stream is what `formatStream` in `src/core/review.ts` builds for the wrap-up prompt; the UI needs the same
  entries, not the text.
- `getRound` and `listEntries` only return the latest round (`ponytail:` on `ReviewRound`); earlier rounds need a
  way in too, e.g. a menu of rounds on the bar.
- Answers UX open question 3 in part (where you see a round's whole stream, and earlier rounds with their action
  items). Maybe: a wrap-up with 0 action items shouldn't end the round, or should say the stream is kept.
- An action item could open the entries it came from (`entry_ids`) in the same place.
