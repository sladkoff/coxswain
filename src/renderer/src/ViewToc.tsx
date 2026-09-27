import type { ChangedFile } from "../../core/git";
import type { ReviewEntry } from "../../core/review";
import { ProgressBar } from "./components/layout";
import { cn, divider, muted, selectable } from "./components/styles";
import { Prose } from "./components/text";
import { countItems, itemsTitle } from "./format";

// A view section as the canvas shows it: its title and file diffs; title null is a guide's files in no section.
type Section = { title: string | null; diffs: { file: ChangedFile }[]; generated: boolean };

type Props = {
  sections: Section[];
  reviewed: string[];
  entries: ReviewEntry[];
  current: number; // the section at the top of the canvas's scroll
  onPick: (i: number) => void;
};

// A view's table of contents, left of the canvas while a view shows: how many file diffs are reviewed in all, then
// every section with how many of its file diffs are reviewed (✓ when all are) and the notes and questions on them. The
// section being read is marked; a click scrolls to it.
// ponytail: fixed width, no Splitter; make it resizable like the Navigator if titles get cut.
export function ViewToc({ sections, reviewed, entries, current, onPick }: Props) {
  const all = sections.flatMap((s) => s.diffs);
  const reviewedCount = all.filter((d) => reviewed.includes(d.file.path)).length;
  const items = countItems(entries);
  return (
    <nav
      className={cn(
        "flex w-60 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3 text-xs",
        divider,
      )}
    >
      {all.length > 0 && (
        <div className="flex flex-col gap-1">
          <ProgressBar value={reviewedCount} max={all.length} />
          <span className={muted}>
            {reviewedCount} of {all.length} reviewed
          </span>
        </div>
      )}
      {sections.map((s, i) => {
        const n = s.diffs.filter((d) => reviewed.includes(d.file.path)).length;
        const done = n === s.diffs.length;
        const c = s.diffs.reduce(
          (sum, d) => {
            const f = items.get(d.file.path);
            return {
              notes: sum.notes + (f?.notes ?? 0),
              questions: sum.questions + (f?.questions ?? 0),
            };
          },
          { notes: 0, questions: 0 },
        );
        const itemCount = c.notes + c.questions;
        return (
          <button
            key={i}
            onClick={() => onPick(i)}
            className={cn(
              "flex items-baseline gap-2 rounded px-1.5 py-1 text-left",
              selectable(i === current),
              ((done && s.diffs.length > 0) || s.generated) && muted,
            )}
          >
            <span className="min-w-0 flex-1">
              {s.title !== null ? <Prose inline>{s.title}</Prose> : "Not in the guide"}
            </span>
            {itemCount > 0 && (
              <span
                title={itemsTitle(c)}
                className="shrink-0 text-blue-600 tabular-nums dark:text-blue-400"
              >
                ✎ {itemCount}
              </span>
            )}
            {s.diffs.length > 0 && (
              <span className={cn("shrink-0 tabular-nums", muted)}>
                {done ? "✓" : `${n}/${s.diffs.length}`}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
