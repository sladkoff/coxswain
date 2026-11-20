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
3. **Native servers, pinned.** TypeScript and JavaScript use TypeScript 7's own server, `tsc --lsp --stdio`, the Go
   binary from `typescript`'s per-platform package, a dependency of the app, unpacked from the asar so it can be run.
   Python uses pyrefly (`pyrefly lsp`), a Rust binary that isn't on npm: on first use it's fetched from its GitHub
   release for the platform, checked against the sha256 pinned in `python.ts`, unpacked with the system's `tar` and
   kept in `~/coxswain/language-servers/pyrefly-<version>/` (`download.ts`, for any later server shipped that way).
   Go uses gopls (`gopls serve`) as installed, not pinned: it runs the `go` command, so Go must be installed anyway,
   and gopls should be the one built for that Go. It's looked for on PATH, then in `go env GOBIN` and `GOPATH`'s
   `bin`; without it the error says to `go install` it. It finds each file's module (the nearest `go.mod`) itself, so
   a module in a subfolder of the repository works, and the module cache stands in for dependency folders.
4. **Every side of a file diff is a checkout.** A side is the worktree or a commit (the merge base, the head, a
   snapshot, a turn's before or after). The worktree, or a commit that is its current snapshot, is served in the
   worktree. Any other commit gets a detached, read-only `git worktree add --detach` in
   `~/coxswain/checkouts/<owner>/<name>/<sha>/`, with the worktree's dependency folders symlinked in. Results open at
   the same revision on the canvas.
5. **Servers start on first use and are few.** One per checkout and language, reused while it answers; the least
   recently used stops beyond `lspLimits.servers`, and a commit's checkout that no running server reads is removed.
   All stop when the app quits. Servers watch their files themselves (`tsc` does when the
   client doesn't register watchers), so agent edits are seen.
6. **A server in the worktree is told what changed.** gopls doesn't watch files: it would answer from the files as it
   first read them, at the wrong line or not at all. Before each lookup in the worktree, the files that differ
   between the snapshot (ADR 0028) the server last saw and the worktree's current one (a commit, a pull, an edit,
   committed or not) are sent as `workspace/didChangeWatchedFiles`, and an open document among them is closed so it's
   read from disk again. It's sent to every server, so a server that watches as well reads a file twice. A commit's
   checkout never changes.

## Alternatives considered

- **Keep grep as a fallback.** Answers for every language, but with the wrong answers the servers exist to fix, and
  two behaviours for one action.
- **basedpyright for Python.** On npm and runs on Electron's Node, so nothing to download, but slower and heavier
  than a native checker; pyrefly is stable (1.x) and a single binary.
- **ty for Python.** Also a single native binary, but still 0.0.x, and finds nothing from packages without a `.venv`.
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
- Names from packages are only found once the worktree's dependencies are installed (`node_modules`, a Python
  `.venv`). A Python repository whose own packages are only importable through its venv (a uv workspace with
  editable installs) finds nothing across them until `uv sync` has run.
- The first Python file clicked on a machine downloads pyrefly (about 14 MB), so it needs the network once.
- Go needs Go and gopls installed. A definition in the standard library or the module cache is outside the checkout,
  so it isn't listed. A big module's first lookup in a new checkout waits for gopls to load it.
- A lookup in the worktree first takes a snapshot of it, as a view does: a `git status` and, with changes, a commit.
- Languages without a server have no Go to Definition or Find Usages.

Python initialization adds project directories containing `pyproject.toml` and their existing `src` directories as Pyrefly `extraSearchPaths`. Discovery skips environments, dependencies, git metadata and build output. This lets the language server resolve local flat-layout, src-layout and namespace workspace packages before an editable environment is installed, while preserving its own symbol resolution and project configuration. No symbol-name search or repository configuration writes are used. Third-party dependencies still need to exist in the project’s environment.
