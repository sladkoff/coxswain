import { useQuery } from "@tanstack/react-query";
import type { Commit, LoggedCommit, Size } from "../../core/git";
import { agentNames } from "./Agents";
import { core } from "./queries";
import { Button } from "./components/button";
import { cn, muted, selectable } from "./components/styles";
import { ErrorText, ProblemMessage } from "./components/text";
import { ago, count, shortDateTime } from "./format";

type Props = {
  workspaceId: number;
  mergeBase: string;
  head: string; // what's on GitHub; the commits after it aren't pushed
  canOpenPr: boolean; // a branch workspace without a PR yet
  problem: string | null; // why the last push failed
  current: Commit | null; // null: all changes
  onPick: (commit: Commit | null) => void;
  onPush: () => void;
  onOpenPullRequest: () => void;
};

// The Commits pane, left of the canvas: All Changes, then the commits, newest first; those not pushed yet are marked,
// with Push (and Open Pull Request… for a branch without one). Picking a commit shows its diff. A commit shows its
// subject over its sha, author, when and size.
export function Commits(props: Props) {
  const { workspaceId, current, onPick } = props;
  const listed = useQuery(core("listCommits", workspaceId, props.mergeBase)).data;
  const unpushed = useQuery(core("listCommits", workspaceId, props.head)).data;
  const local = new Set(unpushed?.status === "ok" ? unpushed.commits.map((c) => c.sha) : []);
  return (
    <nav className={pane}>
      {(local.size > 0 || props.canOpenPr) && (
        <div className="mb-1 flex items-center gap-2 px-2">
          <span className={cn("flex-1", muted)}>
            {local.size ? `${local.size} not pushed` : "Not on GitHub as a PR yet"}
          </span>
          {local.size > 0 && !props.canOpenPr && (
            <Button className="py-0.5" onClick={props.onPush}>
              Push
            </Button>
          )}
          {props.canOpenPr && (
            <Button className="py-0.5" onClick={props.onOpenPullRequest}>
              Open Pull Request…
            </Button>
          )}
        </div>
      )}
      {props.problem && <ErrorText className="mb-1 px-2">{props.problem}</ErrorText>}
      <AllChanges on={current === null} onPick={() => onPick(null)} />
      {!listed ? (
        <div className={cn("px-2 py-1", muted)}>Loading…</div>
      ) : listed.status !== "ok" ? (
        <div className={cn("px-2 py-1", muted)}>
          <ProblemMessage problem={listed} />
        </div>
      ) : (
        listed.commits.map((c) => (
          <Row
            key={c.sha}
            title={details(c, local.has(c.sha))}
            on={c.sha === current?.sha && !current.turn}
            onClick={() => onPick(c)}
            subject={c.subject}
            marks={[c.merge && "merge", local.has(c.sha) && "local"]}
            sha={c.sha}
            by={`${c.author}${c.coAuthors.length ? ` +${c.coAuthors.length}` : ""}`}
            date={c.date}
            size={c}
          />
        ))
      )}
    </nav>
  );
}

// The Turns pane, in the commits pane's place: All Changes, then the agent turns that changed the worktree, newest
// first, each with the agent that ran it as its author. Picking one shows its turn diff (ADR 0028).
export function Turns(props: {
  workspaceId: number;
  current: Commit | null;
  onPick: (turn: Commit | null) => void;
}) {
  const { current, onPick } = props;
  const turns = useQuery(core("listTurns", props.workspaceId)).data;
  return (
    <nav className={pane}>
      <AllChanges on={current === null} onPick={() => onPick(null)} />
      {!turns ? (
        <div className={cn("px-2 py-1", muted)}>Loading…</div>
      ) : !turns.length ? (
        <div className={cn("px-2 py-1", muted)}>No agent turn has changed the worktree yet</div>
      ) : (
        turns.map((t) => {
          const agent = t.agent ? agentNames[t.agent] : "Agent";
          return (
            <Row
              key={t.turn}
              title={`${t.subject}\n\n${agent}, ${shortDateTime(t.turn)}\n${size(t)}`}
              on={t.sha === current?.sha && t.parent === current.parent}
              onClick={() => onPick(t)}
              subject={t.subject}
              by={agent}
              date={t.turn}
              size={t}
            />
          );
        })
      )}
    </nav>
  );
}

const pane = "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 text-xs";

const AllChanges = ({ on, onPick }: { on: boolean; onPick: () => void }) => (
  <button className={cn("rounded px-2 py-1 text-left", selectable(on))} onClick={onPick}>
    All Changes
  </button>
);

// A commit or turn: its subject (and marks such as local) over its sha, who made it, when, and its lines added and
// removed.
function Row(props: {
  title: string;
  on: boolean;
  onClick: () => void;
  subject: string;
  marks?: (string | false)[];
  sha?: string;
  by: string;
  date: string;
  size: Size;
}) {
  const marks = (props.marks ?? []).filter(Boolean);
  return (
    <button
      title={props.title}
      className={cn("flex flex-col rounded px-2 py-1 text-left", selectable(props.on))}
      onClick={props.onClick}
    >
      <span className="flex w-full gap-2">
        <span className="truncate">{props.subject}</span>
        {marks.map((m, i) => (
          <span key={m as string} className={cn("shrink-0", muted, !i && "ml-auto")}>
            {m}
          </span>
        ))}
      </span>
      <span className={cn("flex w-full gap-1.5 text-[11px]", muted)}>
        {props.sha && <span className="shrink-0 font-mono">{props.sha.slice(0, 7)}</span>}
        <span className="truncate">
          {props.by} · {ago(props.date)}
        </span>
        {props.size.files > 0 && (
          <span className="ml-auto shrink-0 font-mono">
            <span className="text-green-600 dark:text-green-500">+{props.size.additions}</span>{" "}
            <span className="text-red-600 dark:text-red-500">−{props.size.deletions}</span>
          </span>
        )}
      </span>
    </button>
  );
}

// files -1: a turn whose size couldn't be read.
const size = (s: Size) =>
  s.files < 0 ? "Size unknown" : `${count(s.files, "file")}, +${s.additions} −${s.deletions}`;

// A commit's tooltip: its whole message, then who and when, and what it touched.
const details = (c: LoggedCommit, local: boolean) =>
  [
    [c.subject, c.body].filter(Boolean).join("\n\n"),
    "",
    `${c.author} <${c.email}>, ${shortDateTime(c.date)}`,
    ...(c.coAuthors.length ? [`With ${c.coAuthors.join(", ")}`] : []),
    ...(c.committer !== c.author ? [`Committed by ${c.committer}`] : []),
    c.merge ? "Merge commit" : size(c),
    c.sha,
    ...(local ? ["Not pushed"] : []),
  ].join("\n");
