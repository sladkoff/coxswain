# 40. Local repositories, new projects and GitHub as an option

Date: 2026-10-04

## Status

Accepted

## Context

Every project was a GitHub repository that coxswain cloned ([ADR 0006](0006-github-integration.md),
[ADR 0008](0008-clones-and-pr-worktrees.md)): its row was GitHub's `owner/name`, and every path, the clone's, the
worktrees' and the checkouts', followed from it. A repository that is only on the user's machine, or on another
host, couldn't be a project, though the glossary always said the repository may be local only. Building a feature
(G5) doesn't need GitHub: branch workspaces, notes, questions, agents, views and turn diffs are all git and the
database. GitLab and other hosts will come later, and should then be one more thing a project can be on, not a
second kind of project.

## Decision

1. **A project is a git repository; GitHub is optional.** A project has a `name`, a `path` and a `github`
   (`owner/name`). `path` null: coxswain's own clone in `~/coxswain/repos/<owner>/<name>/` (ADR 0008), so it follows
   from `github` and isn't stored. `github` null: the project isn't on GitHub, and has no PRs, threads or posting.
2. **Three ways to add one:**
   - **A GitHub repository** from the list: cloned, as before.
   - **Add Local Repository…**: a folder the user picks in a native dialog. It must be in a git repository with at
     least one commit; the project is the repository's top level. If its `origin` remote is on github.com, the project
     remembers its `owner/name` (ADR 0006's _Detect_) and gets every GitHub feature, on the user's own checkout.
   - **New Project…**: a new folder, picked in a native save dialog, which coxswain makes, `git init`s and gives an
     empty first commit, with the user's own git identity. A folder that isn't a git repository yet can't be added;
     it can be made a repository first, or its contents moved into a new project.
3. **A local repository's worktrees are its own.** coxswain adds them to the user's repository with `git worktree`,
   rather than cloning it again: a repository on this machine has no other source of truth, and a second copy would
   drift from it. They live in `~/coxswain/worktrees/local/<name>-<hash of path>/`, never inside the user's
   working tree, and the user's checkout, index and branches are left alone; only the `refs/coxswain/` refs
   (snapshots, pinned revisions) and `origin/` refs (fetches) are written. Removing a project or workspace never
   deletes the user's repository. coxswain only moves or drops the registration of a worktree under `~/coxswain`:
   a branch checked out in one of the user's worktrees can't be a workspace's (it isn't moved), and stale
   registrations are dropped one by one (`git worktree remove --force` on a missing folder), never with
   `git worktree prune`, which would also drop the user's, e.g. one on a drive that isn't mounted. This replaces ADR 0008's decision 1 for local repositories; a GitHub repository
   picked from the list is still cloned.
4. **Where a branch starts and what's pushed, without GitHub.** A local repository's branch workspaces start from the
   local base branch (the user's own), or `origin/<base>` if there's no local one. The base branches offered are its
   local branches and `origin/`'s, the default being the branch the user's checkout is on. What's pushed is what
   `origin/<branch>` has; with no `origin` remote nothing is pushed, so the head is the merge base and every commit is
   local. Push goes to `origin` whatever host it is; Open Pull Request… is offered only for a project on GitHub.
5. **Nothing goes to GitHub for a project that isn't on it.** Opening a workspace doesn't look for its PR, and the
   watcher only fetches. `gh` is no longer checked at startup: a missing or signed-out `gh` shows where GitHub is
   used (the repository list, a PR), so coxswain works without it.

## Alternatives considered

- **Clone the local repository too** (`git clone /path`), keeping ADR 0008's rule that coxswain never touches the
  user's `.git`. Its `origin` would be the user's checkout, so pushes go back there as branches. Rejected: a second
  copy that falls behind, and a remote that isn't the one the user pushes to.
- **Worktrees inside the repository** (`.coxswain/` in the working tree). Easy to find, but it needs a `.gitignore`
  entry in the user's repository, and tools that walk the tree would find every worktree.
- **Add any folder, `git init`ing it.** Its first commit would take whatever is there, `node_modules`, build output
  or secrets, without a `.gitignore`. A new project starts empty instead.
- **A forge interface now,** with GitHub as its one implementation. Waits for GitLab, when there are two to shape it.

## Consequences

- Existing projects become `github` projects with no `path`; their folders don't move.
- A branch checked out in the user's own checkout or one of their worktrees can't be a workspace's; opening the
  workspace says where it's checked out.
- An empty first commit means a new project's first workspace starts from an empty tree.
- Projects can't be removed yet; when they can, a local repository's worktrees must be removed with `git worktree
remove`, not by deleting the folder, so the user's repository forgets them.
- Projects on GitLab or another host work as local repositories (Push included) until coxswain knows the host.
