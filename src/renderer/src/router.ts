import type { Commit } from "../../core/git";
import { createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { createElement, Profiler } from "react";
import { App } from "./App";

// What the canvas shows, as the location's search (ADR 0025). Each change is a history entry, so View > Back and
// Forward step through them. Left out: the defaults (the live file diffs, the Navigator on Diffs, no view chosen).
export type CanvasSearch = {
  settings?: true; // app Settings tab; the workspace location remains underneath it
  fileTabs?: { path: string; commit?: string }[]; // editor tabs, scoped to this workspace's location
  editorFile?: { path: string; commit?: string }; // last active editor tab when leaving Files
  codeLine?: import("./source-destination").CodeLine; // declaration selected within Guide or Changes
  thread?: number; // a thread to reveal and scroll to, including in a reviewed file
  ws?: number; // the workspace; Back into another workspace's entry opens it again
  view?: "diffs" | "files" | "sections"; // the Navigator tab; defaults to Sections
  section?: number; // the guide section selected in the Sections sidebar
  file?: string; // a whole file, shown in place of the file diffs while the toggle is on Files
  line?: number; // … scrolled to and selected when it's opened, not on Back or Forward
  fileAt?: string; // … at this commit, not the worktree: where Go to Definition or Find Usages found it (ADR 0034)
  at?: string; // the file diff picked in Diffs
  commit?: Commit; // one commit's diff (or an agent turn's) in place of all changes
  // One layer of the diff: what's on GitHub, the commits not pushed yet (ADR 0028), or what isn't committed; left out:
  // all of it.
  scope?: "pushed" | "unpushed" | "uncommitted";
  viewId?: number | null; // the view shown (ADR 0026); null: none, chosen by the user; left out: the newest if not stale
  pr?: true; // the PR panel in place of the diff and views (ADR 0037); any other pick on the canvas leaves it
};

// One route: the canvas has no pages, only this state. Memory history: an Electron window has no address bar.
const root = createRootRoute({
  component: import.meta.env.DEV ? ProfiledApp : App,
  validateSearch: (s): CanvasSearch => s,
});

export const router = createRouter({
  routeTree: root,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function ProfiledApp() {
  return createElement(
    Profiler,
    {
      id: "App",
      onRender: (_, phase, duration, _base, _start, commit) => {
        performance.measure(`cx:react:${phase}`, {
          start: Math.max(0, commit - duration),
          duration,
        });
      },
    },
    createElement(App),
  );
}
