import { workspacePrColor, workspacePrSymbol } from "./workspace-pr-color";
import { useQuery } from "@tanstack/react-query";
import { match } from "ts-pattern";
import { Glass, GlassIsland, ui, type GlassNode } from "electron-glasskit/react";
import { workspaceChrome, workspaceStripLayout } from "./components/workspace-layout";
import { useNativeControls, useNativeOcclusion } from "./components/NativeToolbar";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentStatus } from "../../core/session-state";
import type { PullRequestDetails, PullRequestTitle } from "../../core/github";
import type { Project } from "../../core/projects";
import type { Workspace } from "../../core/workspaces";
import { Button, ToggleButton } from "./components/button";
import {
  CheckIcon,
  ExclamationSquareIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GlobeIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  PanelRightIcon,
  SlidersIcon,
  PanelLeftIcon,
  XIcon,
  GitHubIcon,
  githubMark,
} from "./components/icons";
import { cn, divider, muted, noDrag, titleBar } from "./components/styles";
import { gitHubOf, projectLabel, workspaceLabel } from "./format";
import { core } from "./queries";

type Props = {
  settingsOpen: boolean;
  settingsActive: boolean;
  onSelectSettings: () => void;
  onCloseSettings: () => void;
  project: Project;
  cloning: boolean;
  workspaces: Workspace[];
  current: Workspace | undefined;
  onProjects: () => void;
  onSelect: (workspace: Workspace) => void;
  onRemove: (workspace: Workspace) => void;
  onClose: (workspace: Workspace) => void;
  onNew: () => void;
  agentsOpen: boolean;
  onToggleAgents: () => void;
  onSettings: () => void;
  paneOpen: boolean;
  onTogglePane: () => void;
  onShowPr: () => void;
  prOpen: boolean;
  pullRequest: PullRequestDetails | null;
};

