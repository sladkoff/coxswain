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
   labels, conversation, review threads, each commit's check state and the head's checks. The core reads it with each
   check of GitHub for the workspace on screen ([ADR 0030](0030-workspace-watcher.md)): every minute, on window focus,
   on a push and after a change made here; the UI shows what the last check read. GraphQL has no ETags (ADR 0006
   decision 7), so each read counts against the rate limit.
3. **Review threads are mirrored into entries** (`syncThreads`, `core/pull-requests.ts`), so following and outdated
   (ADR 0015), the threads list, _Submit Review_ and the agent's prompts work on them unchanged. A thread's comments become
   entries of kind `comment` with their author's login: the first one anchored on the lines it was written on (the new
   side at its comment's commit, the old side at the merge base), the rest replies. They are GitHub's: overwritten by
   each read, deleted when deleted there, never edited here. The user's own replies are ordinary notes in the thread.
   `entries.github_id` links an entry to its comment, `github_thread_id` a thread's first entry to its review thread.
   Threads on a whole file have no lines, so they show in the PR panel's conversation instead.
4. **Resolving is local until posted.** GitHub's resolve or reopen, seen in a read, is taken over (`github_resolved`
   records what GitHub had). A resolve here stays here until _Post to GitHub_ sends it.
5. **Posting is one review of comments as written, picked by thread** (`postReview`). _Submit Review_ lists every
   open comment thread (6), and with a PR every one with something to post: one of the workspace's not on GitHub yet,
   or one on GitHub with comments or a resolve since. The user picks threads, edits their comments if they like (which
   edits the comments), picks a verdict (_Comment_, _Approve_, _Request Changes_; only _Comment_ on their own PR) and a
   summary, and confirms. It goes out as one pending review on the PR's head as last opened, then submitted; resolves
   follow. A new thread on lines the PR's diff has becomes a thread there: its first comment on the lines, the others
   replies to it. On a thread already on GitHub each comment is a reply. Otherwise (lines outside the diff, not pushed
   or changed since, or a view's prose) the thread's comments go in the review's text, after the summary, with what
   they are about quoted: one notification, not a comment each. Each comment posted records its GitHub comment
   (`github_id`, `github_url`), and a new thread its review thread (`github_thread_id`) on its first entry, so the thread
   here _is_ the thread on GitHub: the next read finds it by that id, replies there land in it, edits there are taken
   over, and resolving goes both ways. Editing or deleting a posted comment here does so on GitHub first
   (`updatePullRequestReviewComment`, `deletePullRequestReviewComment`); a failure there leaves it unchanged here. A
   thread in the review's text has nothing on GitHub to point at, so it is resolved here once posted. Since every
   comment is recorded as it goes, nothing is posted twice after a failure halfway; the user's pending review is
   reused. A comment can also go at once (`postComment`): with _Post to GitHub_ ticked in the comment box (a global
   preference, `comment.post`), sending it posts its thread's new comments as plain discussion, with no review: GitHub's
   REST single comments (`pulls/comments`, and `…/replies` for the others), each published as it's made, so a pending
   review of the user's is never submitted with them (GitHub refuses a single comment while one is open, and says so).
   Off the PR's diff they go as one comment in the PR's conversation, with what they're about quoted. Until the next
   read finds the new thread by its first comment, the thread counts as on GitHub already. If posting fails the
   comment stays here for _Submit Review_.
6. **Comment threads and agent threads are separate** (`isComment`). A thread is one or the other by its first entry,
   and stays it: a comment thread starts with the user's note or a comment from GitHub, and its replies are comments,
   never questions; an agent thread starts with a question, explanation or finding, for exploring or changing the code
   with the agent. Only comment threads are part of a review: _Submit Review_ lists them, _Post to GitHub_ posts their
   comments as written, _Send to Agent_ and _Copy as Prompt_ send them for the agent to implement. An agent thread
   reaches the review only through _Summarize as Comment_ (`summarizeThread`, `addCommentAt`): a job
   ([ADR 0038](0038-background-jobs-and-core-events.md)) on the summary model writes the one comment the thread comes
   to, the reviewer's point in their voice with the agent's answers as background; the user edits it, and saving adds
   it as a comment thread on the same anchor. Nothing generated is posted without the user reading and saving it.
7. **The PR panel** is a canvas location (`pr` in `CanvasSearch`, ADR 0025), opened by the PR's chip in the canvas bar:
   state and merge state, _Ready for Review_ or _Merge…_, checks, description (edited in place), assignees (assign
   yourself), reviewers, labels and the conversation with a box to comment. Every change it makes on
   GitHub is a click; merging, marking ready and posting ask first.
8. **Checks** show as a dot: the head's on the PR chip, each commit's in the Commits pane. A failing check in the panel
   has _Send to Agent_: the check, and for a GitHub Actions job the last 150 lines of its log, go to the agent pane's
   session as one message (`[Check · name failed]`, a card in the chat), asking it to find out why and fix it.

## Alternatives considered

- **Read GitHub comments live and never store them**, keeping only links. Nothing duplicated, but every thread feature
  (following, the threads list, _Submit Review_, prompts, counts) would need a second path for comments that aren't
  entries. Mirroring keeps one queue; GitHub stays the source, since mirrored entries are overwritten on every read.
- **Several PRs per workspace.** Matches "a session made two PRs", but GitHub allows one open PR per branch and a
  worktree is on one branch; it would need a branch per PR inside one worktree.
- **Post each comment at once**, or per thread. Simpler, but notifies reviewers once per comment and can't carry a
  verdict; GitHub's own review batches them.
- **Post a summary of every thread** (a conclusion written by the summary model, ahead, for each thread in the
  review). Saves the user writing comments, but the summaries put the agent's explanations in the user's mouth and
  missed the reviewer's point, and the user's own comments came out rewritten. Keeping the two kinds of thread apart
  posts what the user wrote, and makes a summary a deliberate step on one thread.
- **Post agent threads as written**, the agent's answers marked as the agent's. Nothing to generate, but a thread with
  an agent is long and reads as noise on a PR.
- **Resolve a posted thread here and let its comment come back as a thread of its own.** Keeps mirrored threads plain,
  but loses the link: replies on GitHub land in a second thread, and the user's comment can't be edited or deleted
  from here.
- **Resolve on GitHub at once** from the thread's ✓. One click fewer, but writes to GitHub without the user choosing
  to post.
- **REST for posting.** The review endpoint takes new comments but not replies to existing threads or file-level
  comments; GraphQL has both, in a pending review.

## Consequences

- A workspace's GitHub threads are in SQLite as long as the workspace is; removing the workspace removes them.
- The first 100 threads, comments per thread, commits and checks are read (`ponytail:` in `core/github.ts`).
- A thread deleted on GitHub stays here with any local replies (`ponytail:` in `syncThreads`).
- A comment whose commit the clone doesn't have (force-pushed away) has no code and reads as outdated.
- A thread posted in the review's text can't be edited or deleted on GitHub from here (`ponytail:` in `postReview`).
- Threads posted before the link was kept were resolved here, and their comments came back as threads of their own;
  they stay unlinked.
- Threads are mirrored only once the worktree is open, since they're anchored there.
