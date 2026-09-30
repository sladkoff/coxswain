import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReviewEntry } from "../../core/review";
import { Entry, TurnStatus } from "./ChatEntry";
import { Button, SegmentedControl } from "./components/button";
import { TextArea } from "./components/field";
import { SendIcon } from "./components/icons";
import { cn, divider, muted } from "./components/styles";
import { Prose } from "./components/text";
import { byAgent } from "./format";
import { core, queryClient } from "./queries";
import type { Turn } from "./Viewer";

// The lines a new thread is on, picked in a file diff's gutter.
export type Draft = { side: "old" | "new"; startLine: number; endLine: number };

export const lines = (start: number, end: number) =>
  start === end ? `Line ${start}` : `Lines ${start}–${end}`;
// contain: inline-size, so nothing in a box (a resolved thread's one-line header) widens the file diff's code column.
const box =
  "m-2 flex [contain:inline-size] flex-col gap-1.5 rounded-md border border-neutral-300 bg-white p-2 font-sans text-sm dark:border-neutral-700 dark:bg-neutral-900";

type DraftBoxProps = {
  draft: Draft;
  onSend: (body: string, toAgent: boolean) => void;
  onCancel: () => void;
};

// A new thread on the lines picked.
export function DraftBox({ draft, onSend, onCancel }: DraftBoxProps) {
  const [start, end] = [draft.startLine, draft.endLine].sort((a, b) => a - b);
  return (
    <div className={box}>
      <div className={cn("flex items-center justify-between text-xs", muted)}>
        <span>{lines(start, end)}</span>
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
    const picked = await window.coxswain.showThreadMenu({
      edit: root.kind === "note" || root.kind === "question",
      send: !running && lastOwn?.kind === "note",
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
        <span className="shrink-0">
          {lines(root.startLine!, root.endLine!)}
          {root.state === "outdated" && " · outdated"}
        </span>
        {root.resolvedAt ? (
          <span className="min-w-0 flex-1 truncate">Resolved · {root.body}</span>
        ) : (
          <div className="flex-1" />
        )}
        <Button
          variant="ghost"
          title={
            root.resolvedAt
              ? "Resolved: click to reopen"
              : "Resolve: mark the thread done; it folds to one line"
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

// One entry of a thread: the user's (a question marked as sent to the agent), or the agent's: an answer, an
// explanation or a finding.
function Comment({ entry: e }: { entry: ReviewEntry }) {
  const label = agentLabels[e.kind];
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
      </span>
      {e.body}
    </div>
  );
}
