import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { match, P } from "ts-pattern";
import type {
  Check,
  CheckState,
  GitHubProblem,
  MergeMethod,
  PullRequestDetails,
} from "../../core/github";
import type { PullRequestChange, ReviewEvent } from "../../core/pull-requests";
import { Button, SegmentedControl } from "./components/button";
import { TextArea } from "./components/field";
import { cn, divider, muted } from "./components/styles";
import { ErrorText, ProblemMessage, Prose } from "./components/text";
import { ago, count } from "./format";
import { core, queryClient } from "./queries";

// The colour of a check's state, as a dot: on the PR panel, the canvas bar's PR chip and the Commits pane.
export const checkColour: Record<CheckState, string> = {
  success: "bg-green-600",
  failure: "bg-red-600",
  pending: "bg-amber-500",
  neutral: "bg-neutral-400",
};
export const CheckDot = ({ state, title }: { state: CheckState; title?: string }) => (
  <span
    title={title}
    className={cn("inline-block size-2 shrink-0 rounded-full", checkColour[state])}
  />
);

type Problem = GitHubProblem | null;
// What went wrong at GitHub, in words: its own message for a refused change, else what to do about it.
const ProblemText = ({ problem }: { problem: NonNullable<Problem> }) => (
  <ErrorText>
    {problem.status === "error" ? problem.message : <ProblemMessage problem={problem} />}
  </ErrorText>
);

const Section = ({
  title,
  children,
  end,
}: {
  title: string;
  children: ReactNode;
  end?: ReactNode;
}) => (
  <section className={cn("flex flex-col gap-2 border-t pt-3", divider)}>
    <div className="flex items-center gap-2">
      <h2 className="flex-1 text-xs font-semibold">{title}</h2>
      {end}
    </div>
    {children}
  </section>
);

// The PR panel (ADR 0037), the canvas's PR location: the PR as it is on GitHub (state, checks, description, people,
// conversation) and Post to GitHub, the threads to post as a review. Everything it changes on GitHub is a click of the
// user's: nothing is posted, merged or edited on its own.
export function PullRequestPanel(props: {
  workspaceId: number;
  pr: PullRequestDetails;
  onViewThread: (threadId: number) => void;
}) {
  const { pr, workspaceId } = props;
  const [problem, setProblem] = useState<Problem>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["readPullRequest", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["listPostable", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["listPullRequestTitles"] }),
    ]);
  // A change on GitHub; true once made.
  const change = async (c: PullRequestChange) => {
    setProblem(null);
    const r = await window.coxswain.changePullRequest(
      { id: pr.id, viewerId: pr.viewerId, head: pr.head },
      c,
    );
    if (r.status !== "ok") setProblem(r);
    await refresh();
    return r.status === "ok";
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto select-text">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 text-sm">
        <Header pr={pr} change={change} />
        {problem && <ProblemText problem={problem} />}
        <Checks workspaceId={workspaceId} pr={pr} />
        <Description pr={pr} change={change} />
        <People pr={pr} change={change} />
        <PostReview
          workspaceId={workspaceId}
          pr={pr}
          onViewThread={props.onViewThread}
          onPosted={refresh}
        />
        <Conversation pr={pr} change={change} />
      </div>
    </div>
  );
}

type Change = (c: PullRequestChange) => Promise<boolean>;

const methodLabels: Record<MergeMethod, string> = {
  merge: "Create a Merge Commit",
  squash: "Squash and Merge",
  rebase: "Rebase and Merge",
};