// L1: project switching and workspace tabs. Titles come from GitHub, with branch/number fallbacks offline.
// Agent status stays visible while chat is collapsed; selecting a workspace clears its done marker.
export function WorkspaceTabs({
  settingsOpen,
  settingsActive,
  onSelectSettings,
  onCloseSettings,
  project,
  cloning,
  workspaces,
  current,
  onProjects,
  onSelect,
  onRemove,
  onClose,
  onNew,
  agentsOpen,
  onToggleAgents,
  onSettings,
  paneOpen,
  onTogglePane,
  onShowPr,
  prOpen,
  pullRequest,
}: Props) {
  const tabs = useRef<HTMLDivElement>(null);
  const numbers = workspaces.flatMap((w) => (w.prNumber !== null ? [w.prNumber] : []));
  const repo = gitHubOf(project);
  // Keep titles while a changed list of PR numbers loads.
  const titles = useQuery({
    ...core("listPullRequestTitles", repo?.owner ?? "", repo?.name ?? "", numbers),
    enabled: !!repo && numbers.length > 0,
    placeholderData: (before, query) =>
      query?.queryKey[1] === repo?.owner && query?.queryKey[2] === repo?.name ? before : undefined,
  }).data;
  const statuses = useQuery(core("listAgentStatuses")).data ?? {};
  const openPreview = async () => {
    const deployments = pullRequest?.deployments ?? [];
    if (deployments.length === 1) {
      window.open(deployments[0].url);
      return;
    }
    if (!deployments.length) return;
    const picked = await window.coxswain.showPickMenu(
      deployments.map((d) => d.environment || d.url),
      -1,
    );
    if (picked !== null && deployments[picked]) window.open(deployments[picked].url);
  };
  const shown = current?.id;
  useEffect(() => {
    if (shown === undefined) return;
    // Clearing "done" changes the session's state, which the core sends, and so its status (queries.ts).
    const seen = () => window.coxswain.seeAgentSessions(shown);
    void seen();
    return () => void seen();
  }, [shown]);
  useEffect(() => {
    tabs.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [shown, settingsActive, settingsOpen]);
  const pulls = new Map(titles?.status === "ok" ? titles.pulls.map((p) => [p.number, p]) : []);
  return (
    <NativeWorkspaceBar
      settingsOpen={settingsOpen}
      settingsActive={settingsActive}
      onSelectSettings={onSelectSettings}
      onCloseSettings={onCloseSettings}
      project={project}
      cloning={cloning}
      workspaces={workspaces}
      current={current}
      onProjects={onProjects}
      onSelect={onSelect}
      onRemove={onRemove}
      onClose={onClose}
      onNew={onNew}
      agentsOpen={agentsOpen}
      onToggleAgents={onToggleAgents}
      onSettings={onSettings}
      paneOpen={paneOpen}
      onTogglePane={onTogglePane}
      onShowPr={onShowPr}
      prOpen={prOpen}
      pullRequest={pullRequest}
      pulls={pulls}
      statuses={statuses}
    >
      <div className={cn(titleBar, "workspace-bar gap-2 border-b pr-3 pl-24 text-xs", divider)}>
        <ToggleButton
          on={paneOpen}
          icon
          title="Show or hide the file sidebar (⌘B)"
          aria-label="Toggle file sidebar"
          className={cn("workspace-sidebar-toggle size-8 shrink-0 rounded-full", noDrag)}
          onClick={onTogglePane}
        >
          <PanelLeftIcon />
        </ToggleButton>
        <Button
          variant="ghost"
          title={`${projectLabel(project)}${cloning ? " (cloning…)" : ""}: switch or add project`}
          onClick={onProjects}
          className={cn(
            "workspace-project flex w-32 shrink-0 items-center gap-2 px-3 py-1",
            noDrag,
          )}
        >
          <span className={cn("truncate font-semibold", cloning && "animate-pulse")}>
            {project.name}
          </span>
          <ChevronDownIcon />
        </Button>
        <div
          ref={tabs}
          role="tablist"
          aria-label="Workspaces"
          className={cn("workspace-tabs flex min-w-0 flex-1 items-center overflow-x-auto", noDrag)}
          onKeyDown={(event) => {
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            ];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = match(event.key)
              .with("ArrowRight", () => (index + 1) % buttons.length)
              .with("ArrowLeft", () => (index - 1 + buttons.length) % buttons.length)
              .with("Home", () => 0)
              .with("End", () => buttons.length - 1)
              .otherwise(() => null);
            if (next === null || !buttons[next]) return;
            event.preventDefault();
            buttons[next].focus();
            buttons[next].click();
          }}
        >
          {workspaces.map((w) => (
            <WorkspaceTab
              key={w.id}
              workspace={w}
              pull={w.prNumber !== null ? pulls.get(w.prNumber) : undefined}
              selected={!settingsActive && w.id === current?.id}
              status={statuses[w.id] ?? "idle"}
              onClick={() => onSelect(w)}
              onClose={() => onClose(w)}
              onContextMenu={async () => {
                if ((await window.coxswain.showWorkspaceMenu()) === "remove") onRemove(w);
              }}
            />
          ))}
          {settingsOpen && (
            <div className="group flex shrink-0 items-center">
              <ToggleButton
                on={settingsActive}
                role="tab"
                aria-selected={settingsActive}
                onClick={onSelectSettings}
                className="px-3"
              >
                <SlidersIcon />
                <span>Settings</span>
              </ToggleButton>
              <Button variant="ghost" aria-label="Close Settings tab" onClick={onCloseSettings}>
                <XIcon />
              </Button>
            </div>
          )}
        </div>
        <div className={cn("workspace-actions flex shrink-0 items-center p-0.5", noDrag)}>
          <Button
            variant="ghost"
            title="New workspace"
            aria-label="New workspace"
            className={cn("shrink-0 px-2 py-1 text-base leading-none", noDrag)}
            onClick={onNew}
          >
            +
          </Button>
        </div>
        <div className={cn("workspace-actions flex shrink-0 items-center gap-1 p-1", noDrag)}>
          <ToggleButton
            on={prOpen}
            title="Open pull request overview"
            aria-label="Open pull request overview"
            className="min-w-7 text-xs font-semibold"
            disabled={!pullRequest}
            onClick={onShowPr}
          >
            PR
          </ToggleButton>
          <Button
            variant="ghost"
            title="Open pull request on GitHub"
            aria-label="Open on GitHub"
            className="size-7 p-1"
            disabled={!pullRequest}
            onClick={() => pullRequest && window.open(pullRequest.url)}
          >
            <GitHubIcon />
          </Button>
          <Button
            variant="ghost"
            title="Open preview environment"
            aria-label="Open preview environment"
            className="size-7 p-1"
            disabled={!pullRequest?.deployments.length}
            onClick={() => void openPreview()}
          >
            <GlobeIcon />
          </Button>
          <Button
            variant="ghost"
            title="Settings"
            aria-label="Settings"
            className={cn("shrink-0 p-1", noDrag)}
            onClick={onSettings}
          >
            <SlidersIcon />
          </Button>{" "}
          <ToggleButton
            on={agentsOpen}
            icon
            title={agentsOpen ? "Hide the right sidebar" : "Show the right sidebar"}
            aria-label={agentsOpen ? "Hide the right sidebar" : "Show the right sidebar"}
            disabled={workspaces.length === 0}
            className={cn("shrink-0", noDrag)}
            onClick={onToggleAgents}
          >
            <PanelRightIcon />
          </ToggleButton>
        </div>
      </div>
    </NativeWorkspaceBar>
  );
}

