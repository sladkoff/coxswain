import type { Commit } from "../../core/git";
import type { PullRequestDetails } from "../../core/github";
import { CheckDot } from "./PullRequest";
import type { View } from "../../core/views";
import { Activity } from "./Activity";
import { Button, SegmentedControl, ToggleButton } from "./components/button";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayersPlusIcon,
  ListTreeIcon,
  SearchIcon,
  SlidersIcon,
  SpinnerIcon,
  XIcon,
} from "./components/icons";
import { cn, divider, muted, selectable, titleBar } from "./components/styles";

export type PaneTab = "diffs" | "files" | "commits" | "turns";

// The bar over the pane left of the canvas, as wide as it: hide it, and switch it between Changes (the Navigator's
// file diffs), Files (the whole file tree) and Commits. It drags the window, like the canvas's bar.
export function PaneBar(props: {
  tab: PaneTab;
  files: number | undefined; // how many file diffs are on the canvas
  ready: boolean; // the PR's commits are loaded, so Commits can open
  onTab: (tab: PaneTab) => void;
  onHide: () => void;
}) {
  return (
    <div
      className={cn(
        titleBar,
        "gap-1.5 border-b px-2 text-xs [&_button]:[-webkit-app-region:no-drag]",
        divider,
      )}
    >
      <ToggleButton
        on
        icon
        title="Hide the navigator (⌘B)"
        className="shrink-0"
        onClick={props.onHide}
      >
        <ListTreeIcon />
      </ToggleButton>
      <SegmentedControl
        value={props.tab}
        onChange={(t) => ((t !== "commits" && t !== "turns") || props.ready) && props.onTab(t)}
        options={[
          {
            value: "diffs",
            label: `Changes ${props.files ?? ""}`.trim(),
            title: "The changed files",
          },
          { value: "files", label: "Files", title: "The whole file tree of the workspace" },
          { value: "commits", label: "Commits", title: "The commits" },
          { value: "turns", label: "Turns", title: "The agent turns that changed the worktree" },
        ]}
      />
    </div>
  );
}

type Props = {
  workspaceId: number;
  paneOpen: boolean; // the pane left of the canvas shows, with its own bar
  onShowPane: () => void;
  ready: boolean; // the PR's commits are loaded, so the diff's range and the views can open
  commit: Commit | null;
  view: View | null;
  views: View[]; // newest first
  snapshot: string | null; // the worktree now; a view of the worktree pinned to another is stale
  scope: "all" | "pushed" | "unpushed" | "uncommitted";
  hasPr: boolean; // what's pushed is the PR's
  onGitHub: boolean; // what's pushed is on GitHub, not another origin (ADR 0040)
  pr: PullRequestDetails | null; // the PR on GitHub, once read: its chip opens the PR panel (ADR 0037)
  onPr: boolean; // the PR panel shows
  onShowPr: () => void;
  onRangeMenu: () => void; // the Diff tab's range: a scope, or a commit or turn from the Commits pane
  onClearCommit: () => void;
  onShowView: (id: number | null) => void; // null: the diff, no view
  onRemoveView: (view: View, label: string) => void;
  onNewView: () => void;
  onOpenQuickly: () => void;
  onViewOptions: () => void;
  onSettings: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
};

