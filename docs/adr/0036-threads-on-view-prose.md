# 36. Threads on a view's prose are anchored by quote, pinned to their section

Date: 2026-10-01

## Status

Accepted

## Context

A view (ADR 0026) is mostly the agent's prose: what a change does, a diagram, a table. The user wants to question or
correct it where it's written (#28), as they do on code lines, and have the agent answer in the thread or rewrite the
section. Entries were anchored only to line ranges of files (ADR 0015). Prose has no line numbers the reader sees, is
rendered from markdown, and changes only when the agent replaces a section with `write_section`.

## Decision

1. **An entry on prose is anchored to a passage of a view section**: its view (`entries.view_id`, so it's shown only
   with its view and deleted with it), its section (`entries.section`, 0-based), the text picked (`code`, its quote)
   and where the quote starts in the section's text (`entries.quote_at`). No `path`.
2. **The section's text is what the canvas renders**: its prose's text nodes in order, leaving out mermaid diagrams
   (drawn late) and the threads shown in it. Taking the quote from the rendered text, not the markdown, lets the user
   pick what they read; the offset tells one "the" from another. If the text at the offset isn't the quote (the
   renderer changed), the first place that reads the same is used.
3. **Its revision is its section's version**: a SHA-1 of the section's markdown. Current while the section is
   unchanged; outdated once `write_section` replaces it. No line following: a view is pinned, and a section changes
   whole. Worked out in `listEntries`, like line anchors.
4. **Shown after the block the quote ends in**: a rehype step in `Prose` marks each top-level block (paragraph, list,
   table, diagram) `data-block` and renders what `ProseThreads` puts after it, so threads sit in the React tree with
   no DOM surgery. The quote is highlighted with the CSS Custom Highlight API (`::highlight(prose-quote)`), which
   leaves the DOM and the selection alone. Outdated threads, and any whose quote isn't found, show at the top of the
   section.
5. **Started from a native context menu**: right-click on selected prose (or on a block, for all of it) offers
   _Comment_ (and _Copy_). The same comment box, _Comment_ / _Agent_ toggle, thread and _Submit Review_ as on lines.
6. **The agent reads it as** "this passage of section N of view V (see list_views)" with the quote, numbering sections
   as its view tools do, so it can answer or `write_section` the section.

## Alternatives considered

- **Offsets into the markdown source.** The user selects rendered text; mapping it back through react-markdown is
  lossy (links, emphasis, tables), and any renderer change would move every anchor.
- **Quote with prefix and suffix, found by fuzzy search** (W3C text quote selector, as Hypothesis does). Built for
  documents that change under the anchor; a view's section only changes whole, so an exact version is simpler and
  never misplaces a thread.
- **Whole-section comments only.** No selection or highlight to build, but too coarse for "this sentence is wrong".
- **Portals into containers inserted after the block in the DOM.** Works, but React doesn't own those nodes and
  re-renders can reorder them.

## Consequences

- Rewriting a section makes all its threads outdated, even on sentences that stayed the same.
- The agent can't write explanations or findings on prose; only the user starts these threads.
- A quote that spans blocks is shown after the last one; its highlight covers any thread between them.
