import { preparePresortedFileTreeInput, type FileTreePreparedInput } from "@pierre/trees";
import { ChangesNavigator } from "./ChangesNavigator";
import type { GuideOptions } from "../../preload";
import type { GuideAuthor } from "../../shared/guide-authors";
import type { Turn } from "./Viewer";
import { prepareTree } from "./components/prepare-tree";
import sidebarTreeCSS from "./components/sidebar-tree.css?inline";
import { createPortal } from "react-dom";
import { SidebarFileLabel } from "./components/SidebarFileLabel";
import sidebarRowCSS from "./components/sidebar-row.css?inline";
import { useFileTreeTheme, softenFileStatus } from "./components/file-tree-theme";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangedFile } from "../../core/git";
import type { Workspace } from "../../core/workspaces";
import type { ReviewEntry } from "../../core/review";
import { cn, muted } from "./components/styles";
import { ProblemMessage } from "./components/text";
import { countItems, type ItemCount, itemsTitle } from "./format";
import { core } from "./queries";
import type { PullRequestData } from "./usePullRequest";
import bubbleUrl from "./assets/message-square.svg?no-inline";

const noHidden: string[] = [];

export type NavigatorView = "diffs" | "files";

export type NavigatorProps = {
  groupChanges: boolean;
  options: GuideOptions;
  authors: GuideAuthor[];
  turns: Record<number, Turn>;
  onViewThread: (id: number) => void;
  workspace: Workspace;
  pr: PullRequestData;
  view: NavigatorView;
  layout: "tree" | "list"; // the canvas's display options
  reviewed: string[];
  changedSinceReview: string[];
  showReviewed: boolean;
  entries: ReviewEntry[]; // the workspace's, counted per file
  local?: ChangedFile[]; // files with local changes, marked (ADR 0028); left out when only those are listed
  selected?: string; // the file shown in the canvas, revealed and selected in Files
  onOpen: (path: string) => void;
  onReviewedChange: (path: string, on: boolean) => void;
};

// Keep the visited trees alive within a workspace: returning to Files preserves expansion and avoids
// rebuilding a large Pierre model. The workspace key releases both models on a workspace switch.
export function RetainedNavigator(
  props: Omit<NavigatorProps, "view"> & {
    view: NavigatorView | "sections";
    livePr: PullRequestData;
    onOpenFile: (path: string) => void;
  },
) {
  const [visited, setVisited] = useState<Set<NavigatorView>>(new Set());
  useEffect(() => {
    if (props.view === "sections") return;
    const view = props.view;
    setVisited((before) => (before.has(view) ? before : new Set([...before, view])));
  }, [props.view]);
  return (
    <>
      {(["diffs", "files"] as const).map((view) =>
        props.view === view || visited.has(view) ? (
          <div
            key={view}
            className={props.view === view ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            <Navigator
              {...props}
              view={view}
              selected={props.view === view ? props.selected : undefined}
              onOpen={(path) => {
                if (props.view !== view) return;
                if (view === "files") props.onOpenFile(path);
                else props.onOpen(path);
              }}
              pr={view === "files" ? props.livePr : props.pr}
              local={view === "files" ? (props.livePr.local ?? undefined) : props.local}
            />
          </div>
        ) : null,
      )}
    </>
  );
}

// L2: the workspace's changed files (diffs) or its whole file tree (files).
// The file tree reloads whenever the worktree changes, like the changes.
export function Navigator({
  workspace,
  pr,
  view,
  layout,
  reviewed,
  changedSinceReview,
  showReviewed,
  entries,
  local,
  selected,
  onOpen,
  onReviewedChange,
  ...threadProps
}: NavigatorProps) {
  const files = useQuery({
    ...core("listWorktreeFiles", workspace.id),
    enabled: view === "files" && !!pr.changed,
  }).data;
  const tree = files?.status === "ok" ? files.paths : null;
  const treeProblem = files && files.status !== "ok" ? files : null;

  const paths = useMemo(
    () => (view === "diffs" ? pr.changed?.map((file) => file.path) : tree),
    [view, pr.changed, tree],
  );
  const prepare = view === "files" && !!paths && paths.length > 1000;
  const prepared = useQuery({
    queryKey: ["tree-order", paths ? idOf(paths) : 0],
    queryFn: () => prepareTree(paths ?? []),
    enabled: prepare,
    staleTime: Infinity,
  });
  const input = useMemo(
    () => (prepare && prepared.data ? preparePresortedFileTreeInput(prepared.data) : undefined),
    [prepare, prepared.data],
  );
  const lastPrepared = useRef<{ paths: string[]; input: FileTreePreparedInput } | undefined>(
    undefined,
  );
  if (input && paths) lastPrepared.current = { paths, input };
  const retained = prepare && !input && !prepared.isError ? lastPrepared.current : undefined;
  const problem = pr.problem ?? treeProblem;
  if (problem)
    return (
      <div className="p-2 text-xs">
        <ProblemMessage problem={problem} />
      </div>
    );
  if (!pr.commits)
    return <Notice>Preparing the worktree (the first time clones the repository)…</Notice>;
  if (!pr.changed || !paths) return <Notice>Loading…</Notice>;
  if (paths.length === 0) return <Notice>No changed files</Notice>;
  if (prepare && !input && !prepared.isError && !retained) return <Notice>Preparing files…</Notice>;
  const displayPaths = retained?.paths ?? paths;
  const displayInput = retained?.input ?? input;

  if (view === "diffs")
    return (
      <ChangesNavigator
        {...threadProps}
        workspace={workspace}
        pr={pr}
        view={view}
        layout={layout}
        reviewed={reviewed}
        changedSinceReview={changedSinceReview}
        showReviewed={showReviewed}
        entries={entries}
        local={local}
        selected={selected}
        onOpen={onOpen}
        onReviewedChange={onReviewedChange}
      />
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pr.notice && <div className={cn("px-2 py-1 text-xs", muted)}>{pr.notice}</div>}
      {/* Remounts on a new list: the tree takes its paths only when created. A refetch with the same paths keeps
          the same array (structural sharing), so the tree keeps its state. */}
      <Tree
        key={`${view}:${layout}:${idOf(displayPaths)}:${local ? idOf(local) : 0}`}
        paths={displayPaths}
        preparedInput={displayInput}
        changed={pr.changed}
        local={local}
        reviewed={reviewed}
        items={countItems(entries)}
        hidden={noHidden}
        expanded={false}
        flat={false}
        selected={view === "files" ? selected : undefined}
        onOpen={onOpen}
        onReviewedChange={onReviewedChange}
      />
    </div>
  );
}

