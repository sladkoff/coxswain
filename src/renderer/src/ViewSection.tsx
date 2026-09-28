import { cn, muted } from "./components/styles";
import { Prose } from "./components/text";
import { count } from "./format";

// A view's prose: text at a line length that's easy to follow; diagrams and tables take the column's width, a diagram
// on a card like the file diffs.
const viewProse = cn(
  "text-[13.5px] leading-[1.65] text-neutral-700 dark:text-neutral-300",
  "[&>*:not(.mermaid,table)]:max-w-[72ch] [&_strong]:text-neutral-900 dark:[&_strong]:text-neutral-100",
  "[&_.mermaid]:my-4 [&_.mermaid]:rounded-lg [&_.mermaid]:border [&_.mermaid]:border-neutral-200 [&_.mermaid]:bg-neutral-50 [&_.mermaid]:p-4",
  "dark:[&_.mermaid]:border-neutral-800 dark:[&_.mermaid]:bg-neutral-950",
);

// Above a view section: its title and how many file diffs it embeds. title null: the files in no section of a guide.
export function ViewSectionHeader(props: {
  title: string | null;
  files: number;
  reviewed: number;
}) {
  return (
    <div className="flex flex-col gap-1 px-6 pt-8 pb-2 select-text">
      <h2 className="text-lg font-semibold tracking-tight">
        {props.title !== null ? <Prose inline>{props.title}</Prose> : "Not in the guide"}
      </h2>
      {props.files > 0 && (
        <div className={cn("text-xs", muted)}>
          {count(props.files, "file")}
          {props.reviewed > 0 && ` · ${props.reviewed} reviewed`}
        </div>
      )}
    </div>
  );
}

// A section's markdown between its file diffs. Close above the diff it leads into, set apart from the one before it
// (after: the part before is a file diff).
export function ViewProse({ children, after }: { children: string; after?: boolean }) {
  return (
    <Prose className={cn("px-6 pb-2.5", after ? "pt-6" : "pt-1", viewProse)}>{children}</Prose>
  );
}

// A file diff embedded in a view: a card, a little apart from the next. Clipped, not overflow-hidden, so the diff's
// sticky header still sticks.
export const viewDiff =
  "mx-6 mb-3 overflow-clip rounded-lg border border-neutral-200 dark:border-neutral-800";
