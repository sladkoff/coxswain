# 3. Diff view, file view and file tree

Date: 2026-09-23

## Status

Accepted

## Context

coxswain is review-first ([ADR 0002](0002-standalone-electron-app.md)). Its main screen shows
many diffs at once, with comment threads between the lines and agent changes arriving live. PRs
and agent diffs can be large, and the review screen must stay fast regardless of their size.

People also need to explore the repository: browse a file tree and open any file. Full editing and
code navigation (go to definition, hover, find references) matter less. They can come later.

ADR 0002 requires that all file, git and language work runs in the core, behind the typed
interface between the UI and the core. It left the diff component for a later ADR; this one
settles it.

## Decision

We use the Pierre libraries for the review screen and for file exploration:

- **Diff and file view: `@pierre/diffs`.** It is built for review screens at any scale: it only
  renders what is on screen, highlights code in background workers, and renders even huge diffs
  quickly. It supports split or unified layouts, line comments and annotations, accepting or
  rejecting individual changes, and merge conflicts. We also use it to show whole files, not only
  diffs.
- **File tree: `@pierre/trees`**, which is built for trees of about a million entries. The core
  watches files with `@parcel/watcher`.
- **Search across files: `@vscode/ripgrep`**, run in the core.

**Code navigation is by name, for now.** Go to Definition uses `@pierre/diffs`' token callbacks
(hover and click on a word) and asks the core, which runs `git grep` over the worktree and keeps the
lines that read as a definition (a keyword such as `function`, `class`, `def` or `fn` before the
name). Find Usages is the same `git grep` without that filter. It finds every definition of a name, not the one in scope, and only in the worktree: the clone
is blobless, so grepping a commit would fetch every blob. When that isn't good enough, language
servers run in the core, and `@pierre/diffs` ships a text document type compatible with VS Code's
language-server tools; that will be a new ADR. Hover and full editing are deferred;
the editing mode in `@pierre/diffs` is still in beta.

## Alternatives considered

- **CodeMirror 6** with `@codemirror/lsp-client` and `@codemirror/merge`. An official
  language-server client, and many instances are cheap. Rejected because code navigation is not a
  priority, and `@pierre/diffs` is purpose-built for the review screen, which is what matters most.
  CodeMirror remains the likely choice if we later need a full editor next to the review screen.
- **Monaco** (VS Code's editor) with `monaco-languageclient`. The strongest language-server support
  and VS Code's behaviour out of the box. Rejected because each editor is heavy, settings are
  global to the page, and inline comment threads are awkward, all of which works against many
  diffs on one screen.
- **`react-arborist`** for the file tree. Proven and virtualized. Rejected in favour of
  `@pierre/trees`, which is built for the same scale and matches the rest of the stack.
- **`react-diff-view` and `diff2html`.** Proven read-only renderers for `git diff` output.
  Rejected because they are less capable than `@pierre/diffs` for comments, large diffs and
  reviewing individual changes.
- **`@codingame/monaco-vscode-api` or Eclipse Theia.** Both give us large parts of VS Code for free.
  Rejected because they take control of the layout, and the review-first layout is why coxswain is
  a standalone app.

## Consequences

- We depend on young libraries. `@pierre/diffs` was first released in December 2025 and changes
  quickly, with possible breaking changes. `@pierre/trees` is still in beta. We pin exact versions
  and upgrade deliberately.
- coxswain starts without go to definition or full editing. People can explore and read any file;
  navigating code happens elsewhere until we add it.
- When we add code navigation, we either build our own language-server client on top of
  `@pierre/diffs`, or add CodeMirror as an editor view. That will be a new ADR.
- Because file watching, search and future language servers all live in the core, they work for a
  web version the same way they do for the app.
