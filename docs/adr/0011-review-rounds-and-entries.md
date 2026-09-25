# 11. Review rounds: one stream of entries per pass over a diff

Date: 2026-09-25

## Status

Accepted. Supersedes the `comments` table and comment threads of
[ADR 0005](0005-local-data-storage.md), and its rule that agent replies are only read from
transcripts, for answers; the rest of ADR 0005 stands.

## Context

A local comment did two jobs: a remark for the agent to act on, and, with *Ask agent*, a question
whose agent session streamed replies into its thread. Each question was its own agent session, so a
question on one file diff knew nothing of the one asked a file earlier. And "comment" also meant
GitHub's comments, which a collaborator reads, so the one word covered private remarks and public
ones.

Reviewing is a stream: you leave a note, ask about something, get an answer, move on, and the
questions build on each other. What to do about it comes after, from the whole stream.

## Decision

1. **A review round** (glossary) is one pass over a workspace's diff: `review_rounds`, one row per
   round, many per workspace. The latest is the current one; it's made with the workspace's first
   entry. Nothing starts a new one yet.
2. **Entries** are one table, `entries`, with `kind` *note*, *question* or *answer*. Each has an
   optional anchor (path, side, lines, the code as it was); without one it floats on the round,
   which the data allows though no UI makes one yet.
3. **Threads by parent**: a question's follow-ups and answers carry `parent_id`, the thread's first
   question. Deleting that question deletes the thread.
4. **One agent session per round for its questions** (`agent_sessions.review_round_id`), resumed
   for every question, so each question has the round's earlier ones in context. Such sessions
   aren't listed in L4.
5. **Answers are stored**: when a question's turn ends, the agent's text becomes an answer entry.
   The transcript mixes every question of the round and Claude Code's format isn't ours, so the
   stream can't be rebuilt from it. Tool calls show only while the turn runs.
6. **"Comment" means GitHub only.** A note is the user's; a comment is on GitHub; *post* turns notes
   into comments.
7. **Old comments are dropped**, with the agent sessions asked from them: this is a proof of concept.

## Alternatives considered

- **Notes and questions as separate things**, a question ending in a pinned note. Two kinds of
  object on the lines, and pinning is a step of its own. The stream holds both, and pinning, if
  needed, becomes a flag on an entry.
- **An agent session per question**, as before. No context between questions.
- **Reading answers from the transcript.** Needs parsing Claude Code's files per question inside a
  shared session, and breaks if the agent changes.

## Consequences

- One round's questions run one at a time: a second question while one runs is refused with
  *A turn is already running*.
- The round's agent session's context grows with every question. Fine for one pass; a new round
  starts fresh.
- Answers are copied from the agent, so a stopped or failed turn leaves no answer.
- Still open (glossary): what anchors a round to what was reviewed, when a new round starts, and how
  a round becomes action items. For now notes are the action items.
