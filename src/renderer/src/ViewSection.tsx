import { cn, muted } from "./components/styles";
import { Prose } from "./components/text";
import { count } from "./format";
import { useBlockEnd } from "./ProseThreads";

// A view's prose: text at a line length that's easy to follow; diagrams and tables take the column's width, a diagram
// on a card like the file diffs.
const viewProse = cn(
  "text-[13.5px] leading-[1.65] text-neutral-700 dark:text-neutral-300",
  "[&>*:not(.mermaid,table)]:max-w-[72ch] [&_strong]:text-neutral-900 dark:[&_strong]:text-neutral-100",
  "[&_.mermaid]:my-4 [&_.mermaid]:rounded-lg [&_.mermaid]:border [&_.mermaid]:border-neutral-200 [&_.mermaid]:bg-neutral-50 [&_.mermaid]:p-4",
  "dark:[&_.mermaid]:border-neutral-800 dark:[&_.mermaid]:bg-neutral-950",
);

// The heading of a guide's files in no section; while it's being written they may be in one yet.
export const notInGuide = (writing: boolean) =>
  writing ? "Not yet in the guide" : "Not in the guide";

// Above a view section: its title, how many file diffs it embeds and a Reviewed checkbox for them all, ticked once all
// are. title null: the files in no section of a guide.
export function ViewSectionHeader(props: {
  title: string | null;
  files: number;
  reviewed: number;
  writing: boolean;
  onReviewedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1 px-6 pt-8 pb-2 select-text">
      <h2 className="text-lg font-semibold tracking-tight">
        {props.title !== null ? <Prose inline>{props.title}</Prose> : notInGuide(props.writing)}
      </h2>
      {props.files > 0 && (
        <div className={cn("flex items-center gap-3 text-xs", muted)}>
          <span>
            {count(props.files, "file")}
            {props.reviewed > 0 && ` · ${props.reviewed} reviewed`}
          </span>
          <label className="flex items-center gap-1 select-none">
            <input
              type="checkbox"
              checked={props.reviewed === props.files}
              onChange={(e) => props.onReviewedChange(e.target.checked)}
            />
            Reviewed
          </label>
        </div>
      )}
    </div>
  );
}

// A section's markdown between its file diffs. Close above the diff it leads into, set apart from the one before it
// (after: the part before is a file diff). part: its index among the section's parts, where its threads are (ADR 0036).
export function ViewProse(props: { children: string; after?: boolean; part: number }) {
  const blockEnd = useBlockEnd(props.part);
  return (
    <div data-part={props.part}>
      <Prose
        className={cn("px-6 pb-2.5", props.after ? "pt-6" : "pt-1", viewProse)}
        blockEnd={blockEnd}
      >
        {props.children}
      </Prose>
    </div>
  );
}

// A file diff embedded in a view: a card, a little apart from the next. Clipped, not overflow-hidden, so the diff's
// sticky header still sticks.
export const viewDiff =
  "mx-6 mb-3 overflow-clip rounded-lg border border-neutral-200 dark:border-neutral-800";
