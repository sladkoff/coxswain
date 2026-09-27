import type { Commit } from "../../core/git";
import type { Guide } from "../../core/guides";
import { Button, ToggleButton } from "./components/button";
import { CogIcon, SearchIcon } from "./components/icons";
import { cn, divider, titleBar } from "./components/styles";
import { shortDateTime } from "./format";

type Props = {
  files: number | undefined; // how many file diffs are on the canvas
  leftPane: "files" | "commits" | null;
  onToggleLeftPane: (pane: "files" | "commits") => void;
  ready: boolean; // the PR's commits are loaded, so Commits and Guide can open
  commit: Commit | null;
  guide: Guide | null;
  onGuide: () => void;
  onOpenQuickly: () => void;
  onViewOptions: () => void;
};

// The canvas's bar: Files, Commits and Guide on the left, Open Quickly and the view options on the right. It also
// drags the window, so it lines up with the agent pane's. ponytail: no tabs row until the canvas shows a second thing.
export function CanvasBar(props: Props) {
  return (
    <div
      className={cn(
        titleBar,
        "gap-1 border-b px-2 text-xs [&_button]:[-webkit-app-region:no-drag]",
        divider,
      )}
    >
      <ToggleButton
        title="Show or hide the files (⌘B)"
        on={props.leftPane === "files"}
        onClick={() => props.onToggleLeftPane("files")}
      >
        Files {props.files ?? ""}
      </ToggleButton>
      <ToggleButton
        title="Show or hide the commits, to see one commit's changes"
        disabled={!props.ready}
        className="max-w-80 truncate"
        on={props.leftPane === "commits" || !!props.commit}
        onClick={() => props.onToggleLeftPane("commits")}
      >
        {props.commit ? `${props.commit.sha.slice(0, 7)} ${props.commit.subject}` : "Commits"}
      </ToggleButton>
      <ToggleButton
        title="Make a guide, or pick the guide to show"
        disabled={!props.ready}
        on={!!props.guide}
        onClick={props.onGuide}
      >
        {props.guide ? `Guide · ${shortDateTime(props.guide.createdAt)}` : "Guide"}
      </ToggleButton>
      <div className="flex-1" />
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
        title="View options"
        className="p-1 text-neutral-500"
        onClick={props.onViewOptions}
      >
        <CogIcon />
      </Button>
    </div>
  );
}