// SwiftUI owns macOS selection, focus and pressed feedback. HTML is only the platform/accessibility fallback.
function NativeWorkspaceBar(
  props: Props & {
    pulls: Map<number, PullRequestTitle>;
    statuses: Record<number, AgentStatus>;
    children: ReactNode;
  },
) {
  const appearance = useQuery(core("getAppearance")).data;
  const systemDark = useSyncExternalStore(
    (listener) => {
      const media = matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dark = appearance === "dark" || ((!appearance || appearance === "system") && systemDark);
  const native = useNativeControls();
  const occluded = useNativeOcclusion();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  useLayoutEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.borderBoxSize[0]?.inlineSize ?? entry.target.getBoundingClientRect().width),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [native]);
  if (!native) return props.children;
  const label = (w: Workspace) => {
    const pull = w.prNumber !== null ? props.pulls.get(w.prNumber) : undefined;
    const title = pull?.title ?? workspaceLabel(w);
    const status = props.statuses[w.id] ?? "idle";
    return `${title}${pull ? ` #${w.prNumber}${pull.author ? ` · @${pull.author}` : ""}` : ""}${status !== "idle" ? ` · ${statusLabels[status]}` : ""}`;
  };
  const current = props.current;
  const layout = workspaceStripLayout(
    width,
    props.workspaces.length + Number(props.settingsOpen),
    props.settingsActive
      ? props.workspaces.length
      : props.workspaces.findIndex((w) => w.id === current?.id),
  );
  const settingsHover = {
    hoverAction: { id: "close-settings", symbol: "xmark", help: "Close Settings tab" },
  };
  const tabNodes = layout.indices.flatMap((index, i): GlassNode[] => {
    const w = props.workspaces[index];
    if (!w)
      return [
        ui.button({
          id: "select-settings",
          ...settingsHover,
          label: ui.hstack({ spacing: 8 }, [
            ui.symbol("slider.horizontal.3", { size: 12 }),
            ui.text("Settings", { lineLimit: 1 }),
          ]),
          frame: { width: layout.tabWidth, height: 28 },
          padding: { horizontal: 10 },
          font: { size: 12, weight: props.settingsActive ? "medium" : "regular" },
          glass: props.settingsActive ? { shape: "capsule", interactive: true } : undefined,
          accessibilityLabel: props.settingsActive ? "Current tab: Settings" : "Settings tab",
          disabled: occluded,
        }),
      ];
    const selected = !props.settingsActive && w.id === current?.id;
    const pull = w.prNumber !== null ? props.pulls.get(w.prNumber) : undefined;
    const status = props.statuses[w.id] ?? "idle";
    const icon = workspacePrSymbol(pull);
    const statusColor = match(status)
      .with("waiting", () => "#f59e0b")
      .with("working", () => "#3b82f6")
      .with("done", () => "#22c55e")
      .with("idle", () => "#00000000")
      .exhaustive();
    // Extra native button capability supplied by the pinned toolkit patch.
    const hoverProps = {
      hoverAction: { id: `close:${w.id}`, symbol: "xmark", help: "Close workspace tab" },
    };
    const nodes: GlassNode[] = [
      ui.button({
        id: `select-${w.id}`,
        ...hoverProps,
        disabled: occluded,
        label: ui.hstack({ spacing: 8 }, [
          ui.symbol(icon, {
            size: 12,
            foreground: w.prNumber !== null ? workspacePrColor(pull) : undefined,
          }),
          ui.text(pull?.title ?? workspaceLabel(w), {
            lineLimit: 1,
            frame: { minWidth: 0, maxWidth: "infinity", alignment: "leading" },
          }),
          ...(w.prNumber !== null
            ? [
                ui.text(`#${w.prNumber}${pull?.author ? ` · @${pull.author}` : ""}`, {
                  lineLimit: 1,
                  font: { size: 10 },
                }),
              ]
            : []),
          ...(status !== "idle" && !(selected && status === "done")
            ? [ui.shape("circle", { fill: statusColor, frame: { width: 6, height: 6 } })]
            : []),
        ]),
        frame: { width: layout.tabWidth, height: 28 },
        padding: { horizontal: 10 },
        font: { size: 12, weight: selected ? "medium" : "regular" },
        glass: selected ? { shape: "capsule", interactive: true } : undefined,
        accessibilityLabel: `${selected ? "Current workspace: " : ""}${label(w)}`,
        help: label(w),
      }),
    ];
    const next = props.workspaces[layout.indices[i + 1]];
    if (next)
      nodes.push(
        ui.shape("rect", {
          fill: !selected && next.id !== current?.id ? "#80808055" : "#00000000",
          frame: { width: 0.5, height: 14 },
        }),
      );
    return nodes;
  });
  const iconButton = (id: string, symbol: string, title: string, selected = false) =>
    ui.button({
      id,
      label: ui.symbol(symbol, { size: 15 }),
      frame: { width: 28, height: 28 },
      accessibilityLabel: title,
      help: title,
      background: selected ? { color: "#80808033", shape: "capsule" } : undefined,
      disabled: occluded || (id === "toggle-agents" && !props.workspaces.length),
    });
  const projectNode = ui.button({
    id: "projects",
    label: ui.hstack({ spacing: 8 }, [
      ui.symbol("folder", { size: 14 }),
      ui.text(props.project.name, {
        lineLimit: 1,
        frame: { minWidth: 0, maxWidth: "infinity", alignment: "leading" },
      }),
      ui.symbol("chevron.down", { size: 10 }),
    ]),
    frame: { width: workspaceChrome.project, height: 32 },
    padding: { horizontal: 12 },
    glass: { shape: "capsule", interactive: true },
    accessibilityLabel: "Projects",
    help: `${projectLabel(props.project)}${props.cloning ? " (cloning…)" : ""}: switch or add project`,
  });
  const tabsNode = ui.hstack(
    {
      spacing: 0,
      padding: 2,
      frame: { width: layout.width, height: workspaceChrome.stripHeight },
      background: { color: "#80808022", shape: "capsule" },
    },
    tabNodes,
  );
  const actionsNode = ui.hstack(
    {
      spacing: 4,
      padding: 4,
      frame: { width: workspaceChrome.actions, height: 32 },
      glass: { shape: "capsule" },
    },
    [
      {
        ...iconButton("pr-overview", "doc.text", "Open pull request overview", props.prOpen),
        label: ui.text("PR", { font: { size: 12, weight: "semibold" } }),
        disabled: occluded || !props.pullRequest,
      },
      {
        ...iconButton("open-github", "arrow.up.right.square", "Open on GitHub"),
        label: ui.shape(
          { type: "path", d: githubMark, viewBox: [16, 16] },
          { frame: { width: 14, height: 14 }, fill: dark ? "#f5f5f5" : "#262626" },
        ),
        disabled: occluded || !props.pullRequest,
      },
      ...(props.pullRequest && props.pullRequest.deployments.length > 1
        ? [
            ui.menu({
              id: "preview-menu",
              label: ui.symbol("globe", { size: 15 }),
              frame: { width: 28, height: 28 },
              accessibilityLabel: "Open preview environment",
              help: "Open preview environment",
              disabled: occluded,
              items: props.pullRequest.deployments.map((d, i) => ({
                id: `preview:${i}`,
                title: d.environment || d.url,
              })),
            }),
          ]
        : [
            {
              ...iconButton("open-preview", "globe", "Open preview environment"),
              disabled: occluded || !props.pullRequest?.deployments.length,
            },
          ]),
      iconButton("settings", "slider.horizontal.3", "Settings"),
      iconButton(
        "toggle-agents",
        "sidebar.right",
        props.agentsOpen ? "Hide the right sidebar" : "Show the right sidebar",
        props.agentsOpen,
      ),
    ],
  );
  const press = ({ node }: { node: string }) => {
    match(node)
      .with("select-settings", props.onSelectSettings)
      .with("close-settings", props.onCloseSettings)
      .with("open-github", () => {
        if (props.pullRequest) window.open(props.pullRequest.url);
      })
      .with("open-preview", () => {
        const deployment = props.pullRequest?.deployments[0];
        if (deployment) window.open(deployment.url);
      })
      .when(
        (id) => id.startsWith("preview:"),
        (id) => {
          const deployment = props.pullRequest?.deployments[Number(id.slice(8))];
          if (deployment) window.open(deployment.url);
        },
      )
      .when(
        (id) => id.startsWith("close:"),
        () => {
          const w = props.workspaces.find((w) => `close:${w.id}` === node);
          if (w) props.onClose(w);
        },
      )
      .with("toggle-sidebar", () => props.onTogglePane())
      .with("projects", () => props.onProjects())
      .with("new-workspace", () => props.onNew())
      .with("toggle-agents", () => props.onToggleAgents())
      .with("settings", () => props.onSettings())
      .with("pr-overview", () => props.onShowPr())
      .with("remove-workspace", () => current && props.onRemove(current))
      .otherwise(() => {
        const w = props.workspaces.find((w) => `select-${w.id}` === node);
        if (w && (w.id !== current?.id || props.settingsActive)) props.onSelect(w);
      });
  };
  return (
    <div
      ref={host}
      className={cn(titleBar, "workspace-bar workspace-bar-native w-full gap-2 pr-3 pl-24")}
    >
      <Glass
        className="pointer-events-none absolute inset-0"
        cornerRadius={0}
        passthrough
        zIndex={0}
      />
      <GlassIsland
        className={cn("relative h-8 shrink-0", noDrag)}
        style={{ width: workspaceChrome.sidebar }}
        zIndex={1}
        content={ui.button({
          id: "toggle-sidebar",
          disabled: occluded,
          label: ui.symbol("sidebar.left", { size: 16 }),
          frame: { width: 32, height: 32 },
          glass: { shape: "circle", interactive: true },
          background: props.paneOpen ? { color: "#80808033", shape: "circle" } : undefined,
          accessibilityLabel: "Toggle file sidebar",
          help: "Show or hide the file sidebar (⌘B)",
        })}
        onPress={press}
      />
      <GlassIsland
        className={cn("relative h-8 shrink-0", noDrag)}
        style={{ width: workspaceChrome.project }}
        zIndex={1}
        content={{ ...projectNode, font: { size: 12 }, disabled: occluded }}
        onPress={press}
      />
      <GlassIsland
        className={cn("relative h-8 shrink-0", noDrag)}
        style={{ width: layout.width }}
        zIndex={1}
        content={{ ...tabsNode, disabled: occluded }}
        onPress={press}
      />
      <GlassIsland
        className={cn("relative h-8 shrink-0", noDrag)}
        style={{ width: workspaceChrome.newWorkspace }}
        zIndex={1}
        content={{
          ...iconButton("new-workspace", "plus", "New workspace"),
          frame: { width: workspaceChrome.newWorkspace, height: 32 },
          glass: { shape: "circle", interactive: true },
        }}
        onPress={press}
      />
      <GlassIsland
        className={cn("relative h-8 shrink-0", noDrag)}
        style={{ width: workspaceChrome.actions }}
        zIndex={1}
        content={{ ...actionsNode, disabled: occluded }}
        onPress={press}
      />
    </div>
  );
}