// Its title and state, where it goes, and what can be done with it next: Ready for Review for a draft, else Merge.
function Header({ pr, change }: { pr: PullRequestDetails; change: Change }) {
  const [state, colour] = match(pr)
    .returnType<[string, string]>()
    .with({ state: "open", draft: true }, () => ["Draft", "bg-neutral-500"])
    .with({ state: "open" }, () => ["Open", "bg-green-600"])
    .with({ state: "merged" }, () => ["Merged", "bg-purple-600"])
    .with({ state: "closed" }, () => ["Closed", "bg-red-600"])
    .exhaustive();
  const merge = async () => {
    const i =
      pr.mergeMethods.length > 1
        ? await window.coxswain.showPickMenu(
            pr.mergeMethods.map((m) => methodLabels[m]),
            0,
          )
        : 0;
    const method = pr.mergeMethods[i];
    const ok = await window.coxswain.confirm({
      message: `${methodLabels[method]} PR #${pr.number}?`,
      detail: `“${pr.title}” goes into ${pr.baseRef} on GitHub, as of ${pr.head.slice(0, 7)}. Local changes that aren't pushed aren't in it.`,
      action: methodLabels[method],
    });
    if (ok) await change({ kind: "merge", method });
  };
  const ready = async () => {
    const ok = await window.coxswain.confirm({
      message: `Mark PR #${pr.number} as ready for review?`,
      detail: "It stops being a draft on GitHub, and its reviewers are told.",
      action: "Ready for Review",
    });
    if (ok) await change({ kind: "ready" });
  };
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="text-lg font-semibold">
        <Prose inline>{pr.title}</Prose>{" "}
        <span className={cn("font-normal", muted)}>#{pr.number}</span>
      </h1>
      <div className={cn("flex flex-wrap items-center gap-2 text-xs", muted)}>
        <span className={cn("rounded-full px-2 py-0.5 text-white", colour)}>{state}</span>
        <span>
          {pr.author ?? "ghost"} wants to merge <code>{pr.headRef}</code> into{" "}
          <code>{pr.baseRef}</code>
        </span>
        <a href={pr.url} target="_blank" rel="noreferrer" className="underline">
          Open on GitHub
        </a>
        <div className="flex-1" />
        {pr.state === "open" &&
          (pr.draft ? (
            <Button onClick={ready}>Ready for Review</Button>
          ) : (
            <>
              <span>
                {pr.mergeable === "conflicting" ? "Has conflicts" : `Merge state: ${pr.mergeState}`}
              </span>
              <Button
                variant="primary"
                disabled={pr.mergeable === "conflicting" || !pr.mergeMethods.length}
                title={
                  pr.mergeable === "conflicting"
                    ? "Resolve the conflicts with the base branch first"
                    : "Merge it on GitHub, after asking"
                }
                onClick={merge}
              >
                Merge…
              </Button>
            </>
          ))}
      </div>
    </header>
  );
}

