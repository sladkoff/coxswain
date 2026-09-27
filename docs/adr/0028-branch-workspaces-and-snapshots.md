# 28. Branch workspaces, local changes and snapshots

Date: 2026-09-28

## Status

Accepted

## Context

Every workspace was a PR (G2–G4). Building a feature (G5) starts before there is one: a branch, an agent's changes,
then a PR. Inside a PR workspace, _Diffs_ mixed the PR's changes with the local ones (an agent's, not pushed), and a
view was pinned to the PR's head, so it could show neither the local changes nor say what changed since it was
made. The user needs to see what is in flight: what's on GitHub, what's only here, and what each agent turn did.

## Decision

1. **A workspace is a PR or a branch.** `workspaces.pr_number` may be null; `branch` and `base_branch` are set for a
   workspace started on a branch (new, made from `origin/<base>` without tracking, or one already on GitHub, which it
   tracks). A branch workspace's worktree is `branch-<branch>/` (slashes as `+`) and keeps that folder once it has a
   PR, since agent sessions are tied to it. Branch names are checked against git's rules in the core.
2. **A branch workspace finds its PR.** Opening it asks GitHub for an open PR with that head branch and, if there is
   one, records it; opening a PR from the new workspace screen whose head is a branch workspace's branch does the
   same. From then on it opens like a PR workspace. _Open Pull Request…_ pushes the branch and opens a **draft** PR into
   the base branch (titled by its one commit, else by the branch), then shows it in the browser to finish.
3. **What's on GitHub is the head.** `openWorktree` returns `head`: the PR's head, or the branch's on GitHub, or the
   merge base while a branch isn't pushed. The **scope** picks a range over it: _All_ is merge base → worktree,
   _PR_/_Pushed_ is merge base → head (pinned, like a commit diff), _Local_ is head → worktree. Commits after head are
   marked _local_; _Push_ pushes the branch, never forced. For a branch without a PR the merge base is git's
   (`merge-base origin/<base> HEAD`); for a PR it stays GitHub's (ADR 0008).
4. **Snapshots pin the worktree.** A snapshot is the worktree as a commit: `git add --all` into a copy of the worktree's
   index (`GIT_INDEX_FILE`), `write-tree`, then `commit-tree` on HEAD with a fixed author and date, so the same files
   make the same commit. With nothing uncommitted it's HEAD itself. It's kept from gc under `refs/coxswain/snapshots/`.
   The worktree's own index and files are never touched.
5. **Views are pinned to a snapshot**, not the PR's head, so they include local changes. A view is stale once the
   current snapshot differs from its head.
6. **Every agent turn is snapshotted before and after** (`agents.ts` `runTurn`, which pane turns, questions and _Send
   all_ go through). A turn that changed something is stored in `turns` and listed under _Agent turns_ in the Commits
   pane; picking one shows before → after like a commit diff.

## Alternatives considered

- **`git stash create` for snapshots.** One command, but it leaves untracked files out, which are most of an agent's
  new work.
- **Diffing turns by `git diff` before and after, stored as text.** Can't be shown with the file diff machinery
  (both sides are read as files at commits), and stores what git already can.
- **A marker per file in _Diffs_ only** (UX open question 5). Tells which files have local changes but not what they
  are; kept as the Navigator's ●, with the scope for the rest.
- **Rename a branch workspace's worktree to `pr-<n>/` once it has a PR.** Uniform names, but its agent sessions would
  lose their folder.

## Consequences

- Taking a snapshot runs `git status` and hashes the changed files; it runs when the worktree changes, when a view
  starts, and twice per turn.
- Snapshot refs are never pruned (`ponytail:` in `snapshot.ts`).
- Two turns running at once in one workspace each get both's changes in their turn diff.
- A view made before this decision is pinned to the PR head; it's stale as soon as there are local changes.
- The branch list for a new branch workspace is as of the clone and the fetches since.
