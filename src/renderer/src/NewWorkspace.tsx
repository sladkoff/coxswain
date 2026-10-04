import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { PullRequest } from "../../core/github";
import type { Project } from "../../core/projects";
import { Button } from "./components/button";
import { ChevronDownIcon, GitBranchIcon, GitPullRequestIcon } from "./components/icons";
import { Dialog, ListHeading, ListRow, ProblemCard, SearchField } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ErrorText } from "./components/text";
import { ago, gitHubOf, projectLabel } from "./format";
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

// A new workspace from one search field: it finds the repository's open PRs and its branches on GitHub, and offers to
// create the name typed as a new branch (spaces become dashes), from the default branch unless another is picked.
export function NewWorkspace({
  project,
  openPrNumbers,
  openBranches,
  onSelect,
  onBranch,
  onClose,
}: Props) {
  // ADR 0040: a project not on GitHub has branches only.
  const repo = gitHubOf(project);
  const pullsQuery = useQuery({
    ...core("listPullRequests", repo?.owner ?? "", repo?.name ?? ""),
    enabled: !!repo,
  });
  const branchesQuery = useQuery(core("listBranches", project.id));
  const pulls = pullsQuery.data?.status === "ok" ? pullsQuery.data.pulls : null;
  const listed = branchesQuery.data;
  const branches = listed?.status === "ok" ? listed.branches : null;
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string>();
  const base = picked ?? (listed?.status === "ok" ? listed.defaultBranch : undefined);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const name = branchName(query);
  const shownPulls = (pulls ?? []).filter(
    (p) => !q || `#${p.number} ${p.title} ${p.author} ${p.headRef}`.toLowerCase().includes(q),
  );
  // A branch with an open PR is found as that PR.
  const heads = new Set((pulls ?? []).map((p) => p.headRef));
  const shownBranches = (branches ?? []).filter(
    (b) =>
      !heads.has(b) &&
      (b.toLowerCase().includes(q) || b.toLowerCase().includes(name.toLowerCase())),
  );
  const exists = !!branches?.includes(name);
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
  // Enter creates the branch only when nothing was found, so it never swallows a search for a PR.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name && !exists && !shownPulls.length && !shownBranches.length) void start(name);
  };
  const problems = [...(repo ? [pullsQuery] : []), branchesQuery].flatMap((r) =>
    r.data && r.data.status !== "ok" ? [{ problem: r.data, retry: () => void r.refetch() }] : [],
  );
  const loading = (repo && !pullsQuery.data) || !branchesQuery.data;
  return (
    <Dialog title="New workspace" subtitle={projectLabel(project)} onClose={onClose}>
      <form onSubmit={submit} className="contents">
        <SearchField
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          placeholder={
            repo
              ? "Search pull requests and branches, or name a new branch"
              : "Search branches, or name a new branch"
          }
        />
      </form>
      {name && !exists && (
        <div className={cn("flex shrink-0 items-center gap-2 border-b px-4 py-2.5", divider)}>
          <span className="min-w-0 flex-1 truncate">
            <span className={muted}>New branch</span>{" "}
            <span className="font-mono text-[12px] font-medium">{name}</span>
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
            onClick={() => void start(name)}
          >
            Create
          </Button>
        </div>
      )}
      {error && <ErrorText className="shrink-0 px-4 pt-2">{error}</ErrorText>}
      {problems.map(({ problem, retry }, i) => (
        <div key={i} className="px-4 pt-3">
          <ProblemCard problem={problem} onRetry={retry} />
        </div>
      ))}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
        {shownPulls.length > 0 && <ListHeading>PULL REQUESTS</ListHeading>}
        {shownPulls.map((p) => (
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
        {shownBranches.length > 0 && (
          <ListHeading>{repo && !project.path ? "BRANCHES ON GITHUB" : "BRANCHES"}</ListHeading>
        )}
        {shownBranches.map((b) => (
          <ListRow key={b} className="flex items-center gap-2.5" onClick={() => void start(b)}>
            <span className={cn("shrink-0", muted)}>
              <GitBranchIcon />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{b}</span>
            {b === base && !picked && <Badge>Default</Badge>}
            {openBranches.includes(b) && <Badge>Has a workspace</Badge>}
          </ListRow>
        ))}
        {loading && <Empty>Loading…</Empty>}
        {!loading && !q && !shownPulls.length && !shownBranches.length && (
          <Empty>{repo ? "No open pull requests or branches" : "No branches"}</Empty>
        )}
      </div>
    </Dialog>
  );
}

// What's typed, as a branch name: spaces become dashes ("some improvement" → "some-improvement").
const branchName = (typed: string) => typed.trim().replace(/\s+/g, "-");

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
