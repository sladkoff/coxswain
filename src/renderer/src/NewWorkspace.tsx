import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { PullRequest } from "../../core/github";
import type { Project } from "../../core/projects";
import { Button, SegmentedControl } from "./components/button";
import { ChevronDownIcon, GitBranchIcon, GitPullRequestIcon } from "./components/icons";
import { Dialog, ListRow, ProblemCard, SearchField } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ErrorText } from "./components/text";
import { ago } from "./format";
import { core } from "./queries";

type Props = {
  project: Project;
  openPrNumbers: number[]; // PRs that already have a workspace
  openBranches: string[]; // branches that already have one
  onSelect: (pull: PullRequest) => void;
  // A workspace on a branch (ADR 0028); rejects with the reason if git won't take the name.
  onBranch: (branch: string, baseBranch: string) => Promise<void>;
  onClose: () => void;
};

// A new workspace, on one of two tabs: an open PR, or a branch (a new one, or one already on GitHub).
export function NewWorkspace(props: Props) {
  const [tab, setTab] = useState<"pr" | "branch">("pr");
  return (
    <Dialog
      title="New workspace"
      subtitle={`${props.project.owner}/${props.project.name}`}
      onClose={props.onClose}
    >
      <div className="flex shrink-0 px-4 pb-3">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: "pr", label: "Pull request", title: "Review or work on an open pull request" },
            { value: "branch", label: "Branch", title: "Start a branch, or work on one on GitHub" },
          ]}
        />
      </div>
      {tab === "pr" ? <PullRequests {...props} /> : <Branches {...props} />}
    </Dialog>
  );
}

const Empty = ({ children }: { children: string }) => (
  <div className={cn("py-3 text-center text-xs", muted)}>{children}</div>
);

const Badge = ({ children }: { children: string }) => (
  <span
    className={cn(
      "shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] dark:bg-neutral-800",
      muted,
    )}
  >
    {children}
  </span>
);

// The repository's open PRs, searchable; picking one opens its workspace, made if it has none.
function PullRequests({ project, openPrNumbers, onSelect }: Props) {
  const result = useQuery(core("listPullRequests", project.owner, project.name));
  const pulls = result.data?.status === "ok" ? result.data.pulls : null;
  const problem = result.data && result.data.status !== "ok" ? result.data : null;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = (pulls ?? []).filter(
    (p) => !q || `#${p.number} ${p.title} ${p.author} ${p.headRef}`.toLowerCase().includes(q),
  );
  return (
    <>
      <SearchField
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title, number, author or branch"
      />
      {problem && (
        <div className="px-4 pt-3">
          <ProblemCard problem={problem} onRetry={() => result.refetch()} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {shown.map((p) => (
          <ListRow key={p.number} className="flex items-start gap-2.5" onClick={() => onSelect(p)}>
            <span
              title={p.draft ? "Draft" : "Open"}
              className={cn(
                "mt-0.5 shrink-0",
                p.draft ? muted : "text-green-600 dark:text-green-500",
              )}
            >
              <GitPullRequestIcon />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{p.title}</span>
                {openPrNumbers.includes(p.number) && <Badge>Has a workspace</Badge>}
              </span>
              <span className={cn("truncate font-mono text-[11px]", muted)}>
                #{p.number} · {p.author} · {p.headRef}
              </span>
            </span>
            <span
              title={new Date(p.updatedAt).toLocaleString()}
              className={cn("shrink-0 text-xs", muted)}
            >
              {ago(p.updatedAt)}
            </span>
          </ListRow>
        ))}
        {!problem && (!pulls || !shown.length) && (
          <Empty>
            {!pulls ? "Loading…" : pulls.length === 0 ? "No open pull requests" : "No match"}
          </Empty>
        )}
      </div>
    </>
  );
}

// One field for a branch's name: it filters the repository's branches on GitHub, to work on one as it is there, and
// offers to create the name typed, from the default branch unless another is picked in the native menu.
function Branches({ project, openBranches, onBranch }: Props) {
  const query = useQuery(core("listBranches", project.id));
  const listed = query.data;
  const branches = listed?.status === "ok" ? listed.branches : null;
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string>();
  const base = picked ?? (listed?.status === "ok" ? listed.defaultBranch : undefined);
  const [error, setError] = useState<string | null>(null);
  const typed = name.trim();
  const q = typed.toLowerCase();
  const shown = (branches ?? []).filter((b) => b.toLowerCase().includes(q));
  const exists = !!branches?.includes(typed);
  const start = async (branch: string) => {
    if (!base) return;
    try {
      await onBranch(branch, base);
    } catch (err) {
      // An IPC rejection carries the core's message after Electron's own prefix.
      setError(
        (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
      );
    }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (typed) void start(typed);
  };
  return (
    <>
      <form onSubmit={create} className="contents">
        <SearchField
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Branch name: a new one, or one on GitHub"
        />
      </form>
      {typed && !exists && (
        <div className={cn("flex shrink-0 items-center gap-2 border-b px-4 py-2.5", divider)}>
          <span className="min-w-0 flex-1 truncate">
            <span className={muted}>New branch</span>{" "}
            <span className="font-mono text-[12px] font-medium">{typed}</span>
          </span>
          <Button
            type="button"
            title="The branch it starts from, and its PR goes into"
            disabled={!base}
            className="flex shrink-0 items-center gap-1 text-xs"
            onClick={async () => {
              if (!branches) return;
              const i = await window.coxswain.showPickMenu(branches, branches.indexOf(base!));
              setPicked(branches[i]);
            }}
          >
            <span className={muted}>from</span> {base ?? "…"} <ChevronDownIcon />
          </Button>
          <Button
            variant="primary"
            className="shrink-0 text-xs"
            disabled={!base}
            onClick={() => void start(typed)}
          >
            Create
          </Button>
        </div>
      )}
      {error && <ErrorText className="shrink-0 px-4 pt-2">{error}</ErrorText>}
      {listed && listed.status !== "ok" && (
        <div className="px-4 pt-3">
          <ProblemCard problem={listed} onRetry={() => void query.refetch()} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {shown.length > 0 && (
          <div className={cn("px-2 pt-1 pb-1 text-[10.5px] font-semibold tracking-wide", muted)}>
            ON GITHUB
          </div>
        )}
        {shown.map((b) => (
          <ListRow key={b} className="flex items-center gap-2.5" onClick={() => void start(b)}>
            <span className={cn("shrink-0", muted)}>
              <GitBranchIcon />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{b}</span>
            {b === base && !picked && <Badge>Default</Badge>}
            {openBranches.includes(b) && <Badge>Has a workspace</Badge>}
          </ListRow>
        ))}
        {!branches && !listed?.status && <Empty>Loading…</Empty>}
        {branches && !shown.length && !typed && <Empty>No branches on GitHub</Empty>}
      </div>
    </>
  );
}
