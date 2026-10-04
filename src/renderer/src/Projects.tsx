import { useEffect, useState } from "react";
import type { GitHubProblem, Repo } from "../../core/github";
import type { Project } from "../../core/projects";
import { Button } from "./components/button";
import { LockIcon } from "./components/icons";
import { Dialog, ListHeading, ListRow, ProblemCard, SearchField } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ErrorText } from "./components/text";
import { ago } from "./format";

type Props = {
  projects: Project[];
  current: Project | undefined;
  // A native dialog to open at once (the command palette's Add Local Repository… and New Project…).
  start: "add-local" | "create" | null;
  onSelect: (projectId: number) => void;
  onAdded: () => void; // a project was added and made current
  onClose: () => void;
};

// Open a project: Add Local Repository… and New Project… (ADR 0040), the user's projects, then every GitHub repository
// they can see, most recently pushed first.
export function Projects({ projects, current, start, onSelect, onAdded, onClose }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [page, setPage] = useState(0); // last page loaded
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<GitHubProblem | null>(null);
  const [query, setQuery] = useState("");

  const loadMore = async () => {
    setLoading(true);
    const result = await window.coxswain.listRepos(page + 1);
    setLoading(false);
    if (result.status !== "ok") return setProblem(result);
    setProblem(null);
    setRepos((r) => [...r, ...result.repos]);
    setPage(page + 1);
    setHasMore(result.hasMore);
  };
  useEffect(() => void loadMore(), []);

  // What git won't take (not a repository, no commits, a folder that isn't empty) shows here.
  const [error, setError] = useState<string | null>(null);
  const add = async (added: Promise<Project | null>) => {
    setError(null);
    try {
      if (await added) onAdded();
    } catch (err) {
      // An IPC rejection carries the core's message after Electron's own prefix.
      setError(
        (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
      );
    }
  };
  const addLocal = () => add(window.coxswain.addLocalProject());
  const create = () => add(window.coxswain.createProject());
  useEffect(() => {
    if (start) void (start === "add-local" ? addLocal() : create());
  }, []);

  // ponytail: search filters the pages loaded so far; switch to GitHub's search API if people miss old repos.
  const q = query.trim().toLowerCase();
  const shownProjects = projects.filter((p) =>
    `${p.name} ${p.github ?? ""} ${p.path ?? ""}`.toLowerCase().includes(q),
  );
  const shownRepos = q
    ? repos.filter(
        (r) => r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
      )
    : repos;

  return (
    <Dialog
      title="Open a project"
      subtitle="One of yours, a repository on this Mac, a new one, or any GitHub repository you can see"
      onClose={onClose}
    >
      <SearchField
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search projects and repositories"
      />
      <div className={cn("flex shrink-0 items-center gap-2 border-b px-4 py-2.5", divider)}>
        <Button className="text-xs" onClick={() => void addLocal()}>
          Add Local Repository…
        </Button>
        <Button className="text-xs" onClick={() => void create()}>
          New Project…
        </Button>
      </div>
      {error && <ErrorText className="shrink-0 px-4 pt-2">{error}</ErrorText>}
      {problem && (
        <div className="px-4 pt-3">
          <ProblemCard problem={problem} onRetry={loadMore} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shownProjects.length > 0 && (
          <>
            <ListHeading>YOUR PROJECTS</ListHeading>
            {shownProjects.map((p) => (
              <ListRow
                key={p.id}
                className="flex items-center gap-2.5"
                onClick={() => onSelect(p.id)}
              >
                <Initial name={p.name} strong />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className={cn("truncate text-xs", muted)}>{p.where}</span>
                </span>
                {p.id === current?.id && <Badge>Current</Badge>}
              </ListRow>
            ))}
          </>
        )}
        <ListHeading>GITHUB REPOSITORIES</ListHeading>
        {shownRepos.map((r) => (
          <RepoRow
            key={r.id}
            repo={r}
            onClick={() => void add(window.coxswain.addGitHubProject(r.fullName))}
          />
        ))}
        {!problem && (
          <div className={cn("py-3 text-center text-xs", muted)}>
            {loading ? (
              "Loading…"
            ) : hasMore ? (
              <Button className="text-xs" onClick={loadMore}>
                Load more
              </Button>
            ) : (
              `${repos.length} repositories`
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// A project's or repository's first letter in a rounded square, like the sidebar's.
function Initial({ name, strong }: { name: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
        strong
          ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
      )}
    >
      {name[0].toUpperCase()}
    </span>
  );
}

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

function RepoRow({ repo: r, onClick }: { repo: Repo; onClick: () => void }) {
  const [owner, name] = r.fullName.split("/");
  return (
    <ListRow className="flex items-center gap-2.5" onClick={onClick}>
      <Initial name={name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate">
            <span className={muted}>{owner}/</span>
            <span className="font-medium">{name}</span>
          </span>
          {r.private && (
            <span title="Private" className={cn("shrink-0", muted)}>
              <LockIcon />
            </span>
          )}
        </span>
        {r.description && <span className={cn("truncate text-xs", muted)}>{r.description}</span>}
      </span>
      {r.pushedAt && (
        <span
          title={`Pushed ${new Date(r.pushedAt).toLocaleString()}`}
          className={cn("shrink-0 text-xs", muted)}
        >
          {ago(r.pushedAt)}
        </span>
      )}
    </ListRow>
  );
}