const Notice = ({ children }: { children: string }) => (
  <div className={cn("p-2 text-xs", muted)}>{children}</div>
);

// A number per loaded list, so a reload (a new array) remounts the tree.
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ++nextId), nextId);

type TreeProps = {
  preparedInput?: FileTreePreparedInput;
  paths: string[];
  changed: ChangedFile[];
  local?: ChangedFile[];
  reviewed: string[];
  items: Map<string, ItemCount>; // threads per path
  hidden: string[]; // left out of the tree, e.g. reviewed files
  expanded: boolean;
  flat: boolean; // every file as a top-level row with its full path, no folders
  selected?: string; // a path of the tree, not a list row
  onOpen: (path: string) => void;
  onReviewedChange: (path: string, on: boolean) => void;
};

// A list is a tree without folders. @pierre/trees has no list mode, so each row is named after the file alone,
// with its folder shown next to the +/− lines. Two files with the same name keep their whole path, with its
// slashes as division slashes (U+2215), which look alike but don't make folders. Paths are mapped at the edges
// of the tree only.
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirName = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
function listRows(paths: string[]): (p: string) => string {
  const seen = new Map<string, number>();
  for (const p of paths) seen.set(baseName(p), (seen.get(baseName(p)) ?? 0) + 1);
  return (p) => (seen.get(baseName(p))! > 1 ? p.replaceAll("/", "∕") : baseName(p));
}

