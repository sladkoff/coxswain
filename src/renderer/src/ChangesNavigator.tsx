import { Button } from "./components/button";
import { reviewCountLabel } from "./remaining-files";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFileTree } from "@pierre/trees/react";
import { match } from "ts-pattern";
import type { NavigatorProps } from "./Navigator";
import { changesRowPaths } from "./changes-order";
import { visibleSidebarThreads } from "./sidebar-threads";
import { SidebarFileThreads } from "./components/SidebarFileThreads";
import { SidebarFileLabel } from "./components/SidebarFileLabel";
import { SidebarReviewedCheckbox } from "./components/SidebarReviewedCheckbox";
import { SidebarDisclosure } from "./components/SidebarDisclosure";
import { useFileTreeTheme } from "./components/file-tree-theme";
import { cn, muted } from "./components/styles";
import { changeGroup, changeGroups, type ChangeGroup } from "./change-groups";

export function ChangesNavigator(props: NavigatorProps) {
  const nav = useRef<HTMLElement>(null);
  const theme = useFileTreeTheme();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ChangeGroup>>(new Set());
  const setGroupOpen = (id: ChangeGroup, open: boolean) =>
    setCollapsedGroups((before) => {
      const next = new Set(before);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  const roots = useMemo(
    () =>
      visibleSidebarThreads(
        props.entries.filter((entry) => !!entry.path),
        props.options,
        props.authors,
      ),
    [props.entries, props.options, props.authors],
  );
  const byFile = useMemo(() => Map.groupBy(roots, (entry) => entry.path!), [roots]);
  const files = (props.pr.changed ?? []).filter(
    (file) =>
      (props.showReviewed || !props.reviewed.includes(file.path)) &&
      (!props.options.onlyFilesWithThreads || byFile.has(file.path)),
  );
  if (!files.length) {
    const allReviewed =
      !!props.pr.changed?.length &&
      props.pr.changed.every((file) => props.reviewed.includes(file.path));
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-xs",
          muted,
        )}
      >
        <span>
          {allReviewed && !props.showReviewed
            ? `All ${props.pr.changed?.length} files reviewed`
            : "No matching files"}
        </span>
      </div>
    );
  }
  const tree = (groupFiles: typeof files, group?: ChangeGroup) => (
    <ChangesTree
      key={`${props.layout}:${group ?? "all"}:${groupFiles.map((file) => file.path).join("\0")}`}
      {...props}
      files={groupFiles}
      byFile={byFile}
      nested={!!group}
    />
  );
  return (
    <nav
      ref={nav}
      style={theme}
      aria-label="Changed files and threads"
      className="changes-navigation guide-navigation min-h-0 flex-1 overflow-y-auto py-2 pr-4 pl-2 text-xs [scrollbar-gutter:stable]"
      onKeyDownCapture={(event) => {
        if (!(event.target instanceof HTMLElement)) return;
        const current = event.target.closest<HTMLButtonElement>("button.guide-section-link");
        if (!current) return;
        const buttons = [
          ...(nav.current?.querySelectorAll<HTMLButtonElement>("button.guide-section-link") ?? []),
        ].filter((button) => button.checkVisibility());
        const index = buttons.indexOf(current);
        const next = match(event.key)
          .with("ArrowDown", () => Math.min(index + 1, buttons.length - 1))
          .with("ArrowUp", () => Math.max(index - 1, 0))
          .with("Home", () => 0)
          .with("End", () => buttons.length - 1)
          .otherwise(() => null);
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        buttons[next]?.focus();
      }}
    >
      {props.groupChanges
        ? changeGroups.map(({ id, label }) => {
            const groupFiles = files.filter((file) => changeGroup(file.path) === id);
            if (!groupFiles.length) return null;
            const allFiles = (props.pr.changed ?? []).filter(
              (file) => changeGroup(file.path) === id,
            );
            const reviewed = allFiles.filter((file) => props.reviewed.includes(file.path)).length;
            const additions = groupFiles.reduce((sum, file) => sum + file.additions, 0);
            const deletions = groupFiles.reduce((sum, file) => sum + file.deletions, 0);
            const open = !collapsedGroups.has(id);
            return (
              <section key={id} aria-label={label} className="mb-2 last:mb-0">
                <div className="guide-nav-item flex items-center" data-sidebar-row="true">
                  <Button
                    variant="ghost"
                    aria-expanded={open}
                    className="guide-section-link flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                    style={{ justifyContent: "flex-start" }}
                    onClick={() => setGroupOpen(id, !open)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      setGroupOpen(id, event.key === "ArrowRight");
                    }}
                  >
                    <SidebarDisclosure expanded={open} />
                    <span className="min-w-0 truncate font-semibold">{label}</span>
                    <span
                      className={cn(
                        "relative top-px shrink-0 text-[11px] font-normal tabular-nums",
                        muted,
                      )}
                      title={props.showReviewed ? "Reviewed / changed files" : "Unreviewed files"}
                    >
                      {reviewCountLabel(allFiles.length, reviewed, props.showReviewed)}
                    </span>
                    <span className="flex-1" />
                    {groupFiles.length > 0 && (
                      <span className="flex w-24 shrink-0 justify-end gap-1.5 font-mono text-[11px] font-normal opacity-80">
                        <span className="text-[var(--sidebar-added-light)] dark:text-green-400">
                          +{additions}
                        </span>
                        <span className="text-[var(--sidebar-deleted-light)] dark:text-red-400">
                          −{deletions}
                        </span>
                      </span>
                    )}
                  </Button>
                  <SidebarReviewedCheckbox
                    label={label}
                    checked={allFiles.length > 0 && reviewed === allFiles.length}
                    partial={reviewed > 0 && reviewed < allFiles.length}
                    disabled={!allFiles.length}
                    onChange={(on) => {
                      for (const file of allFiles)
                        if (props.reviewed.includes(file.path) !== on)
                          props.onReviewedChange(file.path, on);
                    }}
                  />
                </div>
                <div hidden={!open} className="changes-tree-children">
                  {groupFiles.length > 0 && tree(groupFiles, id)}
                </div>
              </section>
            );
          })
        : tree(files)}
    </nav>
  );
}