// The canvas's bar: what the canvas shows on the left (the PR with its checks, Diff with its range, a chip per view,
// New View), then Back,
// Forward, Open Quickly, the display options and Activity. Showing or switching the left pane is the pane's own bar; while it's
// hidden, a button here shows it. It also drags the window, so it lines up with the agent pane's.
export function CanvasBar(props: Props) {
  const titles = viewTitles(props.views);
  const onDiff = !props.view && !props.onPr;
  // Always shown, a view showing or not, so the chips next to it never move.
  const range = props.commit
    ? props.commit.turn
      ? `Turn: ${props.commit.subject}`
      : props.commit.sha.slice(0, 7)
    : {
        all: "All",
        pushed: props.hasPr ? "PR" : props.onGitHub ? "On GitHub" : "Pushed",
        unpushed: "Not Pushed",
        uncommitted: "Uncommitted",
      }[props.scope];
  return (
    <div
      className={cn(
        titleBar,
        "gap-1 border-b px-2 text-xs [&_button]:[-webkit-app-region:no-drag]",
        divider,
      )}
    >
      {!props.paneOpen && (
        <>
          <Button
            variant="ghost"
            title="Show the navigator (⌘B)"
            className="p-1 text-neutral-500"
            onClick={props.onShowPane}
          >
            <ListTreeIcon />
          </Button>
          <div className={cn("mx-1 h-4 border-l", divider)} />
        </>
      )}
      {props.pr && (
        <ToggleButton
          on={props.onPr}
          title={`The PR on GitHub: its description, checks and conversation, and Post to GitHub${props.pr.checkState ? `\nChecks: ${props.pr.checkState}` : ""}`}
          className="flex shrink-0 items-center gap-1.5"
          onClick={props.onShowPr}
        >
          #{props.pr.number}
          {props.pr.checkState && <CheckDot state={props.pr.checkState} />}
        </ToggleButton>
      )}
      <div
        className={cn(
          "flex items-center rounded",
          selectable(onDiff),
          !onDiff && muted,
          !props.ready && "opacity-50",
        )}
      >
        <button
          title="Show the diff without a view"
          disabled={!props.ready}
          aria-pressed={onDiff}
          className="py-0.5 pr-1.5 pl-2"
          onClick={() => props.onShowView(null)}
        >
          Diff
        </button>
        <button
          title={props.commit ? props.commit.subject : "What the diff shows"}
          disabled={!props.ready}
          className={cn(
            "flex max-w-60 items-center gap-0.5 border-l py-0.5 pr-1 pl-1.5",
            divider,
            props.commit && "pr-0.5",
          )}
          onClick={props.onRangeMenu}
        >
          <span className="truncate">{range}</span>
          {!props.commit && <ChevronDownIcon />}
        </button>
        {props.commit && (
          <button
            title="Back to all changes"
            aria-label="Back to all changes"
            className="py-1 pr-1.5 pl-0.5"
            onClick={props.onClearCommit}
          >
            <XIcon />
          </button>
        )}
      </div>
      {props.views.toReversed().map((v) => (
        <ToggleButton
          key={v.id}
          title={`Made ${new Date(v.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} at ${v.head.slice(0, 7)}${!v.worktree ? `, of ${v.base.slice(0, 7)} → ${v.head.slice(0, 7)}` : props.snapshot && v.head !== props.snapshot ? " (stale)" : ""}`}
          disabled={!props.ready}
          className="flex max-w-40 items-center gap-1"
          on={v.id === props.view?.id}
          onClick={() => props.onShowView(v.id)}
          onContextMenu={async () => {
            if ((await window.coxswain.showViewChipMenu()) === "remove")
              props.onRemoveView(v, titles.get(v.id)!);
          }}
        >
          <span className="truncate">{titles.get(v.id)}</span>
          {v.writing && <SpinnerIcon />}
        </ToggleButton>
      ))}
      <Button
        variant="ghost"
        title="New view"
        className="rounded border border-dashed border-neutral-400 px-1.5 dark:border-neutral-600 py-0.5 text-neutral-500"
        disabled={!props.ready}
        onClick={props.onNewView}
      >
        <LayersPlusIcon />
      </Button>
      <div className="flex-1" />
      <Button
        variant="ghost"
        title="Back (⌥⌘←)"
        className="p-1 text-neutral-500"
        disabled={!props.canBack}
        onClick={props.onBack}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="ghost"
        title="Forward (⌥⌘→)"
        className="p-1 text-neutral-500"
        disabled={!props.canForward}
        onClick={props.onForward}
      >
        <ChevronRightIcon />
      </Button>
      <Button
        variant="ghost"
        title="Open Quickly (⌘⇧O)"
        className="p-1 text-neutral-500"
        onClick={props.onOpenQuickly}
      >
        <SearchIcon />
      </Button>
      <Button
        variant="ghost"
        title="Display options"
        className="p-1 text-neutral-500"
        onClick={props.onViewOptions}
      >
        <SlidersIcon />
      </Button>
      <Activity workspaceId={props.workspaceId} onSettings={props.onSettings} />
    </div>
  );
}

// Each view's title by id; a title used by an older view gets a number: Guide, Guide 2, …
export function viewTitles(views: View[]) {
  const oldestFirst = views.toReversed();
  return new Map(
    oldestFirst.map((v, i) => {
      const n = oldestFirst.slice(0, i).filter((o) => o.title === v.title).length;
      return [v.id, n > 0 ? `${v.title} ${n + 1}` : v.title];
    }),
  );
}
