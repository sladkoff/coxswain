import { useState } from "react";
import type { ReviewEntry } from "../../core/review";
import { Button } from "./components/button";
import { ProgressBar } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ErrorText } from "./components/text";
import { count } from "./format";
import type { Turn } from "./Viewer";

type Props = {
  workspaceId: number;
  entries: ReviewEntry[];
  files: { path: string; additions?: number; deletions?: number }[];
  reviewed: string[];
  turns: Record<number, Turn>;
  onViewThread: (threadId: number) => void;
};

// The canvas's bottom bar: the review at a glance. Threads, with how many are outdated or waiting on the agent, how
// many of the file diffs on screen are reviewed, and their lines. The thread count opens every thread above the bar.
export function StatusBar(props: Props) {
  const [open, setOpen] = useState(false);
  // Sending every thread to the agent pane's session; the agent's reply shows there.
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const sendAll = async () => {
    setSending(true);
    setError(null);
    const result = await window.coxswain.sendReview(props.workspaceId);
    setSending(false);
    if (result.status === "error") setError(result.message);
  };
  const threads = props.entries.filter((e) => e.path && !e.parentId);
  const outdated = threads.filter((e) => e.state === "outdated").length;
  const resolved = threads.filter((e) => e.resolvedAt).length;
  const which = [outdated && `${outdated} outdated`, resolved && `${resolved} resolved`].filter(
    Boolean,
  );
  const answering = threads.filter((e) => props.turns[e.id]?.running).length;
  const reviewed = props.files.filter((f) => props.reviewed.includes(f.path)).length;
  const add = props.files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const del = props.files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const parts = [
    count(threads.length, "thread") + (which.length ? ` (${which.join(", ")})` : ""),
    answering ? `${answering} waiting on the agent` : "",
  ].filter(Boolean);
  return (
    <div className={cn("flex max-h-[50%] shrink-0 flex-col border-t text-xs", divider)}>
      {open && (
        <div className={cn("flex min-h-0 flex-col overflow-y-auto border-b py-1", divider)}>
          {threads.length === 0 && (
            <div className={cn("px-2 py-1", muted)}>
              No threads yet. Click a line's gutter to start one.
            </div>
          )}
          {threads.map((t) => (
            <ThreadRow
              key={t.id}
              root={t}
              replies={props.entries.filter((e) => e.parentId === t.id)}
              answering={!!props.turns[t.id]?.running}
              onClick={() => props.onViewThread(t.id)}
            />
          ))}
        </div>
      )}
      <div className={cn("flex h-8 shrink-0 items-center gap-3 px-2", muted)}>
        <Button
          variant="ghost"
          title={open ? "Hide the threads" : "Show all threads"}
          className="flex min-w-0 items-center gap-1 px-1 py-0.5"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="truncate">{parts.join(" · ")}</span>
        </Button>
        <Button
          variant="ghost"
          title="Send every thread to the agent in one message"
          className="px-1.5 py-0.5"
          disabled={!threads.length || sending}
          onClick={sendAll}
        >
          {sending ? "Agent working…" : "Send all to agent"}
        </Button>
        <Button
          variant="ghost"
          title="Copy every thread to the clipboard as that message, to paste elsewhere"
          className="px-1.5 py-0.5"
          disabled={!threads.length}
          onClick={async () => {
            setCopied(await window.coxswain.copyReviewPrompt(props.workspaceId));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy as prompt"}
        </Button>
        {error && <ErrorText className="truncate">{error}</ErrorText>}
        <div className="flex-1" />
        {props.files.some((f) => f.additions !== undefined) && (
          <span className="tabular-nums">
            <span className="text-green-600">+{add}</span>{" "}
            <span className="text-red-600">−{del}</span>
          </span>
        )}
        <div className="flex items-center gap-1.5 tabular-nums">
          <ProgressBar value={reviewed} max={props.files.length} className="w-16" />
          {reviewed} of {count(props.files.length, "file")} reviewed
        </div>
      </div>
    </div>
  );
}

// One thread in the bar's list: where it is, its first comment, and how far it got. A click shows it on the canvas.
function ThreadRow(props: {
  root: ReviewEntry;
  replies: ReviewEntry[];
  answering: boolean;
  onClick: () => void;
}) {
  const { root: t, replies } = props;
  const lines = t.startLine === t.endLine ? `${t.startLine}` : `${t.startLine}–${t.endLine}`;
  const answers = replies.filter((r) => r.kind === "answer").length;
  const status = [
    t.resolvedAt && "resolved",
    t.state === "outdated" && "outdated",
    props.answering
      ? "agent answering…"
      : answers
        ? count(answers, "answer")
        : t.kind === "question" && "sent to agent",
    replies.length - answers > 0 && count(replies.length - answers, "reply", "replies"),
  ].filter(Boolean);
  return (
    <button
      onClick={props.onClick}
      className="flex items-baseline gap-2 px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      <span className={cn("shrink-0 font-mono", muted)}>
        {t.path!.split("/").at(-1)}:{lines}
      </span>
      <span className="min-w-0 flex-1 truncate">{t.body}</span>
      <span className={cn("shrink-0", muted)}>{status.join(" · ")}</span>
    </button>
  );
}
