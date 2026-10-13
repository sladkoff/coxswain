import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ForgeKind, ForgeProblem, Repo } from "../../core/forge";
import type { Project } from "../../core/projects";
import { Button } from "./components/button";
import { LockIcon } from "./components/icons";
import { Dialog, ListHeading, ListRow, ProblemCard, SearchField } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ErrorText } from "./components/text";
import { ago } from "./format";
import { core } from "./queries";

type Props = {
  projects: Project[];
  current: Project | undefined;
  // A native dialog to open at once (the command palette's Add Local Repository… and New Project…).
  start: "add-local" | "create" | null;
  onSelect: (projectId: number) => void;
  onAdded: () => void; // a project was added and made current
  onClose: () => void;
};

// Open a project: Add Local Repository… and New Project… (ADR 0040), the user's projects, then every repository they
// can see on each forge's host (ADR 0041), most recently pushed first.
export function Projects({ projects, current, start, onSelect, onAdded, onClose }: Props) {
  const [query, setQuery] = useState("");
  const hosts = useQuery(core("listForgeHosts")).data ?? [];

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

  const q = query.trim().toLowerCase();
  const shownProjects = projects.filter((p) =>
    `${p.name} ${p.repo ?? ""} ${p.path ?? ""}`.toLowerCase().includes(q),
  );

  return (
    <Dialog
      title="Open a project"
      subtitle="One of yours, a repository on this Mac, a new one, or any repository you can see on GitHub or GitLab"
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
        {hosts.map((h) => (
          <HostRepos
            key={h.host}
            {...h}
            query={q}
            onAdd={(path) => void add(window.coxswain.addForgeProject({ ...h, path }))}
          />
        ))}
      </div>
    </Dialog>
  );
}

// The repositories the user can see on one forge's host, page by page.
// ponytail: search filters the pages loaded so far; switch to the forge's search if people miss old repos.
function HostRepos(props: {
  forge: ForgeKind;
  host: string;
  query: string;
  onAdd: (path: string) => void;
}) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [page, setPage] = useState(0); // last page loaded
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<ForgeProblem | null>(null);
  const loadMore = async () => {
    setLoading(true);
    const result = await window.coxswain.listRepos(props.forge, props.host, page + 1);
    setLoading(false);
    if (result.status !== "ok") return setProblem(result);
    setProblem(null);
    // StrictMode loads the first page twice in development; a repository already listed isn't listed again.
    setRepos((r) => [...r, ...result.repos.filter((n) => !r.some((o) => o.id === n.id))]);
    setPage(page + 1);
    setHasMore(result.hasMore);
  };
  useEffect(() => void loadMore(), []);
  const q = props.query;
  const shown = q
    ? repos.filter(
        (r) => r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
      )
    : repos;
  return (
    <>
      <ListHeading>
        {props.forge === "github" ? "GITHUB" : props.host.toUpperCase()} REPOSITORIES
      </ListHeading>
      {problem && (
        <div className="px-2 pt-1">
          <ProblemCard problem={problem} onRetry={loadMore} />
        </div>
      )}
      {shown.map((r) => (
        <RepoRow key={r.id} repo={r} onClick={() => props.onAdd(r.fullName)} />
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
    </>
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
  const name = r.fullName.split("/").at(-1)!;
  const owner = r.fullName.slice(0, -name.length - 1);
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
