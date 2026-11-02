import { ChevronDownIcon, ChevronRightIcon } from "./components/icons";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { NewEntry, ReviewEntry } from "../../core/review";
import { Entry, TurnStatus } from "./ChatEntry";
import { Button, SegmentedControl } from "./components/button";
import { TextArea } from "./components/field";
import {
  ArrowUpIcon,
  CheckIcon,
  MessageSquareIcon,
  SendIcon,
  SpinnerIcon,
  XIcon,
} from "./components/icons";
import { cn, divider, muted } from "./components/styles";
import { ErrorText, Prose } from "./components/text";
import { ago, isComment, shortDateTime } from "./format";
import { core, queryClient } from "./queries";
import type { Ask, Turn } from "./Viewer";

// The lines a new thread is on, picked in a file diff's gutter.
export type Draft = { side: "old" | "new"; startLine: number; endLine: number };

export const lines = (start: number, end: number) =>
  start === end ? `Line ${start}` : `Lines ${start}–${end}`;
// What a thread is on, in its header: its lines, or on a view's prose the start of its quote (ADR 0036).
export const anchorLabel = (e: Pick<ReviewEntry, "section" | "code" | "startLine" | "endLine">) =>
  e.section != null ? quoted(e.code ?? "") : lines(e.startLine!, e.endLine!);
export const quoted = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return `“${t.length > 40 ? `${t.slice(0, 40)}…` : t}”`;
};
// contain: inline-size, so nothing in a box (a resolved thread's one-line header) widens the file diff's code column.
const box =
  "review-comment-card m-2 flex [contain:inline-size] flex-col gap-2 bg-neutral-50 p-3 font-sans text-sm shadow-sm dark:bg-neutral-800";

type DraftBoxProps = {
  label: string; // what it's on: its lines, or the passage quoted
  canPost: boolean; // the workspace has a PR, for Post to GitHub
  onSend: (body: string, toAgent: boolean, post: boolean) => void;
  onCancel: () => void;
};

// A new thread on the lines or passage picked.
export function DraftBox({ label, canPost, onSend, onCancel }: DraftBoxProps) {
  return (
    <div className={cn(box, "relative")} aria-label={label}>
      <span className="sr-only">{label}</span>
      <Button
        variant="ghost"
        title="Cancel (Esc)"
        aria-label="Cancel comment"
        className="absolute top-5 right-5 p-1"
        onClick={onCancel}
      >
        <XIcon />
      </Button>
      <Composer
        autoFocus
        rows={3}
        placeholder="Comment"
        canPost={canPost}
        onSend={onSend}
        onCancel={onCancel}
      />
    </div>
  );
}

type ComposerProps = {
  autoFocus?: boolean;
  rows: number;
  placeholder: string;
  // Replies follow the thread's kind; only a new thread offers a mode choice.
  reply?: boolean;
  comment?: boolean;
  // With a PR, a comment (a new comment thread, or a reply in one) has a Post to GitHub checkbox: on, it's posted at
  // once; off, it waits for Submit Review. One global preference, like the toggle.
  canPost?: boolean;
  onSend: (body: string, toAgent: boolean, post: boolean) => void;
  onCancel?: () => void;
};

