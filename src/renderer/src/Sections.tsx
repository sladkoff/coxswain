import type { GuideReadingStore } from "./guide-reading-position";
import { createSidebarFollower } from "./components/sidebar-follow";
import { SidebarReviewedCheckbox } from "./components/SidebarReviewedCheckbox";
import { SidebarFileThreads } from "./components/SidebarFileThreads";
import { visibleSidebarThreads } from "./sidebar-threads";
import { useFileTreeTheme } from "./components/file-tree-theme";
import { type GuideAuthor } from "../../shared/guide-authors";
import { useEffect, useRef } from "react";
import { openedPath, type Opened, type Turn } from "./Viewer";
import type { ReviewEntry } from "../../core/review";
import type { GuideOptions } from "../../preload";
import type { ChangedFile } from "../../core/git";
import { count } from "./format";
import { Button } from "./components/button";
import { cn, muted } from "./components/styles";
import { Prose } from "./components/text";

// A guide's section order matches its canvas anchors, including ungrouped files.
export function Sections(props: {
  sections: { title: string | null; files: Opened[] }[] | null;
  readingPosition: GuideReadingStore;
  follow: boolean;
  viewId?: number;
  entries: ReviewEntry[];
  turns: Record<number, Turn>;
  options: GuideOptions;
  showReviewed: boolean;
  authors: GuideAuthor[];
  changed: ChangedFile[];
  changedSinceReview: string[];
  isReviewed: (file: Opened) => boolean;
  onOpenFile: (path: string) => void;
  onFileReviewedChange: (file: Opened, on: boolean) => void;
  onViewThread: (id: number) => void;
  notice?: string | null;
  onPick: (index: number) => void;
  onReviewedChange: (index: number, on: boolean) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const themeStyles = useFileTreeTheme();
  const lastMarker = useRef<string | undefined>(undefined);
  const follower = useRef<ReturnType<typeof createSidebarFollower> | null>(null);
  useEffect(() => {
    follower.current = createSidebarFollower();
    return () => follower.current?.stop();
  }, []);
  // Reading updates change only marker attributes. File/thread rows and the canvas do
  // not rerender; a damped animation owns the smooth scroll to the active file (or section fallback).
  useEffect(() => {
    const filterKey = JSON.stringify(props.options);
    const update = () => {
      const list = nav.current;
      if (!list) return;
      const reading = props.readingPosition.getSnapshot();
      const current = reading?.viewId === props.viewId ? reading : undefined;
      const section = current
        ? list.querySelector<HTMLElement>(`[data-guide-section="${current.section}"]`)
        : null;
      const key = `${current ? `${current.viewId}:${current.section}:${current.file ?? ""}` : "none"}:${props.follow}:${filterKey}`;
      if (lastMarker.current === key) return;
      lastMarker.current = key;
      for (const old of list.querySelectorAll<HTMLElement>(
        "[data-sidebar-current], [data-reading-file], [aria-current]",
      )) {
        old.removeAttribute("data-sidebar-current");
        old.removeAttribute("data-reading-file");
        old.removeAttribute("aria-current");
      }
      const title = section?.querySelector<HTMLElement>(".guide-section-title");
      title?.setAttribute("data-sidebar-current", "true");
      title?.querySelector("button")?.setAttribute("aria-current", "location");
      for (const row of section?.querySelectorAll<HTMLElement>("[data-sidebar-file]") ?? []) {
        if (row.dataset.sidebarFile !== current?.file) continue;
        row.setAttribute("data-sidebar-current", "true");
        row.setAttribute("data-reading-file", "true");
      }
      if (!current || !section) return;
      if (!props.follow) {
        follower.current?.stop();
        return;
      }
      const row =
        section.querySelector<HTMLElement>('[data-reading-file="true"]') ??
        section.querySelector<HTMLElement>(".guide-section-title");
      if (row)
        follower.current?.reveal(list, row, matchMedia("(prefers-reduced-motion: reduce)").matches);
    };
    update();
    return props.readingPosition.subscribe(update);
  });
  useEffect(() => {
    const list = nav.current;
    const stop = () => follower.current?.stop();
    list?.addEventListener("wheel", stop, { passive: true });
    list?.addEventListener("pointerdown", stop, { passive: true });
    return () => {
      list?.removeEventListener("wheel", stop);
      list?.removeEventListener("pointerdown", stop);
      stop();
    };
  }, []);
  const sections = props.sections ?? [];
  const roots = props.entries.filter(
    (entry) => (entry.path || entry.section != null) && !entry.parentId,
  );
  const shown = visibleSidebarThreads(roots, props.options, props.authors);
  const replies = Map.groupBy(props.entries, (entry) => entry.parentId ?? 0);
  const groups = Map.groupBy(shown, (entry) => {
    if (entry.section != null && entry.viewId === props.viewId && sections[entry.section])
      return entry.section;
    return sections.findIndex((section) =>
      section.files.some((file) => openedPath(file) === entry.path),
    );
  });
  const pathsByName = new Map<string, Set<string>>();
  for (const section of sections)
    for (const file of section.files) {
      const path = openedPath(file);
      const name = path.slice(path.lastIndexOf("/") + 1);
      const paths = pathsByName.get(name) ?? new Set<string>();
      paths.add(path);
      pathsByName.set(name, paths);
    }
  const threads = (index: number) => {
    const byFile = Map.groupBy(groups.get(index) ?? [], (entry) => entry.path ?? "");
    const files = new Map(props.changed.map((file) => [file.path, file]));
    for (const file of sections[index]?.files ?? [])
      if (file.kind === "diff") files.set(file.file.path, file.file);
    const sectionFiles = sections[index]?.files ?? [];
    const reviewedPaths = new Set(sectionFiles.filter(props.isReviewed).map(openedPath));
    const paths = new Set([
      ...(!props.options.onlyFilesWithThreads
        ? sectionFiles.filter((file) => file.kind === "diff").map(openedPath)
        : []),
      ...byFile.keys(),
    ]);
    return [...paths]
      .filter((path) => props.showReviewed || !reviewedPaths.has(path))
      .map((path, fileIndex, visiblePaths) => {
        const file = files.get(path);
        const opened =
          sectionFiles.find((item) => openedPath(item) === path) ??
          (file ? { kind: "diff" as const, file } : undefined);
        const slash = path.lastIndexOf("/");
        const ambiguous = (pathsByName.get(path.slice(slash + 1))?.size ?? 0) > 1;
        return (
          <div
            key={path}
            className="sidebar-tree-branch"
            data-sidebar-last={fileIndex === visiblePaths.length - 1 ? "true" : undefined}
          >
            <SidebarFileThreads
              path={path}
              file={file}
              showFolder={ambiguous}
              changedSinceReview={
                opened?.kind !== "file" && props.changedSinceReview.includes(path)
              }
              reviewed={opened ? props.isReviewed(opened) : false}
              onReviewed={opened ? (on) => props.onFileReviewedChange(opened, on) : undefined}
              onOpen={() => props.onOpenFile(path)}
              threads={byFile.get(path) ?? []}
              replies={replies}
              turns={props.turns}
              onThread={props.onViewThread}
            />
          </div>
        );
      });
  };
  return (
    <nav
      ref={nav}
      style={themeStyles}
      aria-label="Guide sections"
      className="guide-navigation min-h-0 flex-1 overflow-y-auto py-2 pr-4 pl-2 text-xs [scrollbar-gutter:stable]"
    >
      {props.notice && (
        <div role="status" className={cn("p-2", muted)}>
          {props.notice}
        </div>
      )}
      {!sections.length && <div className={cn("p-4 text-center", muted)}>No guide sections</div>}
      {sections.map((section, index) => {
        const reviewed = section.files.filter(props.isReviewed).length;
        const partial = reviewed > 0 && reviewed < section.files.length;
        return (
          <div key={index} data-guide-section={index} className="guide-section-node mb-2">
            <div
              className="guide-nav-item guide-section-title relative flex items-start"
              data-sidebar-row="true"
            >
              <Button
                key={index}
                variant="ghost"
                style={{ justifyContent: "flex-start", alignItems: "baseline" }}
                className="guide-section-link flex min-w-0 flex-1 items-baseline gap-2 px-2 py-2 text-left"
                onClick={() => props.onPick(index)}
              >
                <span className={cn("w-4 shrink-0 text-[13px] leading-5 font-normal", muted)}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0 leading-relaxed">
                  <span className="text-[13px] leading-5 font-semibold">
                    <Prose inline>{section.title ?? "Not in the guide"}</Prose>
                  </span>
                  {section.files.length > 0 ? (
                    <span className={cn("flex items-center gap-2 text-[11px] opacity-80", muted)}>
                      <span>{count(section.files.length, "file")}</span>
                      <span className="text-[var(--sidebar-added-light)] dark:text-green-400">
                        +
                        {section.files.reduce(
                          (n, f) => n + (f.kind === "diff" ? f.file.additions : 0),
                          0,
                        )}
                      </span>
                      <span className="text-[var(--sidebar-deleted-light)] dark:text-red-400">
                        −
                        {section.files.reduce(
                          (n, f) => n + (f.kind === "diff" ? f.file.deletions : 0),
                          0,
                        )}
                      </span>
                    </span>
                  ) : (
                    <span className={cn("text-[11px] opacity-80", muted)}>No files</span>
                  )}
                </span>
              </Button>
              {section.files.length > 0 && (
                <SidebarReviewedCheckbox
                  tall
                  label={section.title ?? "Not in the guide"}
                  checked={reviewed === section.files.length}
                  partial={partial}
                  onChange={(on) => props.onReviewedChange(index, on)}
                />
              )}
            </div>
            <div className="guide-section-children ml-4 pl-4">{threads(index)}</div>
          </div>
        );
      })}
      {!!groups.get(-1)?.length && (
        <div className="mt-3">
          <div className={cn("px-2 py-1", muted)}>Other threads</div>
          <div className="guide-section-children ml-4 pl-4">{threads(-1)}</div>
        </div>
      )}
    </nav>
  );
}
