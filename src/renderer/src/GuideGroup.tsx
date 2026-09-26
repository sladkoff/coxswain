import type { GuideGroup } from "../../core/guides";
import { cn, muted } from "./components/styles";
import { Prose } from "./components/text";
import { count } from "./format";

// A group's description and its file notes: readable text, at a line length that's easy to follow.
const guideProse =
  "max-w-[80ch] text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300";

// Above a guide group's file diffs: its title, how many files, and its description. group null: the files in no group.
export function GuideGroupHeader(props: {
  group: GuideGroup | null;
  files: number;
  reviewed: number;
}) {
  const g = props.group;
  return (
    <div className="flex flex-col gap-1.5 px-4 pt-6 pb-3 select-text">
      <h2 className="text-base font-semibold">
        {g ? <Prose inline>{g.title}</Prose> : "Not in the guide"}
      </h2>
      <div className={cn("text-xs", muted)}>
        {g?.tags.includes("generated") && "Generated · "}
        {count(props.files, "file")}
        {props.reviewed > 0 && `, ${props.reviewed} reviewed`}
      </div>
      {g?.description && <Prose className={guideProse}>{g.description}</Prose>}
    </div>
  );
}

// The guide's note on one file, above its file diff.
export function GuideFileNote({ children }: { children: string }) {
  return <Prose className={cn("px-4 pt-3 pb-2", guideProse)}>{children}</Prose>;
}
