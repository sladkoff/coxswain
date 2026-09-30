# 35. ts-pattern for branching on values

Date: 2026-10-01

## Status

Accepted.

## Context

Choosing between more than two outcomes was written as chained ternaries: which range the diff shows, a PR's icon
and colour, a thread's state in the bottom bar, a git status code. Formatted, each extra branch nests one level
deeper, and two chains that decide the same thing (the diff's range and what a new view covers) drifted apart.

## Decision

1. **More than two outcomes are a `match`** from [ts-pattern](https://github.com/gvergnaud/ts-pattern), pinned to an
   exact version: the value (or an object of the values it depends on) first, then one `.with` per case in order,
   and `.otherwise` for the rest. `P.nonNullable.select()` and friends narrow and hand over what the case needs.
2. **Two outcomes stay a ternary**, and a single `if` stays an `if`.
3. **One match decides one thing.** The diff's range and what a new view covers come from the same match
   (`shownRange` in `App.tsx`), so they can't disagree.

## Alternatives considered

- **Functions with early returns.** No dependency and just as flat, but each needs a name and a place, and nothing
  checks that the cases cover the input.
- **Lookup objects** (`{ all: "All", … }[scope]`). Kept where the key is already the whole decision, as in the Diff
  tab's label; they can't express conditions on more than one value.

## Consequences

- One small runtime dependency in the core and the UI.
- `.exhaustive()` makes the type checker demand every case of a union. None of the matches so far covers a union
  whole, so none uses it yet; one that does should.
