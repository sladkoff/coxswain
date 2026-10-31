import type { Opened } from "./Viewer";
import type { CanvasSearch } from "./router";

export type CodeLine = { path: string; line: number; side: "additions" | "deletions" };
export type ReviewSurface = {
  visible: Opened[];
  base: string;
  head?: string;
};

// Only files already shown on this review surface qualify; hidden reviewed files never enter this list.
export function reviewSourceDestination(
  search: CanvasSearch,
  surface: ReviewSurface,
  path: string,
  line?: number,
  commit?: string,
): (CanvasSearch & { at: string }) | null {
  if (search.view === "files" || search.pr || search.settings) return null;
  for (const opened of surface.visible) {
    const name = opened.kind === "file" ? opened.path : opened.file.path;
    const newRevision = opened.kind === "file" ? (opened.commit ?? surface.head) : surface.head;
    const newSide =
      name === path &&
      (line === undefined || commit === newRevision) &&
      (opened.kind === "file" || opened.file.status !== "deleted");
    const oldSide =
      opened.kind === "diff" &&
      line !== undefined &&
      commit === surface.base &&
      (opened.file.previousPath ?? name) === path &&
      opened.file.status !== "added";
    if (!newSide && !oldSide) continue;
    return {
      at: name,
      file: undefined,
      fileAt: undefined,
      line: undefined,
      thread: undefined,
      section: undefined,
      codeLine:
        line === undefined
          ? undefined
          : { path: name, line, side: newSide ? "additions" : "deletions" },
    };
  }
  return null;
}
