# 34. Language servers for Go to Definition and Find Usages

Date: 2026-09-29

## Status

Accepted.

## Context

Go to Definition and Find Usages matched names with `git grep -w` and a regex per language (issue #16): every
same-named thing was listed, members (`workspace.id`) were never resolved, and only the worktree was searched, so a
name clicked on the old side of a file diff was looked up as the code is now. A reviewer clicks members more than
anything, and on both sides of a diff. Resolving names by scope and type is what a language's compiler does; writing
our own per language would be a type checker per language.

## Decision

1. **Real language servers over LSP, in the core.** `src/core/lsp.ts` starts a server over stdio with
   `vscode-languageserver-protocol` (JSON-RPC framing and typed messages, no editor), sends `initialize` and
   `didOpen`, then `textDocument/definition` or `textDocument/references`, and maps the locations to the lines the
   native picker already shows. No grep fallback: a file with no language server has neither action.
2. **One file per language, registered in one list.** A `LanguageServer` (`src/core/language-servers/`) says which
   file extensions it takes (and their LSP language IDs), how to start it, and which dependency folders it reads
   (e.g. `node_modules`). Adding a language is a new file there and a line in `languageServers`; the client, the
   checkouts and the UI don't change.
3. **Shipped, native servers, pinned.** TypeScript and JavaScript use TypeScript 7's own server, `tsc --lsp
--stdio`, the Go binary from `typescript`'s per-platform package, a dependency of the app. It's unpacked from the
   asar so it can be run. Python is next with pyrefly (a Rust binary, fetched from its GitHub release by version and
   checksum), not built yet.
4. **Every side of a file diff is a checkout.** A side is the worktree or a commit (the merge base, the head, a
   snapshot, a turn's before or after). The worktree, or a commit that is its current snapshot, is served in the
   worktree. Any other commit gets a detached, read-only `git worktree add --detach` in
   `~/coxswain/checkouts/<owner>/<name>/<sha>/`, with the worktree's dependency folders symlinked in. Results open at
   the same revision on the canvas.
5. **Servers start on first use and are few.** One per checkout and language, reused while it answers; the least
   recently used stops beyond `lspLimits.servers`, and the oldest checkouts of a repository are removed beyond
   `lspLimits.checkouts`. All stop when the app quits. Servers watch their files themselves (`tsc` does when the
   client doesn't register watchers), so agent edits are seen.

## Alternatives considered

- **Keep grep as a fallback.** Answers for every language, but with the wrong answers the servers exist to fix, and
  two behaviours for one action.
- **`typescript-language-server` or `vtsls`.** Wrap the old `tsserver` (Node) rather than TypeScript 7's native one.
- **`vscode-languageclient`, `monaco-languageclient`.** Need VS Code's or Monaco's API; we only need the protocol.
- **Our own resolvers on tree-sitter.** Scopes and imports only; members need types, i.e. a type checker per language.
- **SCIP indexes per commit.** Cover any revision without a checkout, but need a full build to index, per language.
- **A multi-language server** (efm-langserver, ctags-based). Linters or names only, no scope.
- **Only the worktree** (the head side). Leaves the old side of every file diff answering for code that isn't there.

## Consequences

- The app is about 26 MB bigger per platform (`tsc`), and each running server takes memory.
- A commit checkout costs one checkout's disk and, in a blobless clone, fetching that commit's files the first time.
- A commit checkout reads the worktree's dependencies, not the ones it had: a base with other versions resolves
  against the worktree's. Results in files outside the checkout (a linked `node_modules`) aren't listed.
- Nothing is found until a worktree's dependencies are installed, for names from packages; names in the repository are
  found without them.
- Languages without a server have no Go to Definition or Find Usages.
