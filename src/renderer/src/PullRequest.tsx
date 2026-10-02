import { type ReactNode, useState } from "react";
import { match, P } from "ts-pattern";
import type {
  Check,
  CheckState,
  GitHubProblem,
  MergeMethod,
  PullRequestDetails,
} from "../../core/github";
import type { PullRequestChange } from "../../core/pull-requests";
import { Button } from "./components/button";
import { TextArea } from "./components/field";
import { Card } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ErrorText, ProblemMessage, Prose } from "./components/text";
import { ago } from "./format";
import { queryClient } from "./queries";

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
export const ProblemText = ({ problem }: { problem: NonNullable<Problem> }) => (
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

// A block of the side column: a small heading, then who or what.
const Side = ({
  title,
  children,
  end,
}: {
  title: string;
  children: ReactNode;
  end?: ReactNode;
}) => (
  <div className={cn("flex flex-col gap-1 border-b pb-3 text-xs", divider)}>
    <div className={cn("flex items-center gap-2 font-semibold", muted)}>
      <span className="flex-1">{title}</span>
      {end}
    </div>
    {children}
  </div>
);

// The PR panel (ADR 0037), the canvas's PR location, laid out like the PR's page on GitHub: its title and state, then
// a column of the description, the conversation, the checks with merging under them and a comment box, beside a
// column of its people and labels (under it in a narrow canvas).
// Everything it changes on GitHub is a click of the user's: nothing is posted, merged or edited on its own.
export function PullRequestPanel(props: { workspaceId: number; pr: PullRequestDetails }) {
  const { pr, workspaceId } = props;
  const [problem, setProblem] = useState<Problem>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["readPullRequest", workspaceId] }),
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
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 text-sm">
        <Header pr={pr} />
        {problem && <ProblemText problem={problem} />}
        {/* The side column wraps under the main one once that would be narrower than its basis. */}
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[999_1_28rem] flex-col gap-4">
            <Description pr={pr} change={change} />
            <Conversation pr={pr} />
            <Checks workspaceId={workspaceId} pr={pr} change={change} />
            <CommentBox change={change} />
          </div>
          <People pr={pr} change={change} />
        </div>
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

// Its title and state, and where it goes.
function Header({ pr }: { pr: PullRequestDetails }) {
  const [state, colour] = match(pr)
    .returnType<[string, string]>()
    .with({ state: "open", draft: true }, () => ["Draft", "bg-neutral-500"])
    .with({ state: "open" }, () => ["Open", "bg-green-600"])
    .with({ state: "merged" }, () => ["Merged", "bg-purple-600"])
    .with({ state: "closed" }, () => ["Closed", "bg-red-600"])
    .exhaustive();
  return (
    <header className={cn("flex flex-col gap-1.5 border-b pb-3", divider)}>
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
      </div>
    </header>
  );
}

// The head commit's checks, failing first; a failing one can go to the agent with its log. Under them, what can be
// done with the PR next: Ready for Review for a draft, else Merge.
function Checks({
  workspaceId,
  pr,
  change,
}: {
  workspaceId: number;
  pr: PullRequestDetails;
  change: Change;
}) {
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
  const [sent, setSent] = useState<Record<string, string | null>>({}); // by name: null once sent, or what went wrong
  const order: CheckState[] = ["failure", "pending", "neutral", "success"];
  const checks = pr.checks.toSorted((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  const send = async (c: Check) => {
    setSent((s) => ({ ...s, [c.name]: null }));
    const r = await window.coxswain.sendCheck(workspaceId, c);
    if (r.status === "error") setSent((s) => ({ ...s, [c.name]: r.message }));
  };
  const failing = checks.filter((c) => c.state === "failure").length;
  // Failing and running ones show; the passed and skipped fold away, so a long list is as long as what needs a look.
  const open = checks.filter((c) => c.state === "failure" || c.state === "pending");
  const done = checks.filter((c) => c.state === "success" || c.state === "neutral");
  const passed = done.filter((c) => c.state === "success").length;
  const row = (c: Check) => (
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
  );
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
      {open.map(row)}
      {done.length > 0 && (
        <details className="flex flex-col text-xs">
          <summary className={cn("cursor-default", muted)}>
            {[
              passed && `${passed} passed`,
              done.length - passed && `${done.length - passed} skipped`,
            ]
              .filter(Boolean)
              .join(", ")}
          </summary>
          <div className="flex flex-col gap-2 pt-2">{done.map(row)}</div>
        </details>
      )}
      {pr.state === "open" && (
        <div className={cn("flex items-center gap-2 border-t pt-2 text-xs", divider, muted)}>
          {pr.draft ? (
            <>
              <span className="flex-1">This PR is a draft.</span>
              <Button onClick={ready}>Ready for Review</Button>
            </>
          ) : (
            <>
              <span className="flex-1">
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
          )}
        </div>
      )}
    </Section>
  );
}

function Description({ pr, change }: { pr: PullRequestDetails; change: Change }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = async () => {
    if (editing !== null && (await change({ kind: "body", body: editing }))) setEditing(null);
  };
  return (
    <Card className="flex flex-col gap-2">
      <div className={cn("flex items-center gap-1.5 text-xs", muted)}>
        <span className="font-medium text-neutral-900 dark:text-neutral-100">
          {pr.author ?? "ghost"}
        </span>
        <span className="flex-1">Description</span>
        {pr.canUpdate && editing === null && (
          <Button variant="ghost" className="px-1.5 text-xs" onClick={() => setEditing(pr.body)}>
            Edit
          </Button>
        )}
      </div>
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
    </Card>
  );
}

// The side column: reviewers with where they are, assignees, labels.
function People({ pr, change }: { pr: PullRequestDetails; change: Change }) {
  const mine = pr.assignees.includes(pr.viewer);
  const none = <span className={muted}>None yet</span>;
  return (
    <aside className="flex flex-[1_0_14rem] flex-col gap-3">
      <Side title="Reviewers">
        {pr.reviewers.map((r) => (
          <div key={r.login} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate">{r.login}</span>
            <span className={muted}>{r.state}</span>
          </div>
        ))}
        {!pr.reviewers.length && none}
      </Side>
      <Side
        title="Assignees"
        end={
          <Button
            variant="ghost"
            className="px-1.5 font-normal"
            onClick={() => void change({ kind: "assign", on: !mine })}
          >
            {mine ? "Unassign yourself" : "Assign yourself"}
          </Button>
        }
      >
        {pr.assignees.map((a) => (
          <div key={a}>{a}</div>
        ))}
        {!pr.assignees.length && none}
      </Side>
      <Side title="Labels">
        {pr.labels.length ? (
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
          </span>
        ) : (
          none
        )}
      </Side>
    </aside>
  );
}

// The PR's conversation, oldest first: comments on it, reviews' summaries and comments on whole files.
function Conversation({ pr }: { pr: PullRequestDetails }) {
  return (
    <Section title={`Conversation · ${pr.conversation.length}`}>
      {pr.conversation.map((c) => (
        <Card key={c.id} className="flex flex-col gap-2">
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
        </Card>
      ))}
      {!pr.conversation.length && <div className={cn("text-xs", muted)}>No comments yet.</div>}
    </Section>
  );
}

// A new comment on the PR, at the end of its page; it goes to GitHub when sent.
function CommentBox({ change }: { change: Change }) {
  const [body, setBody] = useState("");
  const send = async () => {
    if (body.trim() && (await change({ kind: "comment", body: body.trim() }))) setBody("");
  };
  return (
    <Section title="Add a comment">
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
