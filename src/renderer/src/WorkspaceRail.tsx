import { useQuery } from "@tanstack/react-query";
import type { PullRequestTitle } from "../../core/github";
import type { Project } from "../../core/projects";
import type { Workspace } from "../../core/workspaces";
import {
  ChevronDownIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
} from "./components/icons";
import { cn, divider, muted, selectable, titleBar } from "./components/styles";
import { workspaceLabel } from "./format";
import { core } from "./queries";

type Props = {
  project: Project;
  cloning: boolean;
  workspaces: Workspace[];
  current: Workspace | undefined;
  onProjects: () => void;
  onSelect: (workspace: Workspace) => void;
  onRemove: (workspace: Workspace) => void;
  onNew: () => void;
};

// L1, the sidebar: the current project, then its workspaces by title, then New Workspace. The titles and whether each
// PR is still open come from GitHub; until they do, or offline, a PR workspace shows its number.
export function WorkspaceRail({
  project,
  cloning,
  workspaces,
  current,
  onProjects,
  onSelect,
  onRemove,
  onNew,
}: Props) {
  const numbers = workspaces.flatMap((w) => (w.prNumber !== null ? [w.prNumber] : []));
  const titles = useQuery({
    ...core("listPullRequestTitles", project.owner, project.name, numbers),
    enabled: numbers.length > 0,
  }).data;
  const pulls = new Map(titles?.status === "ok" ? titles.pulls.map((p) => [p.number, p]) : []);
  return (
    <div className={cn("flex w-58 shrink-0 flex-col border-r", divider)}>
      {/* The bar drags the window and holds the macOS window buttons. */}
      <div className={cn(titleBar, "border-b", divider)} />
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
        <div className={cn("px-2 pt-3 pb-1 text-[10.5px] font-semibold tracking-wide", muted)}>
          WORKSPACES
        </div>
        {workspaces.map((w) => (
          <WorkspaceRow
            key={w.id}
            workspace={w}
            pull={w.prNumber !== null ? pulls.get(w.prNumber) : undefined}
            selected={w.id === current?.id}
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
  onClick,
  onContextMenu,
}: {
  workspace: Workspace;
  pull: PullRequestTitle | undefined;
  selected: boolean;
  onClick: () => void;
  onContextMenu: () => void;
}) {
  const title = pull?.title ?? (w.prNumber !== null ? workspaceLabel(w) : w.branch!);
  const meta = [w.prNumber !== null && `#${w.prNumber}`, w.branch].filter(Boolean).join(" · ");
  const [icon, color, state] =
    w.prNumber === null
      ? [<GitBranchIcon />, muted, "Branch"]
      : pull?.state === "merged"
        ? [<GitMergeIcon />, "text-purple-600 dark:text-purple-400", "Merged"]
        : pull?.state === "closed"
          ? [<GitPullRequestIcon />, "text-red-600 dark:text-red-400", "Closed"]
          : pull?.draft
            ? [<GitPullRequestIcon />, muted, "Draft"]
            : [<GitPullRequestIcon />, "text-green-600 dark:text-green-500", "Open"];
  return (
    <button
      title={[title, meta, state].join("\n")}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5 text-left",
        selectable(selected),
      )}
    >
      <span className={cn("mt-px flex shrink-0", color)}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate", !selected && "text-neutral-700 dark:text-neutral-300")}>
          {title}
        </span>
        {meta !== title && (
          <span className={cn("truncate font-mono text-[10.5px]", muted)}>{meta}</span>
        )}
      </span>
    </button>
  );
}
