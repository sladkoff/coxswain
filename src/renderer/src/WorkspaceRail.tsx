import { useQuery } from "@tanstack/react-query";
import { match } from "ts-pattern";
import { type ReactNode, useEffect } from "react";
import type { AgentStatus } from "../../core/session-state";
import type { PullRequestTitle } from "../../core/github";
import type { Project } from "../../core/projects";
import type { Workspace } from "../../core/workspaces";
import { Button } from "./components/button";
import {
  ChevronDownIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  PanelLeftIcon,
} from "./components/icons";
import { cn, divider, muted, noDrag, selectable, titleBar } from "./components/styles";
import { workspaceLabel } from "./format";
import { core, queryClient } from "./queries";

type Props = {
  project: Project;
  cloning: boolean;
  workspaces: Workspace[];
  current: Workspace | undefined;
  onProjects: () => void;
  onSelect: (workspace: Workspace) => void;
  onRemove: (workspace: Workspace) => void;
  onNew: () => void;
  onHide: () => void;
};

// L1, the sidebar: the current project, then its workspaces by title, then New Workspace. The titles and whether each
// PR is still open come from GitHub; until they do, or offline, a PR workspace shows its number. A dot tells what its
// agent is up to; opening a workspace, and leaving it, clears its "done".
export function WorkspaceRail({
  project,
  cloning,
  workspaces,
  current,
  onProjects,
  onSelect,
  onRemove,
  onNew,
  onHide,
}: Props) {
  const numbers = workspaces.flatMap((w) => (w.prNumber !== null ? [w.prNumber] : []));
  const titles = useQuery({
    ...core("listPullRequestTitles", project.owner, project.name, numbers),
    enabled: numbers.length > 0,
  }).data;
  const statuses = useQuery(core("listAgentStatuses")).data ?? {};
  const shown = current?.id;
  useEffect(() => {
    if (shown === undefined) return;
    const seen = () =>
      window.coxswain
        .seeAgentSessions(shown)
        .then(() =>
          queryClient.invalidateQueries({ queryKey: core("listAgentStatuses").queryKey }),
        );
    void seen();
    return () => void seen();
  }, [shown]);
  const pulls = new Map(titles?.status === "ok" ? titles.pulls.map((p) => [p.number, p]) : []);
  return (
    <div className={cn("flex w-58 shrink-0 flex-col border-r", divider)}>
      {/* The bar drags the window and holds the macOS window buttons. */}
      <div className={cn(titleBar, "justify-end border-b px-2", divider)}>
        <Button
          variant="ghost"
          title="Hide the sidebar"
          aria-label="Hide the sidebar"
          className={cn("p-1 text-neutral-500", noDrag)}
          onClick={onHide}
        >
          <PanelLeftIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5 text-xs">
        {/* The current project. Opens a native menu to switch or add projects. */}
        <button
          title={`${project.owner}/${project.name}${cloning ? " (cloning…)" : ""}: switch or add project`}
          onClick={onProjects}
          className={cn(
            "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left",
            selectable(false),
          )}
        >
          <span
            className={cn(
              cloning && "animate-pulse",
              "flex size-6 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-[11px] font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900",
            )}
          >
            {project.name[0].toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{project.name}</span>
            <span className={cn("truncate text-[11px]", muted)}>{project.owner}</span>
          </span>
          <span className={muted}>
            <ChevronDownIcon />
          </span>
        </button>
        {/* New Workspace here too, so it's in reach however long the list gets. */}
        <div
          className={cn(
            "flex items-center pt-2 pr-0.5 pl-2 text-[10.5px] font-semibold tracking-wide",
            muted,
          )}
        >
          <span className="flex-1">WORKSPACES</span>
          <Button
            variant="ghost"
            title="New workspace"
            aria-label="New workspace"
            className="flex size-5 items-center justify-center text-sm leading-none font-normal"
            onClick={onNew}
          >
            +
          </Button>
        </div>
        {workspaces.map((w) => (
          <WorkspaceRow
            key={w.id}
            workspace={w}
            pull={w.prNumber !== null ? pulls.get(w.prNumber) : undefined}
            selected={w.id === current?.id}
            status={statuses[w.id] ?? "idle"}
            onClick={() => onSelect(w)}
            onContextMenu={async () => {
              if ((await window.coxswain.showWorkspaceMenu()) === "remove") onRemove(w);
            }}
          />
        ))}
        <button
          onClick={onNew}
          className={cn(
            "mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left",
            muted,
            selectable(false),
          )}
        >
          <span className="w-3.5 text-center text-sm leading-none">+</span>
          New Workspace
        </button>
      </div>
    </div>
  );
}

// A workspace: its PR's title (the branch until it has a PR), then its number and branch; an icon for an open, draft,
// merged or closed PR, or a branch. Right-click offers to remove it.
function WorkspaceRow({
  workspace: w,
  pull,
  selected,
  status,
  onClick,
  onContextMenu,
}: {
  workspace: Workspace;
  pull: PullRequestTitle | undefined;
  selected: boolean;
  status: AgentStatus;
  onClick: () => void;
  onContextMenu: () => void;
}) {
  const title = pull?.title ?? (w.prNumber !== null ? workspaceLabel(w) : w.branch!);
  const meta = [w.prNumber !== null && `#${w.prNumber}`, w.branch].filter(Boolean).join(" · ");
  const [icon, color, state] = match({
    prNumber: w.prNumber,
    state: pull?.state,
    draft: pull?.draft,
  })
    .returnType<[ReactNode, string, string]>()
    .with({ prNumber: null }, () => [<GitBranchIcon />, muted, "Branch"])
    .with({ state: "merged" }, () => [
      <GitMergeIcon />,
      "text-purple-600 dark:text-purple-400",
      "Merged",
    ])
    .with({ state: "closed" }, () => [
      <GitPullRequestIcon />,
      "text-red-600 dark:text-red-400",
      "Closed",
    ])
    .with({ draft: true }, () => [<GitPullRequestIcon />, muted, "Draft"])
    .otherwise(() => [<GitPullRequestIcon />, "text-green-600 dark:text-green-500", "Open"]);
  return (
    <button
      title={[title, meta, state, status !== "idle" && statusLabels[status]]
        .filter(Boolean)
        .join("\n")}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5 text-left",
        selectable(selected),
      )}
    >
      {/* Always two lines: the git icon by the title, the agent's dot under it. */}
      <span className="flex shrink-0 flex-col items-center gap-0.5">
        <span className={cn("flex h-4 items-center", color)}>{icon}</span>
        <span className="flex h-4 items-center">
          {status !== "idle" && !(selected && status === "done") && (
            <span
              aria-label={statusLabels[status]}
              className={cn("size-2 rounded-full", statusDots[status])}
            />
          )}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate leading-4",
            !selected && "text-neutral-700 dark:text-neutral-300",
          )}
        >
          {title}
        </span>
        <span className={cn("truncate font-mono text-[10.5px] leading-4", muted)}>
          {meta !== title ? meta : "\u00a0"}
        </span>
      </span>
    </button>
  );
}

const statusLabels: Record<AgentStatus, string> = {
  waiting: "Agent needs your approval",
  working: "Agent working",
  done: "Agent done",
  idle: "Agent idle",
};
const statusDots: Record<AgentStatus, string> = {
  waiting: "bg-amber-500",
  working: "animate-pulse bg-blue-500",
  done: "bg-green-600 dark:bg-green-500",
  idle: "",
};
