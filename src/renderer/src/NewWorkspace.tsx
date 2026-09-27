import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { PullRequest } from "../../core/github";
import type { Project } from "../../core/projects";
import { Button } from "./components/button";
import { Input } from "./components/field";
import { ChevronDownIcon } from "./components/icons";
import { ListRow, ProblemCard, Screen } from "./components/layout";
import { cn, muted } from "./components/styles";
import { ErrorText, ProblemMessage } from "./components/text";
import { core } from "./queries";

type Props = {
  project: Project;
  openPrNumbers: number[]; // PRs that already have a workspace
  onSelect: (pull: PullRequest) => void;
  // A workspace on a branch (ADR 0028); rejects with the reason if git won't take the name.
  onBranch: (branch: string, baseBranch: string) => Promise<void>;
  onClose: () => void;
};

// A new workspace: on a branch, new or already on GitHub, or on an open PR.
export function NewWorkspace({ project, openPrNumbers, onSelect, onBranch, onClose }: Props) {
  const result = useQuery(core("listPullRequests", project.owner, project.name));
  const pulls = result.data?.status === "ok" ? result.data.pulls : null;
  const problem = result.data && result.data.status !== "ok" ? result.data : null;
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = (pulls ?? []).filter(
    (p) => !q || `#${p.number} ${p.title} ${p.author} ${p.headRef}`.toLowerCase().includes(q),
  );

  return (
    <Screen
      title={`New workspace in ${project.owner}/${project.name}`}
      onClose={onClose}
      className="max-w-2xl"
    >
      <NewBranch project={project} onBranch={onBranch} />

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search open pull requests"
        className="mb-3"
      />

      {problem && <ProblemCard problem={problem} onRetry={() => result.refetch()} />}

      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {shown.map((p) => (
          <PullRequestRow
            key={p.number}
            pull={p}
            open={openPrNumbers.includes(p.number)}
            onClick={() => onSelect(p)}
          />
        ))}
        {!problem && (
          <div className={cn("py-3 text-center", muted)}>
            {!pulls ? "Loading…" : pulls.length === 0 ? "No open pull requests" : null}
          </div>
        )}
      </div>
    </Screen>
  );
}

// A branch to work on and the branch it starts from, the default one unless another is picked. A name of a branch on
// GitHub is offered as it's typed; picking one works on it as it is there.
function NewBranch({ project, onBranch }: Pick<Props, "project" | "onBranch">) {
  const listed = useQuery(core("listBranches", project.id)).data;
  const branches = listed?.status === "ok" ? listed.branches : [];
  const [branch, setBranch] = useState("");
  const [picked, setPicked] = useState<string>();
  const base = picked ?? (listed?.status === "ok" ? listed.defaultBranch : undefined);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!base) return;
    try {
      await onBranch(branch.trim(), base);
    } catch (err) {
      // An IPC rejection carries the core's message after Electron's own prefix.
      setError(
        (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
      );
    }
  };
  return (
    <form onSubmit={submit} className="mb-5">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          list="branches"
          value={branch}
          onChange={(e) => {
            setBranch(e.target.value);
            setError(null);
          }}
          placeholder="New branch, or one on GitHub"
          className="min-w-0 flex-1"
        />
        <datalist id="branches">
          {branches.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <Button
          type="button"
          title="The branch it starts from, and its PR goes into"
          disabled={!base}
          className="flex items-center gap-1"
          onClick={async () => {
            const i = await window.coxswain.showPickMenu(branches, branches.indexOf(base!));
            setPicked(branches[i]);
          }}
        >
          <span className={muted}>from</span> {base ?? "…"} <ChevronDownIcon />
        </Button>
        <Button variant="primary" type="submit" disabled={!branch.trim() || !base}>
          Start
        </Button>
      </div>
      {error && <ErrorText className="mt-1.5">{error}</ErrorText>}
      {listed && listed.status !== "ok" && (
        <ErrorText className="mt-1.5">
          <ProblemMessage problem={listed} />
        </ErrorText>
      )}
    </form>
  );
}

// An open PR to start a workspace on; open: it already has one.
function PullRequestRow({
  pull: p,
  open,
  onClick,
}: {
  pull: PullRequest;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <ListRow onClick={onClick}>
      <div className="flex items-center gap-2">
        <span className={muted}>#{p.number}</span>
        <span className="truncate font-medium">{p.title}</span>
        {p.draft && <span className={cn("text-xs", muted)}>Draft</span>}
        {open && <span className={cn("text-xs", muted)}>Open</span>}
        <span className={cn("ml-auto shrink-0 text-xs", muted)}>
          {new Date(p.updatedAt).toLocaleDateString()}
        </span>
      </div>
      <div className={cn("truncate", muted)}>
        {p.author} · {p.headRef}
      </div>
    </ListRow>
  );
}
