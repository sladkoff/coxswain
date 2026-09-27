# 26. Views are markdown, with mermaid diagrams and embedded file diffs

Date: 2026-09-27

## Status

Accepted

## Context

The user wants to see what's going on in a diff, not only read it file by file: its data model, how data flows
through it, or anything they ask the agent to show (#1). The canvas already showed one kind of agent-made view, the
guide ([ADR 0023](0023-guides-made-by-the-agent-pane.md)): file diffs in groups with a title, a description and a note
per file, as structured fields. That shape can't hold a diagram, a table or prose between two file diffs, and each new
kind of view would need new fields, tools and rendering.

What the agent writes needs to be something agents write well, safe to show (it's model output), and to degrade
gracefully when it's wrong. It must still embed file diffs as the user reviews them, with threads and _Reviewed_.

## Decision

1. **A view is a pinned range and a list of markdown sections** (`views` table: title, `guide` flag, base, head,
   sections as JSON). Each section starts with a `## ` heading, which is its entry in the table of contents.
   GitHub-flavoured markdown, rendered by `react-markdown` and `remark-gfm`, as in chat and threads.
2. **Fenced blocks are the extension points.** Their info string says what they are:
   - ` ```mermaid `: a diagram, drawn by [Mermaid](https://mermaid.js.org) (`mermaid`, loaded only when one shows),
     `securityLevel: "strict"`, in the system theme and redrawn when it changes. `write_section` has the window draw
     each diagram before saving the section (main asks the renderer over IPC, `setDiagramCheck`), and refuses it with
     mermaid's error if one doesn't draw, so the agent fixes it. One that still fails (e.g. saved while no window was
     open) shows its code and the error. Works wherever `Prose` renders, so also in chat and threads.
   - ` ```diff path=<file> ` (optionally `generated`): embeds that changed file's diff, the same Viewer as the live
     diff, with threads, explanations, findings and _Reviewed_. A file is embedded at most once per view. A ` ```diff `
     block without `path=` stays an ordinary code block.
3. **The core parses sections** (`parseSection` in `src/core/views.ts`) into prose and diff parts; the UI only
   renders them. The tools check every embedded path against the view's range.
4. **A guide is a view with `guide` set:** it goes through every changed file, and the files no section embeds show
   after it under _Not in the guide_. Other views show only what they embed.
5. **Tools:** `start_view` (title, guide) and `write_section` (append, or replace section N) replace `start_guide` and
   `add_group`; `add_explanation` and `add_finding` stay. `start_view`'s result carries the syntax and how to write a
   guide or another view.

## Alternatives considered

- **MDX** (markdown with JSX components such as `<FileDiff path=…/>`). More flexible, but the agent's text would be
  compiled and run in the renderer, and one broken tag breaks the whole view. Fences can't run code, and a fence the
  renderer doesn't know still shows as code.
- **Keep guides as structured groups and add view kinds beside them.** Every new kind of view would need its own
  fields, tools and rendering; markdown sections cover guides and the rest with one of each.
- **Graphviz or D2 for diagrams.** Mermaid covers the diagrams asked for (ER and class diagrams for data models,
  flowcharts and sequence diagrams for data flow), agents know it best, and it runs in the browser without a
  WebAssembly build. Another engine can be another fence later.
- **Interactive canvases (Excalidraw and the like).** Out of scope for now (#1).

## Consequences

- Mermaid adds about 1.2 MB to the renderer, in a chunk of its own loaded on the first diagram.
- The agent learns whether its diagrams draw, not how they look: the check can't tell a legible diagram from a
  cramped one.
- An embed shows a whole file diff; there's no way yet to embed only some of its lines.
- Guides made before this were turned into sections by a migration (title, description, then each file's note and
  its fence, generated groups last).
