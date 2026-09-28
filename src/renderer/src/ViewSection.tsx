import { cn, muted } from "./components/styles";
import { Prose } from "./components/text";
import { count } from "./format";

// A view's prose: readable text, at a line length that's easy to follow. Diagrams take the column's width.
const viewProse =
  "max-w-[80ch] text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300 [&_.mermaid]:max-w-none";

// Above a view section: its title and how many file diffs it embeds. title null: the files in no section of a guide.
export function ViewSectionHeader(props: {
  title: string | null;
  files: number;
  reviewed: number;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-4 pt-6 pb-1 select-text">
      <h2 className="text-base font-semibold">
        {props.title !== null ? <Prose inline>{props.title}</Prose> : "Not in the guide"}
      </h2>
      {props.files > 0 && (
        <div className={cn("text-xs", muted)}>
          {count(props.files, "file")}
          {props.reviewed > 0 && `, ${props.reviewed} reviewed`}
        </div>
      )}
    </div>
  );
}

// A section's markdown between its file diffs.
export function ViewProse({ children }: { children: string }) {
  return <Prose className={cn("px-4 pt-2 pb-2", viewProse)}>{children}</Prose>;
}