// ponytail: Changes renders its visible Pierre projection as shared variable-height file/thread groups.
// Window these groups by measured height if very large change lists become common; the full Files tree stays virtualized.
function ChangesTree(
  props: NavigatorProps & {
    files: NonNullable<NavigatorProps["pr"]["changed"]>;
    byFile: Map<string, NavigatorProps["entries"]>;
    nested: boolean;
  },
) {
  const nav = useRef<HTMLDivElement>(null);
  const rowPaths = useMemo(
    () =>
      changesRowPaths(
        props.files.map((file) => file.path),
        props.layout,
      ),
    [props.files, props.layout],
  );
  const rowOf = new Map([...rowPaths].map(([row, path]) => [path, row]));
  const { model } = useFileTree({
    paths: [...rowPaths.keys()],
    initialExpansion: "open",
    flattenEmptyDirectories: true,
  });
  const [rows, setRows] = useState(() => model.getVisibleRows(0, model.getVisibleCount()));
  useEffect(
    () => model.subscribe(() => setRows(model.getVisibleRows(0, model.getVisibleCount()))),
    [model],
  );
  const replies = useMemo(
    () => Map.groupBy(props.entries, (entry) => entry.parentId ?? 0),
    [props.entries],
  );
  const files = new Map(props.files.map((file) => [file.path, file]));
  const names = new Map<string, number>();
  props.files.forEach((file) => {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    names.set(name, (names.get(name) ?? 0) + 1);
  });
  const toggle = (path: string) => {
    const item = model.getItem(path);
    if (item && "toggle" in item) item.toggle();
  };
  const file = (path: string) => (
    <SidebarFileThreads
      path={path}
      file={files.get(path)}
      showFolder={
        props.layout === "list" && (names.get(path.slice(path.lastIndexOf("/") + 1)) ?? 0) > 1
      }
      current={props.selected === path}
      reviewed={props.reviewed.includes(path)}
      changedSinceReview={props.changedSinceReview.includes(path)}
      onReviewed={(on) => props.onReviewedChange(path, on)}
      onOpen={() => props.onOpen(path)}
      threads={props.byFile.get(path) ?? []}
      replies={replies}
      turns={props.turns}
      onThread={props.onViewThread}
    />
  );
  const renderRows = (start: number, end: number, nested: boolean): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    for (let index = start; index < end;) {
      const row = rows[index];
      let next = index + 1;
      while (next < end && rows[next].depth > row.depth) next++;
      const children =
        row.kind === "directory"
          ? (props.pr.changed ?? []).filter(
              (file) =>
                file.path.startsWith(`${row.path.replace(/\/$/, "")}/`) &&
                (!props.groupChanges ||
                  !props.files[0] ||
                  changeGroup(file.path) === changeGroup(props.files[0].path)),
            )
          : [];
      const reviewedChildren = children.filter((file) => props.reviewed.includes(file.path)).length;
      result.push(
        <div
          key={row.path}
          data-changes-path={row.path}
          className={nested ? "sidebar-tree-branch" : undefined}
          data-sidebar-last={nested && row.posInSet === row.setSize ? "true" : undefined}
        >
          {row.kind === "directory" ? (
            <>
              <div className="guide-nav-item flex items-center" data-sidebar-row="true">
                <Button
                  variant="ghost"
                  className="guide-section-link flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                  style={{ justifyContent: "flex-start" }}
                  aria-expanded={row.isExpanded}
                  title={row.path}
                  onClick={() => toggle(row.path)}
                >
                  <SidebarDisclosure expanded={row.isExpanded} />
                  <SidebarFileLabel
                    path={row.path}
                    name={
                      row.flattenedSegments?.map((segment) => segment.name).join(" / ") ?? row.name
                    }
                    directory
                  />
                  <span
                    className={cn(
                      "relative top-px shrink-0 text-[11px] font-normal tabular-nums",
                      muted,
                    )}
                    title={props.showReviewed ? "Reviewed / changed files" : "Unreviewed files"}
                  >
                    {reviewCountLabel(children.length, reviewedChildren, props.showReviewed)}
                  </span>
                </Button>
                <SidebarReviewedCheckbox
                  label={row.path}
                  checked={children.length > 0 && reviewedChildren === children.length}
                  partial={reviewedChildren > 0 && reviewedChildren < children.length}
                  disabled={!children.length}
                  onChange={(on) => {
                    for (const file of children)
                      if (props.reviewed.includes(file.path) !== on)
                        props.onReviewedChange(file.path, on);
                  }}
                />
              </div>
              {next > index + 1 && (
                <div className="changes-tree-children">{renderRows(index + 1, next, true)}</div>
              )}
            </>
          ) : (
            file(row.path)
          )}
        </div>,
      );
      index = next;
    }
    return result;
  };
  return (
    <div
      ref={nav}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".guide-thread-row, input")) return;
        const path = target.closest<HTMLElement>("[data-changes-path]")?.dataset.changesPath;
        if (!path) return;
        const rowPath = rowOf.get(path) ?? path;
        model.focusPath(rowPath);
        const handled = match(event.key)
          .with("ArrowDown", () => {
            model.focusNextItem();
            return true;
          })
          .with("ArrowUp", () => {
            model.focusPreviousItem();
            return true;
          })
          .with("Home", () => {
            model.focusFirstItem();
            return true;
          })
          .with("End", () => {
            model.focusLastItem();
            return true;
          })
          .with("ArrowRight", () => {
            const item = model.getItem(rowPath);
            if (item && "expand" in item) item.expand();
            return true;
          })
          .with("ArrowLeft", () => {
            const item = model.getItem(rowPath);
            if (item && "collapse" in item && item.isExpanded()) item.collapse();
            else model.focusParentItem();
            return true;
          })
          .otherwise(() => false);
        if (!handled) return;
        event.preventDefault();
        const focused = model.getFocusedPath();
        const next = focused ? (rowPaths.get(focused) ?? focused) : null;
        if (next)
          requestAnimationFrame(() =>
            nav.current
              ?.querySelector<HTMLElement>(`[data-changes-path="${CSS.escape(next)}"] button`)
              ?.focus(),
          );
      }}
    >
      {props.layout === "list"
        ? rows.map((row, index) => {
            const path = rowPaths.get(row.path) ?? row.path;
            return (
              <div
                key={path}
                data-changes-path={path}
                className={props.nested ? "sidebar-tree-branch" : undefined}
                data-sidebar-last={props.nested && index === rows.length - 1 ? "true" : undefined}
              >
                {file(path)}
              </div>
            );
          })
        : renderRows(0, rows.length, props.nested)}
    </div>
  );
}
