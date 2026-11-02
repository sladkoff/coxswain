import { WindowedContent } from "./windowed-content";
import { SidebarReviewedCheckbox } from "./SidebarReviewedCheckbox";
import type { ChangedFile } from "../../../core/git";
import type { ReviewEntry } from "../../../core/review";
import type { Turn } from "../Viewer";
import { ThreadRow } from "../Threads";
import { Button } from "./button";
import { SidebarFileLabel } from "./SidebarFileLabel";
import { FileTypeIcon } from "./FileTypeIcon";
import { fileStatusColor } from "./file-tree-theme";
import { cn, muted } from "./styles";

// The same file row, review control and thread pills in Guide and Changes.
type Props = {
  path: string;
  file?: ChangedFile;
  showFolder: boolean;
  current?: boolean;
  reviewed?: boolean;
  changedSinceReview?: boolean;
  onReviewed?: (on: boolean) => void;
  onOpen: () => void;
  threads: ReviewEntry[];
  replies: Map<number, ReviewEntry[]>;
  turns: Record<number, Turn>;
  onThread: (id: number) => void;
};
export function SidebarFileThreads(props: Props) {
  return (
    <WindowedContent
      sidebar
      path={props.path}
      estimate={32 + props.threads.length * 64}
      force={props.current}
    >
      <FileThreads {...props} />
    </WindowedContent>
  );
}
function FileThreads(props: Props) {
  const { path, file } = props;
  return (
    <>
      {path ? (
        <div
          className="guide-nav-item guide-file-row flex items-center"
          data-sidebar-file={path}
          data-sidebar-row="true"
          data-sidebar-current={props.current ? "true" : undefined}
          data-reading-file={props.current ? "true" : undefined}
        >
          <Button
            variant="ghost"
            className="guide-section-link review-guide-file flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
            title={path}
            data-sidebar-nav="open"
            onClick={props.onOpen}
          >
            <span className={muted} style={{ color: fileStatusColor(file?.status) }}>
              <FileTypeIcon path={path} />
            </span>
            <SidebarFileLabel
              path={path}
              changedSinceReview={props.changedSinceReview && !props.reviewed}
              showFolder={props.showFolder}
              deleted={file?.status === "deleted"}
              color={fileStatusColor(file?.status)}
            />
            <span className="flex-1" />
            {file && (
              <span className="flex shrink-0 gap-1.5 font-mono text-[11px] opacity-80">
                {file.additions > 0 && (
                  <span className="text-[var(--sidebar-added-light)] dark:text-green-400">
                    +{file.additions}
                  </span>
                )}
                {file.deletions > 0 && (
                  <span className="text-[var(--sidebar-deleted-light)] dark:text-red-400">
                    −{file.deletions}
                  </span>
                )}
              </span>
            )}
          </Button>
          {props.onReviewed && (
            <SidebarReviewedCheckbox
              label={path.slice(path.lastIndexOf("/") + 1)}
              checked={props.reviewed ?? false}
              onChange={(on) => props.onReviewed?.(on)}
            />
          )}
        </div>
      ) : (
        <div className={cn("px-2 pt-1 pb-0.5 text-[11px]", muted)}>Section discussion</div>
      )}
      {props.threads.length > 0 && (
        <div className="flex flex-col gap-1 py-0.5">
          {props.threads.map((entry) => (
            <ThreadRow
              key={entry.id}
              root={entry}
              replies={props.replies.get(entry.id) ?? []}
              answering={!!props.turns[entry.id]?.running}
              onClick={() => props.onThread(entry.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}