// The head commit's checks, failing first; a failing one can go to the agent with its log.
function Checks({ workspaceId, pr }: { workspaceId: number; pr: PullRequestDetails }) {
  const [sent, setSent] = useState<Record<string, string | null>>({}); // by name: null once sent, or what went wrong
  const order: CheckState[] = ["failure", "pending", "neutral", "success"];
  const checks = pr.checks.toSorted((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  const send = async (c: Check) => {
    setSent((s) => ({ ...s, [c.name]: null }));
    const r = await window.coxswain.sendCheck(workspaceId, c);
    if (r.status === "error") setSent((s) => ({ ...s, [c.name]: r.message }));
  };
  const failing = checks.filter((c) => c.state === "failure").length;
  return (
    <Section
      title="Checks"
      end={
        pr.checkState && (
          <span className={cn("flex items-center gap-1.5 text-xs", muted)}>
            <CheckDot state={pr.checkState} />
            {failing
              ? `${failing} failing`
              : { success: "All passed", pending: "Running", neutral: "Done", failure: "Failing" }[
                  pr.checkState
                ]}
          </span>
        )
      }
    >
      {!checks.length && (
        <div className={cn("text-xs", muted)}>No checks on {pr.head.slice(0, 7)}.</div>
      )}
      {checks.map((c) => (
        <div key={c.name} className="flex items-center gap-2 text-xs">
          <CheckDot state={c.state} title={c.state} />
          <span className="font-medium">{c.name}</span>
          <span className={cn("min-w-0 flex-1 truncate", muted)}>{c.detail}</span>
          {c.name in sent && (
            <span className={sent[c.name] ? "text-red-600" : muted}>
              {sent[c.name] ?? "Sent to Agent"}
            </span>
          )}
          {c.state === "failure" && (
            <Button
              className="py-0.5 text-xs"
              title="Send the check and the end of its log to the agent pane's session, to find out why it fails and fix it"
              disabled={c.name in sent && sent[c.name] === null}
              onClick={() => void send(c)}
            >
              Send to Agent
            </Button>
          )}
          {c.url && (
            <a href={c.url} target="_blank" rel="noreferrer" className={cn("underline", muted)}>
              Details
            </a>
          )}
        </div>
      ))}
    </Section>
  );
}

function Description({ pr, change }: { pr: PullRequestDetails; change: Change }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = async () => {
    if (editing !== null && (await change({ kind: "body", body: editing }))) setEditing(null);
  };
  return (
    <Section
      title="Description"
      end={
        pr.canUpdate &&
        editing === null && (
          <Button variant="ghost" className="px-1.5 text-xs" onClick={() => setEditing(pr.body)}>
            Edit
          </Button>
        )
      }
    >
      {match({ editing, body: pr.body.trim() })
        .with({ editing: P.string.select() }, (text) => (
          <>
            <TextArea
              long
              autoFocus
              rows={12}
              value={text}
              onChange={(e) => setEditing(e.target.value)}
              onSubmit={save}
              onCancel={() => setEditing(null)}
              placeholder="Markdown (⌘Enter to save)"
            />
            <div className="flex justify-end gap-1.5 text-xs">
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={save}>
                Save to GitHub
              </Button>
            </div>
          </>
        ))
        .with({ body: "" }, () => <div className={cn("text-xs", muted)}>No description.</div>)
        .otherwise(() => (
          <Prose>{pr.body}</Prose>
        ))}
    </Section>
  );
}

function People({ pr, change }: { pr: PullRequestDetails; change: Change }) {
  const mine = pr.assignees.includes(pr.viewer);
  const row = (label: string, value: ReactNode) => (
    <div className="flex items-baseline gap-2 text-xs">
      <span className={cn("w-20 shrink-0", muted)}>{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
  return (
    <Section title="People">
      {row(
        "Assignees",
        <span className="flex items-center gap-2">
          {pr.assignees.join(", ") || <span className={muted}>No one</span>}
          <Button
            variant="ghost"
            className={cn("px-1.5", muted)}
            onClick={() => void change({ kind: "assign", on: !mine })}
          >
            {mine ? "Unassign yourself" : "Assign yourself"}
          </Button>
        </span>,
      )}
      {row(
        "Reviewers",
        pr.reviewers.length ? (
          pr.reviewers.map((r) => `${r.login} (${r.state})`).join(", ")
        ) : (
          <span className={muted}>No one</span>
        ),
      )}
      {pr.labels.length > 0 &&
        row(
          "Labels",
          <span className="flex flex-wrap gap-1">
            {pr.labels.map((l) => (
              <span
                key={l.name}
                style={{ borderColor: `#${l.color}` }}
                className="rounded-full border px-1.5"
              >
                {l.name}
              </span>
            ))}
          </span>,
        )}
    </Section>
  );
}

const eventLabels: Record<ReviewEvent, string> = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request Changes",
};

// Post to GitHub (Hand off's): the threads with something to post, picked (all that can be, at first), as one review
// with a verdict and a summary. The agent's entries go only when asked, marked as the agent's.
function PostReview(props: {
  workspaceId: number;
  pr: PullRequestDetails;
  onViewThread: (threadId: number) => void;
  onPosted: () => Promise<unknown>;
}) {
  const listed = useQuery(core("listPostable", props.workspaceId));
  const threads = listed.data ?? [];
  const [unpicked, setUnpicked] = useState<Set<number>>(new Set());
  const [withAgent, setWithAgent] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const picked = threads.filter((t) => !t.problem && !unpicked.has(t.threadId));
  const own = props.pr.author === props.pr.viewer; // GitHub won't let you approve your own PR
  const agents = picked.reduce((n, t) => n + t.agents, 0);
  const post = async () => {
    const ok = await window.coxswain.confirm({
      message: `Post ${count(picked.length, "thread")} to PR #${props.pr.number} as a review?`,
      detail: `${eventLabels[event]}${withAgent && agents ? `, with ${count(agents, "answer")} of the agent's, marked as its` : ""}. It's posted as you, and everyone on the PR sees it.`,
      action: "Post",
    });
    if (!ok) return;
    setPosting(true);
    setProblem(null);
    const r = await window.coxswain.postReview(props.workspaceId, {
      threads: picked.map((t) => t.threadId),
      withAgent,
      event,
      body,
    });
    setPosting(false);
    if (r.status === "ok") {
      setBody("");
      setEvent("COMMENT");
    } else setProblem(r);
    await props.onPosted();
  };
  return (
    <Section title="Post to GitHub">
      {listed.isError && <ErrorText>{String(listed.error)}</ErrorText>}
      {!threads.length && (
        <div className={cn("text-xs", muted)}>
          Nothing new to post: your threads and replies here are on GitHub already.
        </div>
      )}
      {threads.map((t) => (
        <label
          key={t.threadId}
          className={cn("flex items-baseline gap-2 text-xs", t.problem && muted)}
        >
          <input
            type="checkbox"
            disabled={!!t.problem}
            checked={!t.problem && !unpicked.has(t.threadId)}
            onChange={(e) =>
              setUnpicked((u) => {
                const next = new Set(u);
                if (e.target.checked) next.delete(t.threadId);
                else next.add(t.threadId);
                return next;
              })
            }
          />
          <button
            className="min-w-0 flex-1 truncate text-left"
            title="Show the thread"
            onClick={(e) => {
              e.preventDefault();
              props.onViewThread(t.threadId);
            }}
          >
            <span className={cn("font-mono text-[11px]", muted)}>
              {t.path ?? "View"}:{t.lines}
            </span>{" "}
            {t.body}
          </button>
          <span className={cn("shrink-0", muted)}>
            {t.problem ??
              [
                match(t)
                  .with({ github: true }, () => "reply")
                  .with({ onFile: true }, () => "new, on the file")
                  .otherwise(() => "new"),
                t.yours && count(t.yours, "comment"),
                t.agents && `${count(t.agents, "answer")} of the agent's`,
                t.resolve === true && "resolve",
                t.resolve === false && "reopen",
              ]
                .filter(Boolean)
                .join(" · ")}
          </span>
        </label>
      ))}
      {threads.some((t) => t.agents) && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={withAgent}
            onChange={(e) => setWithAgent(e.target.checked)}
          />
          Include the agent's answers, marked as the agent's
        </label>
      )}
      <TextArea
        long
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onSubmit={() => void post()}
        placeholder="A summary for the review (optional)"
      />
      <div className="flex items-center justify-end gap-2">
        {problem && <ProblemText problem={problem} />}
        {!own && (
          <SegmentedControl
            value={event}
            onChange={setEvent}
            options={(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const).map((e) => ({
              value: e,
              label: eventLabels[e],
            }))}
          />
        )}
        <Button
          variant="primary"
          disabled={posting || (!picked.length && !body.trim() && event === "COMMENT")}
          onClick={() => void post()}
        >
          {posting ? "Posting…" : "Post Review…"}
        </Button>
      </div>
    </Section>
  );
}

// The PR's conversation, oldest first: comments on it, reviews' summaries and comments on whole files. A new comment
// goes to GitHub when sent.
function Conversation({ pr, change }: { pr: PullRequestDetails; change: Change }) {
  const [body, setBody] = useState("");
  const send = async () => {
    if (body.trim() && (await change({ kind: "comment", body: body.trim() }))) setBody("");
  };
  return (
    <Section title={`Conversation · ${pr.conversation.length}`}>
      {pr.conversation.map((c) => (
        <div key={c.id} className="flex flex-col gap-0.5">
          <div className={cn("flex items-center gap-1.5 text-xs", muted)}>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{c.author}</span>
            {c.review && <span>{c.review}</span>}
            {c.path && (
              <span>
                on <code>{c.path}</code>
              </span>
            )}
            <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
              {ago(c.createdAt)}
            </a>
          </div>
          {c.body && <Prose>{c.body}</Prose>}
        </div>
      ))}
      <TextArea
        long
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onSubmit={() => void send()}
        placeholder="Comment on the PR (⌘Enter to send to GitHub)"
      />
      <div className="flex justify-end">
        <Button disabled={!body.trim()} onClick={() => void send()}>
          Comment on GitHub
        </Button>
      </div>
    </Section>
  );
}