function Tree({
  preparedInput,
  paths,
  changed,
  local,
  reviewed,
  items,
  hidden,
  expanded,
  flat,
  selected,
  onOpen,
  onReviewedChange,
}: TreeProps) {
  const reviewAction = useRef(onReviewedChange);
  reviewAction.current = onReviewedChange;
  const openAction = useRef(onOpen);
  openAction.current = onOpen;
  const syncingSelection = useRef(false);
  const [row] = useState(() => (flat ? listRows(paths) : (p: string) => p));
  const themeStyles = useFileTreeTheme();
  const visible = useMemo(() => {
    const excluded = new Set(hidden);
    return paths.filter((p) => !excluded.has(p)).map(row);
  }, [paths, hidden, row]);
  const [counts] = useState(() => {
    const locally = new Set(local?.map((f) => f.path));
    return new Map(
      changed.map((f) => {
        return [
          row(f.path),
          { additions: f.additions, deletions: f.deletions, local: locally.has(f.path) },
        ];
      }),
    );
  });
  const [files] = useState(() => new Map(paths.map((p) => [row(p), p])));
  // Read by the decorations, which the tree takes only when created.
  const reviewedNow = useRef(new Set(reviewed.map(row)));
  const itemsOf = (m: Map<string, ItemCount>) => new Map([...m].map(([p, c]) => [row(p), c]));
  const itemsNow = useRef(itemsOf(items));
  const { model } = useFileTree({
    unsafeCSS: threadMarkCSS,
    icons: { set: "complete", colored: false },
    paths: visible,
    preparedInput,
    gitStatus: changed.map((f) => ({ path: row(f.path), status: f.status })),
    initialExpansion: expanded ? "open" : "closed",
    flattenEmptyDirectories: true,
    density: "compact",
    itemHeight: 28,
    renderRowDecoration: ({ item }) => {
      const c = counts.get(item.path);
      if (!c) return null;
      const reviewed = reviewedNow.current.has(item.path);
      const i = itemsNow.current.get(item.path);
      const parts = [
        ...(c.additions
          ? [{ text: `+${c.additions}`, color: "light-dark(#16a34a, #4ade80)" }]
          : []),
        ...(c.deletions
          ? [
              {
                text: `${c.additions ? "\u00a0" : ""}−${c.deletions}`,
                color: "light-dark(#dc2626, #f87171)",
              },
            ]
          : []),
        ...(c.local ? [{ text: "\u2003●", color: "var(--trees-status-modified)" }] : []),
        ...(i ? [{ text: "\u2003", color: threadMark }] : []),
      ];
      const title =
        [
          files.get(item.path) ?? item.path,
          reviewed && "Reviewed",
          c.local && "Local changes",
          i && itemsTitle(i),
        ]
          .filter(Boolean)
          .join(" · ") || undefined;
      return { text: parts.map((p) => p.text).join(""), title, parts };
    },
    // Selecting a folder only opens it; selecting a file opens it in the Viewer.
    onSelectionChange: (selected) => {
      if (syncingSelection.current) return;
      const path = selected.at(-1);
      const file = path && files.get(path);
      if (file) openAction.current(file);
    },
  });
  const itemsKey = JSON.stringify([...items]);
  useEffect(() => {
    const [reviewedBefore, itemsBefore] = [reviewedNow.current, itemsNow.current];
    reviewedNow.current = new Set(reviewed.map(row));
    itemsNow.current = itemsOf(items);
    const count = (m: Map<string, ItemCount>, p: string) => JSON.stringify(m.get(p));
    const toggled = changed
      .map((f) => ({ path: row(f.path), status: f.status }))
      .filter(
        (f) =>
          reviewedBefore.has(f.path) !== reviewedNow.current.has(f.path) ||
          count(itemsBefore, f.path) !== count(itemsNow.current, f.path),
      );
    // ponytail: the tree has no call to redraw decorations, so drop and restore the git status of the changed
    // rows to make it redraw them. Replace with a decoration refresh if @pierre/trees gets one.
    if (!toggled.length) return;
    model.applyGitStatusPatch({ remove: toggled.map((f) => f.path) });
    model.applyGitStatusPatch({ set: toggled });
  }, [reviewed, itemsKey]);
  // Reveal: open its folder (and theirs), make it the only selection, scroll it into view. Again after a remount.
  useEffect(() => {
    if (!selected || model.getItem(selected)?.isSelected()) return;
    const folder = dirName(selected);
    const dir = folder && model.getItem(`${folder}/`);
    if (dir && "expand" in dir) dir.expand();
    syncingSelection.current = true;
    try {
      for (const p of model.getSelectedPaths()) model.getItem(p)?.deselect();
      model.getItem(selected)?.select();
    } finally {
      syncingSelection.current = false;
    }
    model.scrollToPath(selected, { offset: "center" });
  }, [selected]);
  const visibleKey = visible.join("\0");
  // Only when the paths changed since the tree last took them: resetting folds every folder, so a second run on
  // mount (StrictMode) would undo the reveal above.
  const taken = useRef(visibleKey);
  useEffect(() => {
    if (taken.current === visibleKey) return;
    taken.current = visibleKey;
    model.resetPaths(visible);
  }, [visibleKey]);
  const treeHost = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<
    {
      host: HTMLElement;
      path: string;
      name?: string;
      directory: boolean;
      showFolder: boolean;
      deleted: boolean;
      key: string;
    }[]
  >([]);
  useEffect(() => {
    const shadow = treeHost.current?.querySelector("file-tree-container")?.shadowRoot;
    if (!shadow) return;
    const names = new Map<string, number>();
    for (const path of paths) names.set(baseName(path), (names.get(baseName(path)) ?? 0) + 1);
    const annotate = () => {
      const next: typeof labels = [];
      for (const row of shadow.querySelectorAll<HTMLElement>("[data-item-path]")) {
        const path = row.getAttribute("data-item-path") ?? "";
        const fullPath = files.get(path) ?? path;
        row.title = fullPath;
        row.dataset.sidebarRow = "true";
        row.dataset.sidebarCurrent = String(row.hasAttribute("data-item-selected"));
        row.dataset.lastBranch = String(
          row.getAttribute("aria-posinset") === row.getAttribute("aria-setsize"),
        );
        const spacing = row.querySelector<HTMLElement>('[data-item-section="spacing"]');
        if (spacing) {
          spacing.style.setProperty("--sidebar-depth", String(spacing.children.length));
          for (const [level, item] of [...spacing.children].entries())
            (item as HTMLElement).style.setProperty("--sidebar-level", String(level));
        }
        const branch = row.querySelector<HTMLElement>(
          '[data-item-section="spacing-item"]:last-child',
        );
        if (branch) {
          branch.classList.add("sidebar-tree-branch");
          branch.dataset.sidebarLast = row.dataset.lastBranch;
        }
        const label = row.querySelector<HTMLElement>('[data-item-section="content"]');
        if (label) {
          label.title = fullPath;
          let host = label.querySelector<HTMLElement>("[data-sidebar-label-host]");
          if (!host) {
            host = document.createElement("span");
            host.dataset.sidebarLabelHost = "";
            label.replaceChildren(host);
          }
          const directory = row.dataset.itemType === "folder";
          next.push({
            host,
            path: fullPath,
            directory,
            name: directory ? (row.getAttribute("aria-label") ?? undefined) : undefined,
            showFolder: flat && !directory && (names.get(baseName(fullPath)) ?? 0) > 1,
            deleted: row.dataset.itemGitStatus === "deleted",
            key: `${path}:${row.hasAttribute("data-file-tree-sticky-row")}`,
          });
        }
        if (!counts.has(path)) {
          row.querySelector("[data-file-review-control]")?.remove();
          continue;
        }
        let checkbox = row.querySelector<HTMLInputElement>("[data-file-reviewed]");
        if (!checkbox) {
          const control = document.createElement("label");
          control.dataset.fileReviewControl = "";
          control.title = "Reviewed";
          checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.dataset.fileReviewed = "";
          control.append(checkbox);
          // Review does not select a file or change the canvas position.
          control.addEventListener("click", (event) => event.stopPropagation());
          control.addEventListener("pointerdown", (event) => event.stopPropagation());
          control.addEventListener("keydown", (event) => event.stopPropagation());
          checkbox.addEventListener("change", (event) => {
            const currentPath = row.getAttribute("data-item-path") ?? "";
            reviewAction.current(
              files.get(currentPath) ?? currentPath,
              (event.target as HTMLInputElement).checked,
            );
          });
          row.append(control);
        }
        checkbox.checked = reviewedNow.current.has(path);
        const reviewLabel = `Reviewed: ${baseName(fullPath)}`;
        if (checkbox.getAttribute("aria-label") !== reviewLabel)
          checkbox.setAttribute("aria-label", reviewLabel);
      }
      setLabels((before) =>
        before.length === next.length &&
        before.every(
          (label, i) =>
            label.host === next[i].host &&
            label.path === next[i].path &&
            label.name === next[i].name &&
            label.deleted === next[i].deleted,
        )
          ? before
          : next,
      );
    };
    // ponytail: Pierre decorations only accept text/icons. Adapt its mounted rows for native
    // review inputs and shared React labels; replace this bridge when the library exposes row slots.
    // Titles must exist before the pointer enters. Refresh for recycled/expanded rows,
    // not on pointer-over (too late for the first native tooltip query).
    annotate();
    const observer = new MutationObserver(annotate);
    observer.observe(shadow, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-posinset",
        "aria-setsize",
        "data-item-path",
        "data-item-selected",
        "aria-label",
        "data-item-git-status",
      ],
    });
    return () => observer.disconnect();
  }, [files, reviewed]);
  return (
    <div
      ref={treeHost}
      className="flex min-h-0 flex-1 flex-col"
      onClickCapture={(event) => {
        const target = event.nativeEvent
          .composedPath()
          .find((node) => node instanceof HTMLElement && node.hasAttribute("data-item-path"));
        const control = event.nativeEvent
          .composedPath()
          .some(
            (node) => node instanceof HTMLElement && node.hasAttribute("data-file-review-control"),
          );
        if (control || !(target instanceof HTMLElement) || target.dataset.itemType !== "file")
          return;
        const path = target.dataset.itemPath;
        if (path && model.getSelectedPaths().includes(path)) onOpen(files.get(path) ?? path);
      }}
    >
      {labels.map(({ host, key, ...label }) =>
        createPortal(<SidebarFileLabel {...label} />, host, key),
      )}
      <FileTree
        model={model}
        className="min-h-0 flex-1"
        style={{
          ...themeStyles,
          height: "100%",
          background: "var(--review-canvas-bg)",
          ...treeLayout,
          ...(flat ? { "--trees-padding-inline-override": "16px 16px" } : {}),
        }}
      />
    </div>
  );
}