// A comment's text, then the Post to GitHub checkbox, the Comment/Agent toggle and the send button on the right. Enter
// sends, Shift+Enter adds a line.
function Composer(props: ComposerProps) {
  const [body, setBody] = useState("");
  // A global preference (every composer shares it), so the query is updated at once, then stored.
  const saved = useQuery(core("getCommentToAgent")).data ?? false;
  const toAgent = !props.comment && (!!props.reply || saved);
  const setToAgent = (on: boolean) => {
    queryClient.setQueryData(core("getCommentToAgent").queryKey, on);
    void window.coxswain.setCommentToAgent(on);
  };
  const postNow = useQuery(core("getPostComments")).data ?? false;
  const postable = !!props.canPost && !toAgent && (!props.reply || !!props.comment);
  const setPostNow = (on: boolean) => {
    queryClient.setQueryData(core("getPostComments").queryKey, on);
    void window.coxswain.setPostComments(on);
  };
  // autoFocus loses to the gutter button, which takes focus when the drag that opened the box ends.
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!props.autoFocus) return;
    // Focus the draft without asking Chromium to scroll the whole input into view.
    // Its annotation opens below the selected line, which should keep its position.
    const t = setTimeout(() => input.current?.focus({ preventScroll: true }));
    return () => clearTimeout(t);
  }, []);
  const send = () => {
    if (!body.trim()) return;
    props.onSend(body.trim(), toAgent, postable && postNow);
    setBody("");
  };
  return (
    <div
      className="review-comment-composer flex min-w-0 flex-col gap-2"
      data-cancellable={!!props.onCancel}
    >
      <TextArea
        className={cn("w-full text-sm leading-relaxed", props.reply ? "min-h-8" : "min-h-20")}
        ref={input}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onSubmit={send}
        onCancel={props.onCancel}
        rows={props.rows}
        aria-label={`${props.placeholder} (Enter to send)`}
        placeholder={toAgent ? "Ask the agent about this change…" : "Add a comment…"}
      />
      <div className="flex items-center justify-end gap-3">
        {postable && (
          <label
            className={cn("mr-auto flex items-center gap-1.5 text-xs", muted)}
            title="On: the comment goes to the PR at once. Off: it waits here for Submit Review"
          >
            <input
              type="checkbox"
              checked={postNow}
              onChange={(e) => setPostNow(e.target.checked)}
            />
            Post to GitHub
          </label>
        )}
        <div className="flex-1" />
        {!props.comment && !props.reply && (
          <SegmentedControl
            value={toAgent}
            onChange={setToAgent}
            options={[
              {
                value: false,
                label: "Comment",
                icon: <MessageSquareIcon />,
                title: props.reply
                  ? "A note in the thread, for the agent to see with your next question"
                  : "A comment thread: Submit Review posts its comments to GitHub as you wrote them",
              },
              {
                value: true,
                label: "Agent",
                icon: <SendIcon />,
                title: props.reply
                  ? "Send to the agent, who answers in the thread"
                  : "An agent thread, to explore or change the code with the agent; it stays out of the review",
              },
            ]}
          />
        )}
        <Button
          variant="ghost"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 p-0 dark:bg-neutral-700"
          title={postable && postNow ? "Send and post to GitHub (Enter)" : "Send (Enter)"}
          disabled={!body.trim()}
          onClick={send}
        >
          <ArrowUpIcon />
        </Button>
      </div>
    </div>
  );
}

type ThreadBoxProps = {
  revealed?: boolean;
  revealVersion?: number;
  root: ReviewEntry; // the thread's first note or question
  replies: ReviewEntry[]; // notes, follow-up questions and answers, in order
  turn: Turn | undefined;
  canPost: boolean; // the workspace has a PR, for Post to GitHub
  onReply: (body: string, toAgent: boolean, post: boolean) => void;
  onStop: () => void;
  onAnswerPermission: (id: string, optionId: string) => void;
  onResolve: (resolved: boolean) => Promise<void>; // false: reopen; on GitHub too with Post to GitHub on
  onRemove: () => Promise<void>;
  onSend: () => void; // the latest note, to the agent
  onSummarize: () => Promise<string>; // an agent thread's comment, for the user to edit
  // A comment thread on the same lines or passage; post: posted at once too.
  onAddComment: (body: string, post: boolean) => Promise<void>;
};

