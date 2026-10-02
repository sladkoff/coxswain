import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { NewEntry, ReviewEntry } from "../../core/review";
import { Entry, TurnStatus } from "./ChatEntry";
import { Button, SegmentedControl } from "./components/button";
import { TextArea } from "./components/field";
import { SendIcon } from "./components/icons";
import { cn, divider, muted } from "./components/styles";
import { Prose } from "./components/text";
import { byAgent } from "./format";
import { changed, core, queryClient } from "./queries";
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
  "m-2 flex [contain:inline-size] flex-col gap-1.5 rounded-md border border-neutral-300 bg-white p-2 font-sans text-sm dark:border-neutral-700 dark:bg-neutral-900";

type DraftBoxProps = {
  label: string; // what it's on: its lines, or the passage quoted
  onSend: (body: string, toAgent: boolean) => void;
  onCancel: () => void;
};

// A new thread on the lines or passage picked.
export function DraftBox({ label, onSend, onCancel }: DraftBoxProps) {
  return (
    <div className={box}>
      <div className={cn("flex items-center justify-between text-xs", muted)}>
        <span className="truncate">{label}</span>
        <Button variant="ghost" title="Cancel (Esc)" className="px-1" onClick={onCancel}>
          ✕
        </Button>
      </div>
      <Composer autoFocus rows={3} placeholder="Comment" onSend={onSend} onCancel={onCancel} />
    </div>
  );
}

type ComposerProps = {
  autoFocus?: boolean;
  rows: number;
  placeholder: string;
  // A reply's Comment/Agent pick is its box's own: Agent after the agent's own entry (afterAgent), so a conversation
  // carries on with Enter, else the saved preference until changed.
  reply?: boolean;
  afterAgent?: boolean;
  onSend: (body: string, toAgent: boolean) => void;
  onCancel?: () => void;
};

// A comment's text, then the Comment/Agent toggle and the send button on the right. Enter sends, Shift+Enter adds a line.
function Composer(props: ComposerProps) {
  const [body, setBody] = useState("");
  // A global preference (every composer shares it), so the query is updated at once, then stored.
  const saved = useQuery(core("getCommentToAgent")).data ?? false;
  const [picked, setPicked] = useState<boolean | null>(null);
  const toAgent = picked ?? (props.afterAgent || saved);
  const setToAgent = (on: boolean) => {
    if (props.reply) return setPicked(on);
    queryClient.setQueryData(core("getCommentToAgent").queryKey, on);
    void window.coxswain.setCommentToAgent(on);
  };
  // autoFocus loses to the gutter button, which takes focus when the drag that opened the box ends.
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!props.autoFocus) return;
    const t = setTimeout(() => input.current?.focus());
    return () => clearTimeout(t);
  }, []);
  const send = () => {
    if (!body.trim()) return;
    props.onSend(body.trim(), toAgent);
    setBody("");
  };
  return (
    <>
      <TextArea
        ref={input}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onSubmit={send}
        onCancel={props.onCancel}
        rows={props.rows}
        placeholder={`${props.placeholder} (Enter to send)`}
      />
      <div className="flex items-center justify-end gap-2">
        <SegmentedControl
          value={toAgent}
          onChange={setToAgent}
          options={[
            { value: false, label: "Comment", title: "Leave a comment for yourself" },
            {
              value: true,
              label: "Agent",
              title: "Send to the agent, who answers in the thread",
            },
          ]}
        />
        <Button variant="primary" title="Send (Enter)" disabled={!body.trim()} onClick={send}>
          <SendIcon />
        </Button>
      </div>
    </>
  );
}

type ThreadBoxProps = {
  root: ReviewEntry; // the thread's first note or question
  replies: ReviewEntry[]; // notes, follow-up questions and answers, in order
  turn: Turn | undefined;
  onReply: (body: string, toAgent: boolean) => void;
  onStop: () => void;
  onAnswerPermission: (id: string, optionId: string) => void;
  onEdit: (body: string) => void; // the first comment's text
  onResolve: (resolved: boolean) => void; // false: reopen
  onRemove: () => void;
  onSend: () => void; // the latest note, to the agent
};

