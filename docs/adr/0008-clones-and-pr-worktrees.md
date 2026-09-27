# 8. Clones and PR worktrees

Date: 2026-09-24

## Status

Accepted

## Context

So far coxswain reads every file tree and file from the GitHub API, and agent sessions run in an
empty folder (see [the devlog](../DEVLOG.md)). Agents need a real checkout to work in, and the user
needs to see what an agent changed (G4). [ADR 0006](0006-github-integration.md) already says where
clones go (`~/coxswain/repos/<owner>/<name>/`) and that git runs with the user's own credentials;
[ADR 0005](0005-local-data-storage.md) says where worktrees go.

## Decision

1. **coxswain keeps its own clone** of each project, never reusing one the user already has. Adding
   worktrees to someone else's checkout would change their `.git` behind their back.
2. **Clone when the project is added,** in the background. The project icon shows that it's cloning.
3. **Blobless partial clones** (`git clone --filter=blob:none`): the whole history, file contents
   fetched when first needed. Adding a large repository stays quick; `git diff` and `git log` work
   as usual. Clones go to a temporary folder and are renamed into place when done, so an interrupted
   clone never looks finished.
4. **A PR worktree tracks the PR's head branch in the same repository:**
   `git worktree add --track -b <head branch> <worktree> origin/<head branch>`, so agent commits can
   be pushed to the PR. PRs from forks aren't supported yet. A workspace started on a branch has a worktree on that
   branch instead ([ADR 0028](0028-branch-workspaces-and-snapshots.md)).
5. **Opening a workspace fetches.** If the PR's (or branch's) head branch moved and the worktree has no local
   changes, it is fast-forwarded. Otherwise it is left alone and the user is told.
6. **The worktree is the source for the Navigator and Viewer.** _Changes_ compares the worktree,
   including uncommitted and untracked files, with the PR's merge base, so an agent's changes show up
   there. _Files_ lists the worktree; the Viewer reads the new side from the worktree and the old side
   with `git show`. PR metadata, the list of PRs and comments still come from the GitHub API.
7. **Git never prompts.** It runs with `GIT_TERMINAL_PROMPT=0`, so missing credentials fail with a
   message instead of hanging.
8. **Agents work in the workspace's worktree.** Agent sessions run there and may edit its files;
   what they may do without asking is [ADR 0013](0013-auto-permission-mode.md)'s.

## Alternatives considered

- **Reuse an existing local clone.** Saves a download and matches the user's own setup. Rejected for
  now (decision 1); adding a local repository as a project is its own feature (ADR 0006).
- **Full clones.** Simpler to reason about, but slow and large for big repositories.
- **Shallow clones.** Small, but merge bases and history break, and diffs against the base need them.
- **Detached worktrees at the PR's head commit.** No branch bookkeeping, but agent commits then have
  nowhere to be pushed.
- **Keep reading PR files from GitHub.** Rate-limited, slow per file, and blind to local changes.

## Consequences

- The first open of a workspace waits for its clone; very large repositories take a while.
- Reading an old file version may go to the network the first time (blobless clone).
- _Changes_ shows the PR's changes and the local changes together; the scope (ADR 0028) shows either on its own.
- Fork PRs need a remote for the fork and depend on the author allowing edits from maintainers.
- An agent can rewrite any file in the worktree, uncommitted. Git shows what it did, but there is no
  undo in coxswain yet.
- Worktrees and clones must be removed when workspaces and projects are, which isn't built yet.
