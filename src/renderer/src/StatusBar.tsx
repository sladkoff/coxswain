import { useState } from "react";
import { match, P } from "ts-pattern";
import type { ReviewEntry } from "../../core/review";
import { Button, SegmentedControl, ToggleButton } from "./components/button";
import { ChevronDownIcon } from "./components/icons";
import { ProgressBar } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ErrorText } from "./components/text";
import { byAgent, count } from "./format";
import { changed } from "./queries";
import type { Turn } from "./Viewer";

type Props = {
  workspaceId: number;
  entries: ReviewEntry[];
  files: { path: string; additions?: number; deletions?: number }[];
  reviewed: string[];
  turns: Record<number, Turn>;
  onViewThread: (threadId: number) => void;
  viewTitle?: string; // the view on the canvas, whose prose threads are listed under it (ADR 0036)
  hasPr: boolean; // the workspace has a PR to post to (ADR 0037)
  onPost: () => void; // Post to GitHub: the PR panel, where the threads to post are picked
};

// The canvas's bottom bar: the review at a glance on the left (threads, with how many wait on the agent, how many of
// the file diffs on screen are reviewed, and their lines), and Hand off on the right. The thread count opens the
// threads above the bar.
export function StatusBar(props: Props) {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState<"open" | "resolved">("open");
  // Sending the open threads to the agent pane's session; the agent's reply shows there.
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const threads = props.entries.filter((e) => (e.path || e.section != null) && !e.parentId);
  // What Hand off takes, as the review prompt does (core/review.ts): not resolved, and not the agent's own explanations
  // or findings unless the user replied to them.
  const replied = new Set(
    props.entries.filter((e) => e.parentId && !byAgent(e)).map((e) => e.parentId),
  );
  const handOff = threads.filter((e) => !e.resolvedAt && (!byAgent(e) || replied.has(e.id)));
  const resolved = threads.filter((e) => e.resolvedAt);
  const openCount = threads.length - resolved.length;
  const answering = threads.filter((e) => props.turns[e.id]?.running).length;
  const reviewed = props.files.filter((f) => props.reviewed.includes(f.path)).length;
  const add = props.files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const del = props.files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const shown = listed === "open" ? threads.filter((e) => !e.resolvedAt) : resolved;
  // Under their file; those on the view's prose under it, first. "" can't be a path.
  const byFile = Map.groupBy(
    shown.toSorted((a, b) => Number(!!a.path) - Number(!!b.path)),
    (t) => t.path ?? "",
  );
  const handOffTo = async () => {
    const to = await window.coxswain.showHandOffMenu(props.hasPr);
    setError(null);
    if (to === "post") return props.onPost();
    if (to === "copy") {
      setCopied(await window.coxswain.copyReviewPrompt(props.workspaceId));
      setTimeout(() => setCopied(false), 1500);
      return;
    }
    setSending(true);
    const result = await window.coxswain.sendReview(props.workspaceId);
    setSending(false);
    if (result.status === "error") setError(result.message);
  };
  return (
    <div className={cn("flex max-h-[50%] shrink-0 flex-col border-t text-xs", divider)}>
      {open && (
        <div className={cn("flex min-h-0 flex-col border-b", divider)}>
          <div className={cn("flex shrink-0 items-center gap-2 border-b px-2 py-1", divider)}>
            <span className="font-medium">Threads</span>
            <SegmentedControl
              value={listed}
              onChange={setListed}
              options={[
                { value: "open", label: `Open ${openCount}` },
                { value: "resolved", label: `Resolved ${resolved.length}` },
              ]}
            />
          </div>
          <div className="min-h-0 overflow-y-auto py-1">
            {shown.length === 0 && (
              <div className={cn("px-2 py-1", muted)}>
                {threads.length === 0
                  ? "No threads yet. Click a line's gutter, or right-click a view's text, to start one."
                  : `No ${listed} threads.`}
              </div>
            )}
            {[...byFile].map(([path, list]) => (
              <div key={path} className="flex flex-col">
                <div
                  className={cn(
                    "px-2 pt-1.5 pb-0.5 text-blue-600 dark:text-blue-400",
                    path ? "font-mono text-[11px]" : "font-medium",
                  )}
                >
                  {path || (props.viewTitle ?? "This view")}
                </div>
                {list.map((t) => (
                  <ThreadRow
                    key={t.id}
                    root={t}
                    replies={props.entries.filter((e) => e.parentId === t.id)}
                    answering={!!props.turns[t.id]?.running}
                    onClick={() => props.onViewThread(t.id)}
                    onResolve={async (resolved) => {
                      await window.coxswain.resolveThread(t.id, resolved);
                      changed({ workspaceId: props.workspaceId, what: "entries" });
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={cn("flex h-8 shrink-0 items-center gap-3 px-2", muted)}>
        <ToggleButton
          on={open}
          aria-expanded={open}
          title={open ? "Hide the threads" : "Show the threads"}
          className={cn(
            "flex shrink-0 items-center gap-1.5 px-1.5",
            open && "text-neutral-900 dark:text-neutral-100",
          )}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={cn("flex", !open && "rotate-180")}>
            <ChevronDownIcon />
          </span>
          {/* The open threads, the ones still to deal with; all resolved says so rather than a count of nothing. */}
          {openCount > 0 || !resolved.length
            ? count(openCount, "open thread")
            : `All ${resolved.length} resolved`}
          {answering > 0 && (
            <span className="flex items-center gap-1">
              · <span className="size-1.5 rounded-full bg-amber-500" /> {answering} waiting
            </span>
          )}
        </ToggleButton>
        <div className={cn("h-4 border-l", divider)} />
        <div className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <ProgressBar value={reviewed} max={props.files.length} className="w-16" />
          {reviewed}/{props.files.length} reviewed
        </div>
        {props.files.some((f) => f.additions !== undefined) && (
          <>
            <div className={cn("h-4 border-l", divider)} />
            <span className="shrink-0 tabular-nums">
              <span className="text-green-600">+{add}</span>{" "}
              <span className="text-red-600">−{del}</span>
            </span>
          </>
        )}
        <div className="flex-1" />
        {error && <ErrorText className="truncate">{error}</ErrorText>}
        {sending && (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-neutral-400 border-t-transparent" />
            Agent working on {count(handOff.length, "thread")}
          </span>
        )}
        {copied && <span className="shrink-0">Copied</span>}
        <Button
          variant="primary"
          title={
            handOff.length
              ? "Send the open threads to the agent, copy them as a prompt, or post them to GitHub"
              : "Nothing to hand off: no open threads of yours (the agent's explanations count once you reply)"
          }
          className="flex shrink-0 items-center gap-1.5 py-0.5 pr-1.5"
          disabled={!handOff.length || sending}
          onClick={handOffTo}
        >
          Hand off
          {handOff.length > 0 && (
            <span className="rounded-full bg-white/20 px-1.5 text-[11px] leading-4 dark:bg-black/15">
              {handOff.length}
            </span>
          )}
          <ChevronDownIcon />
        </Button>
      </div>
    </div>
  );
}

// Where a thread was written, for one whose lines aren't in the range on screen.
const writtenIn = (t: ReviewEntry) =>
  match(t)
    .with({ viewId: P.number }, () => "in a view")
    .with({ head: P.string.select() }, (head) => `in ${head.slice(0, 7)}`)
    .otherwise(() => "in All");

// One thread in the bar's list, under its file: its lines, its first comment, and how far it got. A click shows it on
// the canvas; the ✓ at its end resolves it (or reopens it, among the resolved), as the thread's own ✓ does.
function ThreadRow(props: {
  root: ReviewEntry;
  replies: ReviewEntry[];
  answering: boolean;
  onClick: () => void;
  onResolve: (resolved: boolean) => void;
}) {
  const { root: t, replies } = props;
  const lines = match(t)
    .with({ section: P.number.select() }, (section) => `§ ${section + 1}`)
    .when(
      (t) => t.startLine === t.endLine,
      () => `${t.startLine}`,
    )
    .otherwise(() => `${t.startLine}–${t.endLine}`);
  const answers = replies.filter((r) => r.kind === "answer").length;
  const others = replies.length - answers;
  // The one state that matters most, as a dot and a word; replies after it. A current thread whose lines aren't in the
  // range on screen says where it was written (ADR 0015); a click goes there.
  const [dot, state] = match({ answering: props.answering, t, answers })
    .returnType<[string | null, string | null]>()
    .with({ answering: true }, () => ["bg-amber-500", "agent answering"])
    .with({ t: { state: "outdated" } }, () => ["bg-neutral-400", "outdated"])
    .with({ t: { shown: false } }, () => [null, writtenIn(t)])
    .with({ answers: P.number.gt(0) }, () => ["bg-green-600", count(answers, "answer")])
    .with({ t: { kind: "question" } }, () => ["bg-blue-500", "sent to agent"])
    .with({ t: { kind: "comment" } }, () => [null, `@${t.author} on GitHub`])
    .otherwise(() => [null, null]);
  return (
    <div className="flex items-center pr-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
      <button
        onClick={props.onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 py-1 pr-2 pl-5 text-left",
          (t.state === "outdated" || !t.shown) && muted,
        )}
      >
        <span className={cn("w-14 shrink-0 font-mono text-[11px]", muted)}>{lines}</span>
        <span className="min-w-0 flex-1 truncate">{t.body}</span>
        <span className={cn("flex shrink-0 items-center gap-1.5", muted)}>
          {dot && <span className={cn("size-1.5 rounded-full", dot)} />}
          {[state, others > 0 && count(others, "reply", "replies")].filter(Boolean).join(" · ")}
        </span>
      </button>
      <Button
        variant="ghost"
        title={t.resolvedAt ? "Reopen the thread" : "Resolve: mark the thread done"}
        aria-label={t.resolvedAt ? "Reopen" : "Resolve"}
        disabled={props.answering}
        className={cn("shrink-0 px-1.5 py-0.5", t.resolvedAt ? "text-green-600" : muted)}
        onClick={() => props.onResolve(!t.resolvedAt)}
      >
        ✓
      </Button>
    </div>
  );
}