// A thread: its first entry, the replies and answers, the reply streaming in while a turn runs, and a box to reply.
// Its ⋯ menu edits the first comment (the user's own only), deletes the thread, or sends its latest note to the agent.
// Resolved, it folds to its header and first comment until reopened.
export function ThreadBox({
  root,
  replies,
  turn,
  onReply,
  onStop,
  onAnswerPermission,
  onEdit,
  onResolve,
  onRemove,
  onSend,
}: ThreadBoxProps) {
  const running = turn?.running ?? false;
  const [editing, setEditing] = useState(false);
  const lastOwn = [root, ...replies].findLast((e) => e.kind === "note" || e.kind === "question");
  const menu = async () => {
    // A comment on GitHub is edited there; a thread from GitHub comes back with its next read, so it isn't deleted.
    const picked = await window.coxswain.showThreadMenu({
      edit: (root.kind === "note" || root.kind === "question") && !root.githubId,
      send: !running && lastOwn?.kind === "note",
      delete: !root.githubThreadId,
      url: root.githubUrl,
    });
    if (picked === "edit") setEditing(true);
    if (
      picked === "delete" &&
      (await window.coxswain.confirm({
        message: "Delete this thread?",
        detail: "Its comments and the agent's answers are deleted. This can't be undone.",
        action: "Delete",
      }))
    )
      onRemove();
    if (picked === "send") onSend();
  };
  return (
    <div id={`thread:${root.id}`} className={box}>
      <div className={cn("flex items-center gap-2 text-xs", muted)}>
        <span className={root.section != null ? "min-w-0 truncate" : "shrink-0"}>
          {anchorLabel(root)}
          {root.state === "outdated" && " · outdated"}
          {root.githubThreadId && " · on GitHub"}
        </span>
        {root.resolvedAt ? (
          <span className="min-w-0 flex-1 truncate">Resolved · {root.body}</span>
        ) : (
          <div className="flex-1" />
        )}
        <Button
          variant="ghost"
          title={
            (root.resolvedAt
              ? "Resolved: click to reopen"
              : "Resolve: mark the thread done; it folds to one line") +
            (root.githubThreadId ? "\nHere only, until Post to GitHub sends it" : "")
          }
          disabled={running}
          className={cn("px-1", root.resolvedAt && "text-green-600")}
          onClick={() => onResolve(!root.resolvedAt)}
        >
          ✓
        </Button>
        <Button
          variant="ghost"
          title="Edit, delete or send to the agent"
          className="px-1"
          onClick={menu}
        >
          ⋯
        </Button>
      </div>
      {(!root.resolvedAt || editing) && (
        <>
          <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
            {editing ? (
              <EditBox
                body={root.body}
                onSave={(body) => {
                  onEdit(body);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <Comment entry={root} />
            )}
            {replies.map((e) => (
              <Comment key={e.id} entry={e} />
            ))}
            {turn?.live
              .filter((c) => c.kind !== "user")
              .map((c, i) => (
                <Entry key={`live${i}`} entry={c} />
              ))}
            <TurnStatus
              running={running}
              queued={turn?.queued}
              permission={turn?.permission ?? null}
              error={turn?.error ?? null}
              onAnswer={(optionId) => onAnswerPermission(turn!.permission!.id, optionId)}
            />
          </div>
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
            <div className={cn("flex flex-col gap-1.5 border-t pt-1.5", divider)}>
              <Composer
                rows={1}
                placeholder="Reply"
                reply
                afterAgent={byAgent(replies.at(-1) ?? root)}
                onSend={onReply}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// A note, or with toAgent a question for the agent pane's session; its answer goes in the thread.
export async function postEntry(e: NewEntry, toAgent: boolean, onAsk: Ask) {
  if (toAgent) return onAsk(e);
  await window.coxswain.addNote(e);
  changed({ workspaceId: e.workspaceId, what: "entries" });
}

// A thread on the canvas, wired to the core: replies, the agent's turn, edit, resolve, delete and send.
export function EntryThread(props: {
  root: ReviewEntry;
  entries: ReviewEntry[]; // the workspace's
  turn: Turn | undefined;
  onAsk: Ask;
  onAnswerPermission: (threadId: number, id: string, optionId: string) => void;
}) {
  const { root, onAsk } = props;
  const workspaceId = root.workspaceId;
  const done = () => changed({ workspaceId, what: "entries" });
  return (
    <ThreadBox
      root={root}
      replies={props.entries.filter((e) => e.parentId === root.id)}
      turn={props.turn}
      onReply={(body, toAgent) =>
        postEntry({ workspaceId, body, parentId: root.id }, toAgent, onAsk)
      }
      onStop={() => window.coxswain.stopQuestion(root.id)}
      onAnswerPermission={(id, optionId) => props.onAnswerPermission(root.id, id, optionId)}
      onEdit={(body) => window.coxswain.editEntry(root.id, body).then(done)}
      onResolve={(resolved) => window.coxswain.resolveThread(root.id, resolved).then(done)}
      onRemove={() => window.coxswain.deleteEntry(root.id).then(done)}
      onSend={() => onAsk({ workspaceId, threadId: root.id })}
    />
  );
}

// A comment's text being edited in place: Enter saves, Esc cancels, Shift+Enter adds a line.
function EditBox(props: { body: string; onSave: (body: string) => void; onCancel: () => void }) {
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
          Save
        </Button>
      </div>
    </div>
  );
}

// Who wrote an entry the agent wrote, and why (glossary).
const agentLabels: Partial<Record<ReviewEntry["kind"], string>> = {
  answer: "Agent",
  explanation: "Explanation",
  finding: "Finding",
};

// One entry of a thread: the user's (a question marked as sent to the agent), the agent's (an answer, an explanation
// or a finding), or a comment on GitHub by its author (ADR 0037). One posted from here says so.
function Comment({ entry: e }: { entry: ReviewEntry }) {
  if (e.kind === "comment")
    return (
      <div>
        <span className={cn("block text-xs", muted)}>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">@{e.author}</span> on
          GitHub
        </span>
        <Prose>{e.body}</Prose>
      </div>
    );
  const posted = e.githubUrl ? " · posted" : "";
  const label = agentLabels[e.kind] && `${agentLabels[e.kind]}${posted}`;
  if (label)
    return (
      <div>
        <span
          className={cn(
            "block text-xs",
            e.kind === "finding" ? "text-amber-600 dark:text-amber-400" : muted,
          )}
        >
          {label}
        </span>
        <Prose>{e.body}</Prose>
      </div>
    );
  return (
    <div className="whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
      <span className={cn("block text-xs", muted)}>
        {e.kind === "question" ? "You → agent" : "You"}
        {posted}
      </span>
      {e.body}
    </div>
  );
}
