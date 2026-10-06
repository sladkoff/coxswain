import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { match, P } from "ts-pattern";
import type { GitHubProblem, PullRequestDetails } from "../../core/github";
import type { ReviewEvent } from "../../core/pull-requests";
import type { DraftThread } from "../../core/review-draft";
import { Button, SegmentedControl } from "./components/button";
import { TextArea } from "./components/field";
import { SpinnerIcon } from "./components/icons";
import { Dialog } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ErrorText } from "./components/text";
import { count } from "./format";
import { ProblemText } from "./PullRequest";

const eventLabels: Record<ReviewEvent, string> = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request Changes",
};

// What Post to GitHub does with a thread, in a few words; nothing without a PR.
const posts = (t: DraftThread, hasPr: boolean) =>
  match({ hasPr, post: t.post })
    .with({ hasPr: false }, () => "")
    .with({ post: P.nonNullable.select() }, (post) =>
      [
        match(post.placement)
          .with("lines", () => "comment on the lines")
          .with("reply", () => "reply")
          .with("conversation", () => "in the conversation")
          .with(null, () => null)
          .exhaustive(),
        post.resolve === true && "resolve",
        post.resolve === false && "reopen",
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .otherwise(() => "on GitHub already");

// Submit Review (ADR 0037), the bottom bar's dialog, like GitHub's Finish your review: the open comment threads, each
// with its comments not on GitHub yet, which go as written; editing one edits the comment. The user picks threads, then
// sends them to the agent, copies them as a prompt, or posts them to the PR as one review with a verdict and a summary.
// It closes once that's done, or to show a thread.
export function SubmitReviewDialog(props: {
  workspaceId: number;
  pr?: PullRequestDetails | null;
  onViewThread: (threadId: number) => void;
  onSendToAgent: (threadIds: number[]) => void;
  onCopied: () => void;
  onClose: () => void;
}) {
  const { pr, workspaceId } = props;
  // Read once per opening: a refetch would write over the user's edits.
  const draft = useQuery({
    queryKey: ["draftReview", workspaceId],
    queryFn: () => window.coxswain.draftReview(workspaceId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const threads = draft.data ?? [];
  const [unpicked, setUnpicked] = useState<Set<number>>(new Set());
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [problem, setProblem] = useState<GitHubProblem | null>(null);
  // Edits are saved to their comments when their box is left, and before anything goes, which reads them there.
  const unsaved = useRef<Record<number, string>>({});
  const save = () => {
    const saving = Object.entries(unsaved.current).map(([id, text]) =>
      window.coxswain.editEntry(Number(id), text),
    );
    unsaved.current = {};
    return Promise.all(saving);
  };
  useEffect(() => () => void save(), []);
  const picked = threads.filter((t) => !unpicked.has(t.threadId));
  const ids = (list: DraftThread[]) => list.map((t) => t.threadId);
  const toAgent = picked.filter((t) => t.toAgent);
  const toPost = picked.filter((t) => t.post);
  const own = pr?.author === pr?.viewer; // GitHub won't let you approve your own PR
  const copy = async () => {
    await save();
    if (await window.coxswain.copyReviewPrompt(workspaceId, ids(toAgent))) props.onCopied();
    props.onClose();
  };
  const post = async () => {
    if (!pr) return;
    const ok = await window.coxswain.confirm({
      message: `Post ${count(toPost.length, "thread")} to PR #${pr.number} as a review?`,
      detail: `${eventLabels[event]}. Your comments are posted as you wrote them, and everyone on the PR sees them.`,
      action: "Post",
    });
    if (!ok) return;
    await save();
    setPosting(true);
    setProblem(null);
    const send = (addToPending: boolean) =>
      window.coxswain.postReview(workspaceId, { threads: ids(toPost), event, body, addToPending });
    let r = await send(false);
    // A review of the user's in progress on GitHub is only added to, and submitted, once they say so.
    if (
      r.status === "pending" &&
      (await window.coxswain.confirm({
        message: "You have a review in progress on this PR on GitHub",
        detail: `It has ${count(r.comments, "comment")} you haven't submitted. Add these to it and submit it, with ${eventLabels[event]}?`,
        action: "Add and Submit",
      }))
    )
      r = await send(true);
    setPosting(false);
    if (r.status === "ok") props.onClose();
    else if (r.status !== "pending") setProblem(r);
  };
  return (
    <Dialog
      title="Submit Review"
      subtitle={
        pr
          ? `To the agent, or as a review on PR #${pr.number}`
          : "To the agent: this workspace has no PR to post to"
      }
      onClose={props.onClose}
    >
      {draft.isPending ? (
        <div
          className={cn("flex items-center justify-center gap-2 px-4 pt-6 pb-10 text-xs", muted)}
        >
          <SpinnerIcon /> Loading…
        </div>
      ) : (
        <>
          <div className={cn("flex min-h-0 flex-col overflow-y-auto border-t text-xs", divider)}>
            {draft.isError && <ErrorText className="px-4 py-2">{String(draft.error)}</ErrorText>}
            {!threads.length && !draft.isError && (
              <div className={cn("px-4 py-3", muted)}>
                No open comment threads. Agent threads become one with Summarize as Comment.
              </div>
            )}
            {threads.map((t) => {
              const on = !unpicked.has(t.threadId);
              return (
                <div
                  key={t.threadId}
                  className={cn("flex gap-2 border-b px-4 py-2", divider, !on && "opacity-50")}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    aria-label="Include this thread"
                    checked={on}
                    onChange={(e) =>
                      setUnpicked((u) => {
                        const next = new Set(u);
                        if (e.target.checked) next.delete(t.threadId);
                        else next.add(t.threadId);
                        return next;
                      })
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className={cn("flex items-baseline gap-2", muted)}>
                      <button
                        className="min-w-0 flex-1 truncate text-left hover:underline"
                        title="Show the thread"
                        onClick={() => {
                          props.onClose();
                          props.onViewThread(t.threadId);
                        }}
                      >
                        <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400">
                          {t.path ?? "View"}:{t.lines}
                        </span>{" "}
                        {t.body}
                      </button>
                      <span className="shrink-0">
                        {[t.entries > 1 && count(t.entries, "entry", "entries"), posts(t, !!pr)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {t.comments.map((c) => (
                      <TextArea
                        key={c.id}
                        long
                        rows={1}
                        className="[field-sizing:content] select-text"
                        disabled={!on}
                        value={edited[c.id] ?? c.body}
                        onChange={(e) => {
                          unsaved.current[c.id] = e.target.value;
                          setEdited((d) => ({ ...d, [c.id]: e.target.value }));
                        }}
                        onBlur={() => void save()}
                        onSubmit={() => {}}
                        aria-label="Comment"
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 flex-col gap-2 px-4 py-3 text-xs">
            {pr && (
              <TextArea
                long
                rows={2}
                className="select-text"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onSubmit={() => void post()}
                placeholder="A summary for the review on GitHub (optional)"
              />
            )}
            {problem && <ProblemText problem={problem} />}
            <div className="flex items-center gap-2">
              {pr && !own && (
                <SegmentedControl
                  value={event}
                  onChange={setEvent}
                  options={(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const).map((e) => ({
                    value: e,
                    label: eventLabels[e],
                  }))}
                />
              )}
              <div className="flex-1" />
              <Button
                title="Put the picked threads on the clipboard, as the message the agent would get"
                disabled={!toAgent.length}
                onClick={() => void copy()}
              >
                Copy as Prompt
              </Button>
              <Button
                variant={pr ? undefined : "primary"}
                title="Send the picked threads to the agent pane's session"
                disabled={!toAgent.length}
                onClick={async () => {
                  await save();
                  props.onSendToAgent(ids(toAgent));
                  props.onClose();
                }}
              >
                Send to Agent
              </Button>
              {pr && (
                <Button
                  variant="primary"
                  title="Post the picked threads' comments to the PR as one review, after asking"
                  disabled={posting || (!toPost.length && !body.trim() && event === "COMMENT")}
                  onClick={() => void post()}
                >
                  {posting ? "Posting…" : "Post to GitHub…"}
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