// A thread: its first entry, the replies and answers, the reply streaming in while a turn runs, and a box to reply.
// A comment thread or an agent thread (glossary), and stays one. Each of the user's comments has its own ⋯ (Comment).
// The thread's ⋯ deletes the thread (the user's posted comments on GitHub too), not while others have replied; in an
// agent thread it also sends the latest note to the agent, or summarizes the thread as a comment, which opens below it
// to edit before it's added (and posted, with Post to GitHub on). Resolved, it folds to its header and first comment
// until reopened.
export function ThreadBox({
  revealed,
  revealVersion,
  root,
  replies,
  turn,
  canPost,
  onReply,
  onStop,
  onAnswerPermission,
  onResolve,
  onRemove,
  onSend,
  onSummarize,
  onAddComment,
}: ThreadBoxProps) {
  const [expanded, setExpanded] = useState(false);
  const [resolvedAt, setResolvedAt] = useState(root.resolvedAt);
  if (resolvedAt !== root.resolvedAt) {
    setResolvedAt(root.resolvedAt);
    setExpanded(false);
  }
  useEffect(() => {
    if (revealed) setExpanded(true);
  }, [revealed, revealVersion]);
  const showResolved = expanded;
  const running = turn?.running ?? false;
  const agent = !isComment(root);
  const postNow = useQuery(core("getPostComments")).data ?? false;
  const [error, setError] = useState<string | null>(null);
  // Summarize as Comment: being written (true), then the text to edit; "" when the thread leaves nothing for the
  // PR's author, which says so, with Write One to start from nothing all the same.
  const [summary, setSummary] = useState<string | boolean>(false);
  const [writing, setWriting] = useState(false);
  const lastOwn = [root, ...replies].findLast((e) => e.kind === "note" || e.kind === "question");
  const posted = [root, ...replies].some((e) => e.kind === "note" && e.githubId);
  const others = [root, ...replies].some((e) => e.kind === "comment");
  const firstUser =
    [root, ...replies].find((e) => e.kind === "note" || e.kind === "question") ?? root;
  const failing = (p: Promise<unknown>) => {
    setError(null);
    return p.catch((e: Error) =>
      setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")),
    );
  };
  const menu = async () => {
    // Others' comments on GitHub are theirs, and GitHub keeps a thread they replied to.
    const picked = await window.coxswain.showThreadMenu({
      edit: !agent && firstUser.kind === "note",
      send: agent && !running && lastOwn?.kind === "note",
      summarize: agent && !running && !root.resolvedAt && summary === false,
      delete: others ? "others" : true,
      url: root.githubUrl,
    });
    if (
      picked === "delete" &&
      (await window.coxswain.confirm({
        message: "Delete this thread?",
        detail: posted
          ? "Its comments are deleted here and on GitHub. This can't be undone."
          : "Its comments and the agent's answers are deleted. This can't be undone.",
        action: "Delete",
      }))
    )
      void failing(onRemove());
    if (picked === "send") onSend();
    if (picked === "summarize") {
      setSummary(true);
      setWriting(false);
      void failing(onSummarize().then(setSummary)).then(() =>
        setSummary((s) => (s === true ? false : s)),
      );
    }
    return picked;
  };
  const resolveControl = (
    <Button
      variant="ghost"
      title={
        (root.resolvedAt ? "Resolved: click to reopen" : "Resolve: mark the thread done") +
        (root.githubThreadId ? (postNow ? " · On GitHub too" : " · Here until Submit Review") : "")
      }
      aria-label={root.resolvedAt ? "Reopen thread" : "Resolve thread"}
      disabled={running}
      className={cn("shrink-0 px-1", root.resolvedAt && "text-green-600")}
      onClick={() => void failing(onResolve(!root.resolvedAt))}
    >
      <CheckIcon />
    </Button>
  );
  const disclosureControl = root.resolvedAt ? (
    <Button
      variant="ghost"
      className={cn("shrink-0 px-1", muted)}
      title={showResolved ? "Collapse thread" : "Expand thread"}
      aria-label={showResolved ? "Collapse thread" : "Expand thread"}
      aria-expanded={showResolved}
      onClick={() => setExpanded((before) => !before)}
    >
      {showResolved ? <ChevronDownIcon /> : <ChevronRightIcon />}
    </Button>
  ) : null;
  return (
    <div
      id={`thread:${root.id}`}
      data-window-pin={expanded || summary !== false || error ? "true" : undefined}
      className={box}
      aria-label={anchorLabel(root)}
    >
      {root.resolvedAt && !showResolved && (
        <div className={cn("flex items-center gap-2 text-xs", muted)}>
          {disclosureControl}
          <Button
            variant="ghost"
            className="min-w-0 flex-1 truncate text-left"
            style={{ justifyContent: "flex-start" }}
            title="Expand resolved thread"
            onClick={() => setExpanded(true)}
          >
            Resolved · {root.body}
          </Button>
          {resolveControl}
          <Button variant="ghost" className="px-1" title="Thread options" onClick={menu}>
            ⋯
          </Button>
        </div>
      )}
      {(!root.resolvedAt || showResolved) && (
        <>
          {/* The inset agent surface distinguishes speakers without a divider between messages. */}
          <div className="flex flex-col gap-3">
            {[root, ...replies].map((e) => (
              <Comment
                key={e.id}
                entry={e}
                run={failing}
                editable={!agent}
                leadingControl={e.id === firstUser.id ? disclosureControl : undefined}
                controls={e.id === firstUser.id ? resolveControl : undefined}
                onThreadMenu={e.id === firstUser.id ? menu : undefined}
              />
            ))}
            {/* After the turn, until its answer entry is read in place of it (#38). */}
            {(running ||
              turn?.permission ||
              turn?.error ||
              (!!turn?.live.some((c) => c.kind !== "user") &&
                [root, ...replies].at(-1)?.kind === "question")) && (
              <div className={agentReply}>
                <span className={author}>Agent</span>
                {(running || [root, ...replies].at(-1)?.kind === "question") &&
                  turn?.live
                    .filter((entry) => entry.kind !== "user")
                    .map((entry, index) => <Entry key={`live${index}`} entry={entry} />)}
                <div className="mt-2">
                  <TurnStatus
                    running={running}
                    queued={turn?.queued}
                    permission={turn?.permission ?? null}
                    error={turn?.error ?? null}
                    onAnswer={(optionId) => onAnswerPermission(turn!.permission!.id, optionId)}
                  />
                </div>
              </div>
            )}
          </div>
          {summary === true && (
            <div className={cn("flex items-center gap-1.5 text-xs", muted)}>
              <SpinnerIcon /> Summarizing as a comment…
            </div>
          )}
          {summary === "" && !writing && (
            <div className={cn("flex items-center gap-2 text-xs", muted)}>
              <span className="flex-1">Nothing in this thread is left for the PR's author.</span>
              <Button onClick={() => setWriting(true)}>Write One</Button>
              <Button onClick={() => setSummary(false)}>Dismiss</Button>
            </div>
          )}
          {typeof summary === "string" && (summary !== "" || writing) && (
            <div className={cn("flex flex-col gap-2 border-t pt-2", divider)}>
              <span className={cn("text-xs", muted)}>
                A new comment on {root.section != null ? "this passage" : "these lines"}, for the
                review
              </span>
              <EditBox
                body={summary}
                saveLabel={canPost && postNow ? "Save and Post" : "Save"}
                onSave={(body) =>
                  void failing(onAddComment(body, canPost && postNow)).then(() => setSummary(false))
                }
                onCancel={() => setSummary(false)}
              />
            </div>
          )}
          {running ? (
            <Button
              className="self-end text-xs"
              title={
                turn?.queued ? "Take the question off the queue; it stays as a note" : undefined
              }
              onClick={onStop}
            >
              {turn?.queued ? "Don't Send" : "Stop"}
            </Button>
          ) : (
            <div className={cn("flex flex-col gap-2 border-t pt-2", divider)}>
              <Composer
                rows={1}
                placeholder="Reply"
                reply
                comment={!agent}
                canPost={canPost}
                onSend={onReply}
              />
            </div>
          )}
        </>
      )}
      {error && <ErrorText className="text-xs">{error}</ErrorText>}
    </div>
  );
}

