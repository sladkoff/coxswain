# ADR 0031 — View prompts

## Status

Accepted.

## Context

_New View_ put a sentence of prose in the agent pane's composer. The built-in sentences were thin, the user couldn't
keep prompts of their own (a security review, questions for a PR's author), and a prompt filled the composer with
text the user had to read around to add what they wanted.

## Decision

1. **Built-in view prompts live in code** (`builtInPrompts`, `src/core/views.ts`), so they change with the app.
   How to write a view stays in `start_view`'s result; a prompt only says what the view is of.
2. **The user's own prompts are a table**, `prompts` (title, body), for every project: they are the user's, not a
   project's, and nobody else has them (ADR 0005). Added and deleted in Settings; not edited in place.
3. **A prompt is attached, not typed.** Picked from _New View_ (or ⌘K), it shows as a card on the composer; what the
   user types is sent with it as its focus. The message is `[View · <title>]`, the note, `---`, then the prompt, like
   comments and reviews (ADR 0023), so the chat shows it as a card and the agent knows the note from the prompt.

## Alternatives considered

- **Built-ins in the table, seeded by a migration**: the user could edit them, but improved built-ins would never
  reach an existing database.
- **Per-project prompts**: a project-specific prompt is rarer than a personal one; add a project column if needed.
- **Filling the composer with the prompt's text**: what it was; the prompt drowned the user's own words.

## Consequences

- Changing a saved prompt means deleting and adding it again.
- The attached prompt can't be edited before sending; the note can steer it.
