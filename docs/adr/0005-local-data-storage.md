# 5. Local data storage

Date: 2026-09-24

## Status

Accepted

## Context

coxswain keeps data that neither git nor GitHub has: projects and workspaces, the user's comments
and the agent's answers with their threads and anchors, guides, which file diffs are reviewed, and
the agent sessions of each workspace (see [the glossary](../context/coxswain.md) and [UX](../UX.md)).

Much of the rest already lives somewhere else. Git knows branches, worktrees and diffs. GitHub
knows PRs and their comments. Claude Code and Codex keep their own transcripts on disk
(`~/.claude/projects/`, `~/.codex/sessions/`) and can resume a session by its ID. Copies of any of
these would drift from the original.

[ADR 0002](0002-standalone-electron-app.md) requires that all such work runs in the core, which
knows nothing about the UI and may later be hosted for a web version.

Entries need queries ("unresolved threads in this workspace", "entries on this file"), and several
agent sessions can finish and write at the same time.

## Decision

1. **One SQLite database, owned by the core.** It lives in Electron's `app.getPath('userData')`
   (`~/Library/Application Support/coxswain/` on macOS). The main process gives the core the path;
   the core is the only thing that opens the database. The UI reads and writes data only through
   the interface to the core, never through `localStorage` or IndexedDB.
2. **Store only what nobody else has:**
   - projects (the GitHub `owner/name`) and workspaces (a PR number);
   - entries: comments, questions, answers, explanations and findings, with their threads, anchors
     ([ADR 0015](0015-entries-pinned-and-outdated.md)) and resolved state;
   - guides ([ADR 0023](0023-guides-made-by-the-agent-pane.md));
   - reviewed file diffs, by fingerprint ([ADR 0014](0014-reviewed-follows-file-diff-contents.md));
   - agent sessions: which agent and the agent's own session ID;
   - a few settings the core needs.
3. **Don't copy what others own.** Branches, worktrees and diffs are read from git. PRs are fetched
   from GitHub. Agent transcripts are read back from the agent by session ID
   ([ADR 0018](0018-agents-over-acp.md)); only an answer's text is kept, as an entry in its thread.
4. **Secrets go in the OS keychain.** The GitHub token is stored with Electron's `safeStorage`,
   never in the database.
5. **Worktrees coxswain creates go in `~/coxswain/worktrees/<owner>/<name>/pr-<number>/`** (or `branch-<branch>/`, [ADR 0028](0028-branch-workspaces-and-snapshots.md)), not next to the
   repository and not inside `.git`.

The library is `node:sqlite`, with Kysely on top ([ADR 0016](0016-typed-queries-with-kysely.md)).

## Alternatives considered

- **JSON files per workspace.** Simple and easy to read. Rejected: every query means loading and
  filtering in code, and several agent sessions writing at once would need careful locking.
- **Browser storage in the UI** (`localStorage`, IndexedDB). Rejected: it puts data in the UI,
  which ADR 0002 forbids, and a hosted core could not reach it.
- **Storing comments in the repository** (a `.coxswain/` folder or git notes). Would let comments
  travel with the code. Rejected: comments are private until published, and publishing goes
  to GitHub. Worth revisiting only if comments need to be shared without GitHub.
- **Copying agent transcripts into the database.** Would give one place to search. Rejected for now:
  the agents already store them, and a copy has to follow each agent's format changes.

## Consequences

- Backing up or resetting coxswain is one file (plus the worktrees folder).
- We depend on the agents' transcript formats and locations. If Claude Code or Codex change them,
  reading transcripts breaks, and we may have to start copying after all.
- If a repository, worktree or agent session is deleted outside coxswain, the database points at
  something that no longer exists. The core must handle missing things rather than assume them.
- A hosted core needs its own database path and a keychain replacement for secrets; the schema stays
  the same.
- The schema will change often while the concepts settle, so the core needs migrations from the
  start.