// CSS custom properties are supported by Pierre's host; keep geometry separate from theme colors.
const treeLayout = {
  "--trees-bg-override": "var(--review-canvas-bg)",
  "--trees-padding-inline-override": "8px 16px",
  "--trees-border-radius-override": "12px",
  "--trees-font-family-override": "system-ui",
  "--trees-font-size-override": "var(--guide-file-font-size)",
  "--trees-bg-muted-override": "var(--guide-hover-bg)",
  "--trees-indent-guide-bg-override": "var(--guide-tree-line)",
  "--trees-item-padding-x-override": "4px",
  "--trees-level-gap-override": "8px",
  "--trees-status-renamed-override": "var(--trees-status-modified)",
  "--trees-status-untracked-override": "var(--trees-status-added)",
};

// A file with threads shows a speech bubble. A row's decoration is text or one
// icon, not both, so the bubble is drawn by CSS after the text part of this colour (the tree sets it as a style), from
// a file the app serves: the CSP's img-src doesn't take data: URLs.
// ponytail: matches the part by its colour; use a decoration icon part if @pierre/trees gets one.
// The decoration keeps its width and a long name is cut short instead: the tree lets the name take it all, which hid
// the lines and the bubble of every file with a long name.
const threadMark = "#8a8a8f";
const threadMarkCSS =
  sidebarRowCSS +
  sidebarTreeCSS +
  `
[data-type="item"] { color: light-dark(#404040, #d4d4d4); gap: 8px; cursor: default; }
[data-sidebar-label-host] { display: flex; min-width: 0; max-width: 100%; }
[data-item-type="folder"] [data-item-section="content"] { font-weight: 600; }
[data-item-section="icon"], [data-item-section="icon"] svg { width: 14px; height: 14px; }
[data-item-section="content"] { min-width: 0; display: flex; align-items: center; gap: 8px; }
[data-item-section="content"] { color: light-dark(#404040, #d4d4d4) !important; }
[data-item-type="file"] [data-item-section="content"], [data-item-type="file"] [data-item-section="icon"], [data-item-type="file"] [data-item-section="icon"] svg { color: ${softenFileStatus("var(--trees-item-git-status-color, light-dark(#404040, #d4d4d4))")} !important; }
[data-item-section="icon"], [data-item-section="icon"] svg { color: var(--trees-fg-muted) !important; }
[data-item-section="decoration"] { font: 11px ui-monospace, monospace; opacity: .8; }
[data-item-section="git"] { display: none; }
[data-file-review-control] { width: 32px; height: 28px; flex: 0 0 32px; display: flex; align-items: center; justify-content: center; }
[data-file-reviewed] { margin: 0; accent-color: var(--reviewed-color); }
[data-file-reviewed]:not(:checked) { opacity: .45; }
[data-file-review-control]:hover [data-file-reviewed]:not(:checked), [data-file-reviewed]:focus-visible { opacity: .8; }
[data-item-section="spacing-item"] { position: relative; opacity: 1 !important; background: none !important; border-left: .5px solid var(--guide-tree-line); }
[data-item-section="spacing-item"].sidebar-tree-branch { border-left: 0; --sidebar-branch-left: 0px; }
[data-item-section="spacing"] { position: relative; padding: 0; flex: 0 0 max(0px, calc(var(--sidebar-depth) * 20px - 8px)); width: max(0px, calc(var(--sidebar-depth) * 20px - 8px)); }
[data-item-section="spacing-item"] { position: absolute; left: calc(7px + var(--sidebar-level) * 20px); top: 0; width: 16px; margin: 0 !important; transform: none; }
[data-item-type="folder"] [data-item-section="icon"] svg { transform-origin: center; }
[data-item-section="decoration"] {
  flex: 0 0 auto;
  margin-inline-start: auto;
}
span[style*="rgb(138, 138, 143)"]::after {
  content: "";
  display: inline-block;
  width: 12px;
  height: 12px;
  vertical-align: -1px;
  background: var(--trees-fg-muted);
  mask: url("${bubbleUrl}") center / contain no-repeat;
}`;