// A note, or with toAgent a question for the agent pane's session; its answer goes in the thread. post: the note is
// posted to GitHub at once; if that fails it stays here, for Submit Review, and a sheet says why.
export async function postEntry(e: NewEntry, toAgent: boolean, onAsk: Ask, post = false) {
  if (toAgent) return onAsk(e);
  const note = await window.coxswain.addNote(e);
  if (!post) return;
  const r = await window.coxswain
    .postComment(e.workspaceId, note.parentId ?? note.id)
    .catch((e: Error) => ({ status: "error" as const, message: e.message }));
  if (r.status !== "ok")
    await window.coxswain.showError({
      message: "The comment wasn't posted to GitHub",
      detail: `${r.status === "error" ? r.message : "Sign in to GitHub with gh."} It's kept here; Submit Review can post it.`,
    });
}

// A thread on the canvas, wired to the core: replies, the agent's turn, edit, resolve, delete and send.
export function EntryThread(props: {
  revealed?: boolean;
  revealVersion?: number;
  onResolved?: (id: number) => void;
  root: ReviewEntry;
  entries: ReviewEntry[]; // the workspace's
  turn: Turn | undefined;
  canPost: boolean;
  onAsk: Ask;
  onAnswerPermission: (threadId: number, id: string, optionId: string) => void;
}) {
  const { root, onAsk } = props;
  const workspaceId = root.workspaceId;
  return (
    <ThreadBox
      revealed={props.revealed}
      revealVersion={props.revealVersion}
      root={root}
      replies={props.entries.filter((e) => e.parentId === root.id)}
      turn={props.turn}
      canPost={props.canPost}
      onReply={(body, toAgent, post) =>
        postEntry({ workspaceId, body, parentId: root.id }, toAgent, onAsk, post)
      }
      onStop={() => window.coxswain.stopQuestion(root.id)}
      onAnswerPermission={(id, optionId) => props.onAnswerPermission(root.id, id, optionId)}
      onResolve={async (resolved) => {
        await window.coxswain.resolveThread(root.id, resolved);
        if (resolved) props.onResolved?.(root.id);
      }}
      onRemove={() => window.coxswain.deleteEntry(root.id)}
      onSend={() => onAsk({ workspaceId, threadId: root.id })}
      onSummarize={() => window.coxswain.summarizeThread(root.id)}
      onAddComment={async (body, post) => {
        const id = await window.coxswain.addCommentAt(root.id, body);
        if (!post) return;
        const r = await window.coxswain.postComment(workspaceId, id);
        if (r.status !== "ok")
          throw new Error(
            `Saved, but not posted: ${r.status === "error" ? r.message : "sign in to GitHub with gh"}. Submit Review can post it.`,
          );
      }}
    />
  );
}

