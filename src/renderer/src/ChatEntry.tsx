import type { ReactNode } from "react";
import type { ChatEntry, Permission, SentComment } from "../../core/agents";
import { Button } from "./components/button";
import { cn, divider, muted } from "./components/styles";
import { ErrorText, Prose } from "./components/text";
import { count } from "./format";

// Agent replies are Markdown.
// ponytail: code blocks aren't highlighted; use @pierre/diffs' Shiki if they need it.
// onViewThread: shows a comment's thread on the canvas.
export function Entry({
  entry,
  onViewThread,
}: {
  entry: ChatEntry;
  onViewThread?: (threadId: number) => void;
}) {
  if (entry.comment) return <CommentCard comment={entry.comment} onViewThread={onViewThread} />;
  if (entry.review)
    return (
      <SentCard className={cn("px-2.5 py-2 text-xs", muted)}>
        Review sent to Agent · {count(entry.review.threads, "thread")}
      </SentCard>
    );
  if (entry.kind === "tool")
    // shrink-0: truncate's overflow lets a flex item shrink to nothing once the chat overflows, leaving only the gaps.
    return <div className={cn("shrink-0 truncate font-mono text-xs", muted)}>⏺ {entry.text}</div>;
  // my-3: room above and below the user's messages, between the agent's turns.
  if (entry.kind === "user")
    return (
      <div className="my-3 self-end rounded-md bg-neutral-100 px-2 py-1 whitespace-pre-wrap select-text [overflow-wrap:anywhere] dark:bg-neutral-800">
        {entry.text}
      </div>
    );
  return <Prose>{entry.text}</Prose>;
}

// What the user sent from outside the chat (a comment, a review), on the right like their messages.
function SentCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("my-3 max-w-[85%] shrink-0 self-end rounded-lg border", divider, className)}>
      {children}
    </div>
  );
}

// A comment sent from a thread: where it's from, the comment, and a way back to its thread.
function CommentCard({
  comment: c,
  onViewThread,
}: {
  comment: SentComment;
  onViewThread?: (threadId: number) => void;
}) {
  const view = () => onViewThread?.(c.threadId);
  return (
    <SentCard className="flex flex-col">
      <button
        onClick={view}
        className={cn("flex items-start gap-2 px-2.5 pt-2 text-left text-xs", muted)}
      >
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          Comment on <span className="font-mono">{c.where}</span> sent to Agent
        </span>
        <span>›</span>
      </button>
      <div className="line-clamp-6 px-2.5 py-1.5 whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
        {c.body}
      </div>
      <button
        onClick={view}
        className={cn(
          "border-t px-2.5 py-1.5 text-right text-xs hover:text-neutral-900 dark:hover:text-neutral-100",
          muted,
          divider,
        )}
      >
        View thread ›
      </button>
    </SentCard>
  );
}

// Where a turn is, in the agent pane or a thread: a tool use waiting for approval, still working, or its error.
export function TurnStatus(props: {
  running: boolean;
  permission: Permission | null;
  error: string | null;
  onAnswer: (optionId: string) => void;
}) {
  return (
    <>
      {props.permission ? (
        <PermissionPrompt permission={props.permission} onAnswer={props.onAnswer} />
      ) : (
        props.running && <div className={cn("text-xs", muted)}>Working…</div>
      )}
      {props.error && <ErrorText>{props.error}</ErrorText>}
    </>
  );
}

// A tool use the agent asks to make, which auto mode (or a question's default mode) wouldn't allow by itself, with the
// agent's options (ADR 0018, 8). The turn waits until one is picked, or it's stopped.
function PermissionPrompt({
  permission,
  onAnswer,
}: {
  permission: Permission;
  onAnswer: (optionId: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-md border border-neutral-300 p-1.5 text-xs dark:border-neutral-700">
      <span>Agent wants to:</span>
      <div className="max-h-24 overflow-y-auto font-mono whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
        {permission.title}
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        {permission.options.map((o) => (
          <Button
            key={o.id}
            variant={o.kind === "allow_once" ? "primary" : "default"}
            className="text-xs"
            onClick={() => onAnswer(o.id)}
          >
            {o.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
