# Skills for the agent pane

Skills the agent pane's agent reads with coxswain's `read_skill` tool while it makes a view
([ADR 0039](../../docs/adr/0039-skills-for-views.md)). Each folder is a skill copied in full, unchanged, from
[mattpocock/skills](https://github.com/mattpocock/skills) at d81f3a1 (2026-09-29), under its MIT license (`LICENSE`).
What each one is for in coxswain, and which parts of it apply, is in `src/core/skills.ts`, which the tool puts before
the skill's text.

| Skill           | Upstream path                      | Used for                                          |
| --------------- | ---------------------------------- | ------------------------------------------------- |
| `pr`            | `skills/engineering/pr`            | A view's overview: the change's shape, its danger |
| `code-review`   | `skills/engineering/code-review`   | Findings in a review: the Standards and Spec axes |
| `writing-beats` | `skills/in-progress/writing-beats` | The order of a view's sections: grounding         |

To update one, copy its folder from upstream again, leave out `agents/`, and note the commit here.
