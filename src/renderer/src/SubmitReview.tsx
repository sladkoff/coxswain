import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { match, P } from "ts-pattern";
import type { GitHubProblem, PullRequestDetails } from "../../core/github";
import type { ReviewEvent } from "../../core/pull-requests";
import type { Conclusion } from "../../core/review";
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
          .with("body", () => "in the review's text")
          .with("reply", () => "reply")
          .with(null, () => null)
          .exhaustive(),
        post.resolve === true && "resolve",
        post.resolve === false && "reopen",
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .otherwise(() => "on GitHub already");

// Submit Review (ADR 0037), the bottom bar's dialog, like GitHub's Finish your review: the threads a review takes,
// each with its conclusion (glossary). The summary model writes those ahead, as threads change (a background job, ADR 0038);
// one not written yet says so in its place until it is. The user picks threads and edits conclusions, then sends them to the agent, copies them as a prompt, or posts them to
// the PR as one review with a verdict and a summary. It closes once that's done, or to show a thread.
export function SubmitReviewDialog(props: {
  workspaceId: number;
  pr?: PullRequestDetails | null;
  onViewThread: (threadId: number) => void;
  onSendToAgent: (conclusions: Conclusion[]) => void;
  onCopied: () => void;
  onClose: () => void;
}) {
  const { pr, workspaceId } = props;
  // Read once per opening: a refetch would write over the user's edits. First what's there, at once; then, if some
  // conclusions are still being written, the same with those in.
  const once = { staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, retry: false };
  const draft = useQuery({
    queryKey: ["draftReview", workspaceId, "now"],
    queryFn: () => window.coxswain.draftReview(workspaceId, false),
    ...once,
  });
  const full = useQuery({
    queryKey: ["draftReview", workspaceId, "written"],
    queryFn: () => window.coxswain.draftReview(workspaceId, true),
    enabled: !!draft.data?.threads.some((t) => t.pending),
    ...once,
  });
  const threads = (full.data ?? draft.data)?.threads ?? [];
  const [unpicked, setUnpicked] = useState<Set<number>>(new Set());
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [problem, setProblem] = useState<GitHubProblem | null>(null);
  const textOf = (t: DraftThread) => edited[t.threadId] ?? t.conclusion;
  // Edits are stored when their box is left, and those still unsaved when the dialog closes.
  const unsaved = useRef<Record<number, string>>({});
  const save = (threadId: number) => {
    const text = unsaved.current[threadId];
    if (text === undefined) return;
    delete unsaved.current[threadId];
    void window.coxswain.saveConclusion(threadId, text);
  };
  useEffect(() => () => Object.keys(unsaved.current).forEach((id) => save(Number(id))), []);
  const picked = threads.filter((t) => !unpicked.has(t.threadId));
  const conclusions = (list: DraftThread[]): Conclusion[] =>
    list.map((t) => ({ threadId: t.threadId, body: textOf(t) }));
  const toAgent = picked.filter((t) => t.toAgent);
  const toPost = picked.filter((t) => t.post);
  // Nothing goes while a picked thread's conclusion isn't in.
  const blocked = picked.some((t) => t.pending) && !full.isError;
  const own = pr?.author === pr?.viewer; // GitHub won't let you approve your own PR
  const copy = async () => {
    if (await window.coxswain.copyReviewPrompt(workspaceId, conclusions(toAgent))) props.onCopied();
    props.onClose();
  };
  const post = async () => {
    if (!pr) return;
    const ok = await window.coxswain.confirm({
      message: `Post ${count(toPost.length, "thread")} to PR #${pr.number} as a review?`,
      detail: `${eventLabels[event]}. It's posted as you, and everyone on the PR sees it. Your threads here are resolved once their conclusions are posted.`,
      action: "Post",
    });
    if (!ok) return;
    setPosting(true);
    setProblem(null);
    const r = await window.coxswain.postReview(workspaceId, {
      threads: conclusions(toPost),
      event,
      body,
    });
    setPosting(false);
    if (r.status === "ok") props.onClose();
    else setProblem(r);
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
            {(full.data?.error || full.isError) && (
              <ErrorText className="px-4 py-2">
                Some conclusions are your own last comments:{" "}
                {full.data?.error ?? String(full.error)}
              </ErrorText>
            )}
            {!threads.length && !draft.isError && (
              <div className={cn("px-4 py-3", muted)}>No open threads of yours.</div>
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
                    {/* Nothing to say on a resolve or reopen alone. */}
                    {t.pending && !full.isError ? (
                      <div className={cn("flex items-center gap-1.5 py-1", muted)}>
                        <SpinnerIcon /> Writing its conclusion…
                      </div>
                    ) : (
                      (t.conclusion || t.toAgent) && (
                        <TextArea
                          long
                          rows={2}
                          className="[field-sizing:content] select-text"
                          disabled={!on}
                          value={textOf(t)}
                          onChange={(e) => {
                            unsaved.current[t.threadId] = e.target.value;
                            setEdited((d) => ({ ...d, [t.threadId]: e.target.value }));
                          }}
                          onBlur={() => save(t.threadId)}
                          onSubmit={() => {}}
                          aria-label="Conclusion"
                          placeholder="Where this thread ended up"
                        />
                      )
                    )}
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
                title="Put the picked threads and their conclusions on the clipboard, as the message the agent would get"
                disabled={!toAgent.length || blocked}
                onClick={() => void copy()}
              >
                Copy as Prompt
              </Button>
              <Button
                variant={pr ? undefined : "primary"}
                title="Send the picked threads and their conclusions to the agent pane's session"
                disabled={!toAgent.length || blocked}
                onClick={() => {
                  props.onSendToAgent(conclusions(toAgent));
                  props.onClose();
                }}
              >
                Send to Agent
              </Button>
              {pr && (
                <Button
                  variant="primary"
                  title="Post the picked threads' conclusions to the PR as one review, after asking"
                  disabled={
                    posting || blocked || (!toPost.length && !body.trim() && event === "COMMENT")
                  }
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
