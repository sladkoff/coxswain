# 12. Wrap up: a review round ends in action items drafted by an agent

Date: 2026-09-25

## Status

Accepted. Builds on [ADR 0011](0011-review-rounds-and-entries.md).

## Context

A review round is a stream of notes, questions and answers. What to do about it isn't the notes
alone: a decision can sit in an answer, two notes can say one thing, and a question may have led
nowhere. The user wants one step at the end of a round that turns the stream into things to do,
which can then be handed to an agent or posted for a collaborator.

## Decision

1. **Wrap up** (glossary) is a button on the round's bar at the bottom of the Viewer. It sends the
   round's whole stream, numbered, with each anchor's code, to one `claude -p` with a JSON schema and
   no tools (as guides do, ADR 0010), which answers with action items, each citing the entries it
   came from by number.
2. **Action items are their own table**, `action_items`: text, position, the entries they came from
   (`entry_ids`, JSON), and an anchor copied from the first cited entry that has one (an answer's or
   follow-up's is its question's). Not notes: notes are what the user wrote, and stay so.
3. **Wrapping up ends the round** (`review_rounds.ended_at`). The next note or question starts a new
   round. Wrapping up again replaces the round's action items.
4. **The draft is editable**: the user edits an item's text or deletes it. Handing off (implement,
   post) is the next step, not in this one.
5. **A fresh call, not the round's agent session.** The stream in the prompt already holds every
   question and answer, a round may have no questions (so no session), and a schema-bound call can't
   add to a chat session's transcript.

## Alternatives considered

- **Resuming the round's agent session** for the wrap-up: it was there for the questions, but not for
  the notes, and mixing a structured answer into that session gains little over the stream itself.
- **Action items as notes** (a kind of entry): loses the line between what the user said and what the
  agent concluded.
- **Notes are the action items** (no wrap up): leaves decisions in answers undone.

## Consequences

- Only the latest round shows, in the diff and on the bar: once a new round starts, the earlier one's
  entries and action items aren't reachable in the UI until rounds get a history.
- The wrap-up uses Claude Code's default model. Its prompt is fixed, not in Settings.
- A round doesn't go stale by itself when the code changes; wrapping up is the only way to end it.
