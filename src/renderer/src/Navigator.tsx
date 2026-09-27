import { FileTree, useFileTree } from "@pierre/trees/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ChangedFile } from "../../core/git";
import type { Workspace } from "../../core/workspaces";
import type { NavigatorSettings } from "../../preload";
import type { ReviewEntry } from "../../core/review";
import { Button } from "./components/button";
import { CogIcon } from "./components/icons";
import { cn, muted } from "./components/styles";
import { ProblemMessage } from "./components/text";
import { countItems, type ItemCount, itemsTitle } from "./format";
import { core } from "./queries";
import type { PullRequestData } from "./usePullRequest";

export type NavigatorView = "diffs" | "files";

type Props = {
  workspace: Workspace;
  pr: PullRequestData;
  view: NavigatorView;
  reviewed: string[];
  showReviewed: boolean;
  entries: ReviewEntry[]; // the workspace's, counted per file
  selected?: string; // the file shown in the canvas, revealed and selected in Files
  onOpen: (path: string) => void;
};

// L2: the workspace's changed files (diffs) or its whole file tree (files).
// The file tree reloads whenever the worktree changes, like the changes.
export function Navigator({
  workspace,
  pr,
  view,
  reviewed,
  showReviewed,
  entries,
  selected,
  onOpen,
}: Props) {
  const files = useQuery({
    ...core("listWorktreeFiles", workspace.id),
    enabled: view === "files" && !!pr.changed,
  }).data;
  const tree = files?.status === "ok" ? files.paths : null;
  const treeProblem = files && files.status !== "ok" ? files : null;
  // ponytail: reset per workspace and on restart; store them with the other UI state once there's a settings table.
  const [settings, setSettings] = useState<NavigatorSettings>({ layout: "tree" });

  const problem = pr.problem ?? treeProblem;
  if (problem)
    return (
      <div className="p-2 text-xs">
        <ProblemMessage problem={problem} />
      </div>
    );
  const paths = view === "diffs" ? pr.changed?.map((f) => f.path) : tree;
  if (!pr.commits)
    return <Notice>Preparing the worktree (the first time clones the repository)…</Notice>;
  if (!pr.changed || !paths) return <Notice>Loading…</Notice>;
  if (paths.length === 0) return <Notice>No changed files</Notice>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pr.notice && <div className={cn("px-2 py-1 text-xs", muted)}>{pr.notice}</div>}
      {view === "diffs" && (
        <div className={cn("flex items-center justify-between px-2 py-1 text-xs", muted)}>
          <span>
            {pr.changed.filter((f) => reviewed.includes(f.path)).length} of {pr.changed.length}{" "}
            reviewed
            {!showReviewed && reviewed.length > 0 && ", hidden"}
          </span>
          <Button
            variant="ghost"
            title="View options"
            className="p-0.5"
            onClick={async () => setSettings(await window.coxswain.showNavigatorMenu(settings))}
          >
            <CogIcon />
          </Button>
        </div>
      )}
      {/* Remounts on a new list: the tree takes its paths only when created. A refetch with the same paths keeps
          the same array (structural sharing), so the tree keeps its state. */}
      <Tree
        key={`${view}:${settings.layout}:${idOf(view === "diffs" ? pr.changed : paths)}`}
        paths={paths}
        changed={pr.changed}
        reviewed={reviewed}
        items={countItems(entries)}
        hidden={view === "diffs" && !showReviewed ? reviewed : []}
        expanded={view === "diffs"}
        flat={view === "diffs" && settings.layout === "list"}
        selected={view === "files" ? selected : undefined}
        onOpen={onOpen}
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
  paths: string[];
  changed: ChangedFile[];
  reviewed: string[];
  items: Map<string, ItemCount>; // notes and questions per path
  hidden: string[]; // left out of the tree, e.g. reviewed files
  expanded: boolean;
  flat: boolean; // every file as a top-level row with its full path, no folders
  selected?: string; // a path of the tree, not a list row
  onOpen: (path: string) => void;
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
  paths,
  changed,
  reviewed,
  items,
  hidden,
  expanded,
  flat,
  selected,
  onOpen,
}: TreeProps) {
  const [row] = useState(() => (flat ? listRows(paths) : (p: string) => p));
  const visible = paths.filter((p) => !hidden.includes(p)).map(row);
  const [counts] = useState(
    () =>
      new Map(
        changed.map((f) => {
          const lines = `+${f.additions} −${f.deletions}`;
          const folder = flat && row(f.path) === baseName(f.path) ? dirName(f.path) : "";
          return [row(f.path), { lines, folder }];
        }),
      ),
  );
  const [files] = useState(() => new Map(paths.map((p) => [row(p), p])));
  // Read by the decorations, which the tree takes only when created.
  const reviewedNow = useRef(new Set(reviewed.map(row)));
  const itemsOf = (m: Map<string, ItemCount>) => new Map([...m].map(([p, c]) => [row(p), c]));
  const itemsNow = useRef(itemsOf(items));
  const { model } = useFileTree({
    paths: visible,
    gitStatus: changed.map((f) => ({ path: row(f.path), status: f.status })),
    initialExpansion: expanded ? "open" : "closed",
    flattenEmptyDirectories: true,
    density: "compact",
    renderRowDecoration: ({ item }) => {
      const c = counts.get(item.path);
      if (!c) return null;
      const reviewed = reviewedNow.current.has(item.path);
      const i = itemsNow.current.get(item.path);
      const parts = [
        ...(c.folder ? [{ text: c.folder, color: "#a3a3a3" }] : []),
        // The gap after the folder is an em space starting the next part: trailing space on the folder is trimmed.
        ...(reviewed ? [{ text: "\u2003✓ ", color: "#16a34a" }] : []),
        { text: reviewed ? c.lines : `\u2003${c.lines}` },
        ...(i ? [{ text: `\u2003✎ ${i.notes + i.questions}`, color: "#2563eb" }] : []),
      ];
      const title =
        [reviewed && "Reviewed", i && itemsTitle(i)].filter(Boolean).join(" · ") || undefined;
      return { text: parts.map((p) => p.text).join(""), title, parts };
    },
    // Selecting a folder only opens it; selecting a file opens it in the Viewer.
    onSelectionChange: (selected) => {
      const path = selected.at(-1);
      const file = path && files.get(path);
      if (file) onOpen(file);
    },
  });
  const itemsKey = [...items].map(([p, c]) => `${p}:${c.notes}:${c.questions}`).join("\0");
  useEffect(() => {
    const [reviewedBefore, itemsBefore] = [reviewedNow.current, itemsNow.current];
    reviewedNow.current = new Set(reviewed.map(row));
    itemsNow.current = itemsOf(items);
    const count = (m: Map<string, ItemCount>, p: string) =>
      `${m.get(p)?.notes}:${m.get(p)?.questions}`;
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
    for (const p of model.getSelectedPaths()) model.getItem(p)?.deselect();
    model.getItem(selected)?.select();
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
  return <FileTree model={model} className="min-h-0 flex-1" style={{ height: "100%" }} />;
}