// A workspace: its PR's title (the branch until it has a PR), then its number and branch; an icon for an open, draft,
// merged or closed PR, or a branch. Right-click offers to remove it.
function WorkspaceTab({
  workspace: w,
  pull,
  selected,
  status,
  onClick,
  onClose,
  onContextMenu,
}: {
  workspace: Workspace;
  pull: PullRequestTitle | undefined;
  selected: boolean;
  status: AgentStatus;
  onClick: () => void;
  onClose: () => void;
  onContextMenu: () => void;
}) {
  const title = pull?.title ?? (w.prNumber !== null ? workspaceLabel(w) : w.branch!);
  const meta = [
    w.prNumber !== null && `#${w.prNumber}`,
    pull?.author && `Created by @${pull.author}`,
    w.branch,
  ]
    .filter(Boolean)
    .join(" · ");
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
    <div className="workspace-tab-wrap relative flex h-7 min-w-0">
      <Button
        variant="ghost"
        role="tab"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        title={[title, meta, state, status !== "idle" && statusLabels[status]]
          .filter(Boolean)
          .join("\n")}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={cn(
          "workspace-tab relative flex items-center gap-2 px-3 text-left",
          !selected && muted,
        )}
      >
        <span
          className={cn("workspace-tab-icon shrink-0", w.prNumber === null && color)}
          style={w.prNumber !== null ? { color: workspacePrColor(pull) } : undefined}
        >
          {w.prNumber === null
            ? icon
            : match(workspacePrSymbol(pull))
                .with("checkmark.square.fill", () => <CheckIcon boxed filled />)
                .with("exclamationmark.square.fill", () => <ExclamationSquareIcon />)
                .otherwise(() => icon)}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {w.prNumber !== null && pull && (
          <span
            className={cn("max-w-32 truncate text-[10px]", muted)}
            title={pull.author ? `Created by @${pull.author}` : undefined}
          >
            #{w.prNumber}
            {pull.author ? ` · @${pull.author}` : ""}
          </span>
        )}
        {status !== "idle" && !(selected && status === "done") && (
          <span
            aria-label={statusLabels[status]}
            className={cn("size-2 shrink-0 rounded-full", statusDots[status])}
          />
        )}
      </Button>
      <Button
        variant="ghost"
        className="workspace-tab-close p-0"
        aria-label="Close workspace tab"
        title="Close workspace tab"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <XIcon />
      </Button>
    </div>
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