// A comment's text being edited in place: Enter saves, Esc cancels, Shift+Enter adds a line.
function EditBox(props: {
  body: string;
  saveLabel?: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(props.body);
  const save = () => (body.trim() ? props.onSave(body) : props.onCancel());
  return (
    <div className="flex flex-col gap-1.5">
      <TextArea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onSubmit={save}
        onCancel={props.onCancel}
        rows={3}
      />
      <div className="flex justify-end gap-1.5 text-xs">
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          {props.saveLabel ?? "Save"}
        </Button>
      </div>
    </div>
  );
}

// Who wrote an entry the agent wrote, and why (glossary).
// Who wrote an entry, over it.
const author = "mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300";
const agentReply = "rounded-xl bg-neutral-200/60 p-4 dark:bg-neutral-900/80";

const agentLabels: Partial<Record<ReviewEntry["kind"], string>> = {
  answer: "Agent",
  explanation: "Explanation",
  finding: "Finding",
};

// One entry of a thread: the user's (a question marked as sent to the agent), the agent's (an answer, an explanation
// or a finding), or a comment on GitHub by its author (ADR 0037). One posted from here says so. The user's own have a
// ⋯: Edit (in place), Delete (a note; on GitHub too once posted), Open on GitHub. run: the change, failing under the
// thread.
function Comment({
  entry: e,
  run,
  editable,
  controls,
  leadingControl,
  onThreadMenu,
}: {
  entry: ReviewEntry;
  run: (p: Promise<unknown>) => unknown;
  editable: boolean;
  controls?: ReactNode;
  leadingControl?: ReactNode;
  onThreadMenu?: () => Promise<string>;
}) {
  const [editing, setEditing] = useState(false);
  const user = useQuery({
    ...core("currentUser"),
    staleTime: 300_000,
    enabled: e.kind === "note" || e.kind === "question",
  }).data;
  if (e.kind === "comment")
    return (
      <div>
        <span className={cn(author, "flex items-center gap-2")}>
          {leadingControl}@{e.author} <span className={cn("font-normal", muted)}>on GitHub</span>
          <span className="flex-1" />
          {controls}
          {onThreadMenu && (
            <Button variant="ghost" className="px-1" title="Thread options" onClick={onThreadMenu}>
              ⋯
            </Button>
          )}
        </span>
        <Prose className="leading-relaxed">{e.body}</Prose>
      </div>
    );
  const posted = e.githubUrl ? " · posted" : "";
  const label = agentLabels[e.kind] && `${agentLabels[e.kind]}${posted}`;
  if (label)
    return (
      <div className={agentReply}>
        <span
          className={cn(
            author,
            "flex items-center gap-2",
            e.kind === "finding" && "text-amber-600 dark:text-amber-400",
          )}
        >
          {leadingControl}
          {label}
          <span className="flex-1" />
          {controls}
          {onThreadMenu && (
            <Button variant="ghost" className="px-1" title="Thread options" onClick={onThreadMenu}>
              ⋯
            </Button>
          )}
        </span>
        <Prose className="leading-relaxed">{e.body}</Prose>
      </div>
    );
  if (editing)
    return (
      <EditBox
        body={e.body}
        saveLabel={e.githubId ? "Save Here and on GitHub" : "Save"}
        onSave={(body) => {
          setEditing(false);
          void run(window.coxswain.editEntry(e.id, body));
        }}
        onCancel={() => setEditing(false)}
      />
    );
  const menu = async () => {
    if (onThreadMenu) {
      if ((await onThreadMenu()) === "edit" && editable) setEditing(true);
      return;
    }
    const picked = await window.coxswain.showCommentMenu({
      edit: editable,
      delete: e.kind === "note",
      url: e.githubUrl,
    });
    if (picked === "edit" && editable) setEditing(true);
    if (
      picked === "delete" &&
      (await window.coxswain.confirm({
        message: "Delete this comment?",
        detail: e.githubId
          ? "It's deleted here and on GitHub. This can't be undone."
          : "This can't be undone.",
        action: "Delete",
      }))
    )
      void run(window.coxswain.deleteComment(e.id));
  };
  return (
    <div className="group flex flex-col gap-1.5 leading-relaxed select-text [overflow-wrap:anywhere]">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        {leadingControl}
        {user?.status === "signed-in" && (
          <img src={user.avatarUrl} alt="" className="size-5 shrink-0 rounded-full" />
        )}
        <span className="truncate font-medium">
          {user?.status === "signed-in" ? (user.name ?? user.login) : "You"}
        </span>
        <time dateTime={e.createdAt} title={shortDateTime(e.createdAt)} className={muted}>
          {ago(e.createdAt)}
        </time>
        {posted && <span className={muted}>Posted</span>}
        <div className="flex-1" />
        {controls}
        <Button
          variant="ghost"
          title={onThreadMenu ? "Thread options" : "Comment options"}
          className={cn("shrink-0 px-1 py-0", muted)}
          onClick={menu}
        >
          ⋯
        </Button>
      </div>
      <Prose className="text-sm leading-relaxed">{e.body}</Prose>
    </div>
  );
}
