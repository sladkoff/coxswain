import { useQuery } from "@tanstack/react-query";
import type { Commit, LoggedCommit } from "../../core/git";
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

// The Commits pane, left of the canvas: All Changes, then the agent turns that changed the worktree and the commits,
// newest first; those not pushed yet are marked, with Push (and Open Pull Request… for a branch without one). Picking a
// turn or a commit shows its diff (ADR 0028). A commit shows its subject over its sha, author, when and size.
export function Commits(props: Props) {
  const { workspaceId, current, onPick } = props;
  const listed = useQuery(core("listCommits", workspaceId, props.mergeBase)).data;
  const unpushed = useQuery(core("listCommits", workspaceId, props.head)).data;
  const turns = useQuery(core("listTurns", workspaceId)).data ?? [];
  const local = new Set(unpushed?.status === "ok" ? unpushed.commits.map((c) => c.sha) : []);
  const row = (on: boolean) => cn("flex gap-2 rounded px-2 py-1 text-left", selectable(on));
  const heading = cn("px-2 pt-2 pb-0.5 text-[11px] font-medium", muted);
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 text-xs">
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
      <button className={row(current === null)} onClick={() => onPick(null)}>
        All Changes
      </button>
      {turns.length > 0 && (
        <>
          <div className={heading}>Agent turns</div>
          {turns.map((t) => (
            <button
              key={t.turn}
              title={`${t.subject}\n${shortDateTime(t.turn!)}`}
              className={row(t.sha === current?.sha && t.parent === current.parent)}
              onClick={() => onPick(t)}
            >
              <span className={cn("shrink-0", muted)}>{shortDateTime(t.turn!)}</span>
              <span className="truncate">{t.subject}</span>
            </button>
          ))}
          <div className={heading}>Commits</div>
        </>
      )}
      {!listed ? (
        <div className={cn("px-2 py-1", muted)}>Loading…</div>
      ) : listed.status !== "ok" ? (
        <div className={cn("px-2 py-1", muted)}>
          <ProblemMessage problem={listed} />
        </div>
      ) : (
        listed.commits.map((c) => (
          <button
            key={c.sha}
            title={details(c, local.has(c.sha))}
            className={cn(row(c.sha === current?.sha && !current.turn), "flex-col gap-0")}
            onClick={() => onPick(c)}
          >
            <span className="flex w-full gap-2">
              <span className="truncate">{c.subject}</span>
              {c.merge && <span className={cn("shrink-0", muted)}>merge</span>}
              {local.has(c.sha) && <span className={cn("ml-auto shrink-0", muted)}>local</span>}
            </span>
            <span className={cn("flex w-full gap-1.5 text-[11px]", muted)}>
              <span className="shrink-0 font-mono">{c.sha.slice(0, 7)}</span>
              <span className="truncate">
                {c.author}
                {c.coAuthors.length > 0 && ` +${c.coAuthors.length}`} · {ago(c.date)}
              </span>
              {c.files > 0 && (
                <span className="ml-auto shrink-0 font-mono">
                  <span className="text-green-600 dark:text-green-500">+{c.additions}</span>{" "}
                  <span className="text-red-600 dark:text-red-500">−{c.deletions}</span>
                </span>
              )}
            </span>
          </button>
        ))
      )}
    </nav>
  );
}

// A commit's tooltip: its whole message, then who and when, and what it touched.
const details = (c: LoggedCommit, local: boolean) =>
  [
    [c.subject, c.body].filter(Boolean).join("\n\n"),
    "",
    `${c.author} <${c.email}>, ${shortDateTime(c.date)}`,
    ...(c.coAuthors.length ? [`With ${c.coAuthors.join(", ")}`] : []),
    ...(c.committer !== c.author ? [`Committed by ${c.committer}`] : []),
    c.merge ? "Merge commit" : `${count(c.files, "file")}, +${c.additions} −${c.deletions}`,
    c.sha,
    ...(local ? ["Not pushed"] : []),
  ].join("\n");
