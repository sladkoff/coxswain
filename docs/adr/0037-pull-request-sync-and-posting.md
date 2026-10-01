# 37. The PR on GitHub: mirrored threads, the PR panel and posting

Date: 2026-10-01

## Status

Accepted

## Context

coxswain read only a PR's head, title and state (ADR 0006, 0008). Its review comments, conversation, description,
people and checks stayed on GitHub, and nothing written in coxswain could get back there (#3, G2, G4). A workspace is
one worktree on one branch (ADR 0028), and GitHub has at most one open PR per head branch, so a workspace has at most one
PR; the branch, not the workspace, is what ties them. Writing to GitHub must always be the user's conscious action.

## Decision

1. **The branch connects a workspace to GitHub.** A workspace has zero or one PR, found by its branch (ADR 0028).
   Several PRs from one piece of work are several branches, so several workspaces; splitting a workspace's commits off
   into a new one isn't built.
2. **One read per PR**: a GraphQL query (`getPullRequest`, `core/github.ts`) for the PR's state, description, people,
   labels, conversation, review threads, each commit's check state and the head's checks. The renderer polls it every
   minute while the workspace shows, and on window focus. GraphQL has no ETags (ADR 0006 decision 7), so each poll
   counts against the rate limit.
3. **Review threads are mirrored into entries** (`syncThreads`, `core/pull-requests.ts`), so following and outdated
   (ADR 0015), the threads list, _Hand off_ and the agent's prompts work on them unchanged. A thread's comments become
   entries of kind `comment` with their author's login: the first one anchored on the lines it was written on (the new
   side at its comment's commit, the old side at the merge base), the rest replies. They are GitHub's: overwritten by
   each read, deleted when deleted there, never edited here. The user's own replies are ordinary notes in the thread.
   `entries.github_id` links an entry to its comment, `github_thread_id` a thread's first entry to its review thread.
   Threads on a whole file have no lines, so they show in the PR panel's conversation instead.
4. **Resolving is local until posted.** GitHub's resolve or reopen, seen in a read, is taken over (`github_resolved`
   records what GitHub had). A resolve here stays here until _Post to GitHub_ sends it.
5. **Posting is one review, picked by thread** (`postReview`). _Hand off › Post to GitHub…_ opens the PR panel's _Post
   to GitHub_, listing every thread with something to post: a thread of the workspace's not on GitHub yet, or one from
   GitHub with replies or a resolve since. The user picks threads, whether the agent's answers go too, a verdict
   (_Comment_, _Approve_, _Request Changes_; only _Comment_ on their own PR) and a summary, and confirms. It goes out
   as one pending review on the PR's head as last opened, then submitted; resolves follow. A new thread goes on its
   lines if the PR's diff has them, else on the whole file quoting them. A thread whose lines aren't on GitHub (not
   pushed) or have changed since, or one on a view's prose, can't be posted. Each entry records its comment as it's
   posted, so a failure halfway posts nothing twice, and the user's pending review is reused next time.
6. **The agent's entries are posted only when picked, marked** as the agent's (`> 🤖 Claude, via coxswain`). They
   go out as the user, who chose them.
7. **The PR panel** is a canvas location (`pr` in `CanvasSearch`, ADR 0025), opened by the PR's chip in the canvas bar:
   state and merge state, _Ready for Review_ or _Merge…_, checks, description (edited in place), assignees (assign
   yourself), reviewers, labels, _Post to GitHub_ and the conversation with a box to comment. Every change it makes on
   GitHub is a click; merging, marking ready and posting ask first.
8. **Checks** show as a dot: the head's on the PR chip, each commit's in the Commits pane. A failing check in the panel
   has _Send to Agent_: the check, and for a GitHub Actions job the last 150 lines of its log, go to the agent pane's
   session as one message (`[Check · name failed]`, a card in the chat), asking it to find out why and fix it.

## Alternatives considered

- **Read GitHub comments live and never store them**, keeping only links. Nothing duplicated, but every thread feature
  (following, the threads list, _Hand off_, prompts, counts) would need a second path for comments that aren't
  entries. Mirroring keeps one queue; GitHub stays the source, since mirrored entries are overwritten on every read.
- **Several PRs per workspace.** Matches "a session made two PRs", but GitHub allows one open PR per branch and a
  worktree is on one branch; it would need a branch per PR inside one worktree.
- **Post each comment at once**, or per thread. Simpler, but notifies reviewers once per comment and can't carry a
  verdict; GitHub's own review batches them.
- **Resolve on GitHub at once** from the thread's ✓. One click fewer, but writes to GitHub without the user choosing
  to post.
- **REST for posting.** The review endpoint takes new comments but not replies to existing threads or file-level
  comments; GraphQL has both, in a pending review.

## Consequences

- A workspace's GitHub threads are in SQLite as long as the workspace is; removing the workspace removes them.
- The first 100 threads, comments per thread, commits and checks are read (`ponytail:` in `core/github.ts`).
- A thread deleted on GitHub stays here with any local replies (`ponytail:` in `syncThreads`).
- A comment whose commit the clone doesn't have (force-pushed away) has no code and reads as outdated.
- Editing a posted entry here doesn't change it on GitHub.
- Threads are mirrored only once the worktree is open, since they're anchored there.
