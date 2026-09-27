import { openedPath, type Opened } from "./Viewer";
import type { ReviewEntry } from "../../core/review";
import { ProgressBar } from "./components/layout";
import { cn, divider, muted, selectable } from "./components/styles";
import { Prose } from "./components/text";
import { countItems, itemsTitle } from "./format";

// A view section as the canvas shows it: its title and embedded files and diffs; title null is a guide's files in no section.
type Section = { title: string | null; files: Opened[]; generated: boolean };

type Props = {
  sections: Section[];
  reviewed: string[];
  reviewedFiles: string[];
  entries: ReviewEntry[];
  current: number; // the section at the top of the canvas's scroll
  onPick: (i: number) => void;
};

// A view's table of contents, left of the canvas while a view shows: how many file diffs are reviewed in all, then
// every section with how many of its file diffs are reviewed (✓ when all are) and the notes and questions on them. The
// section being read is marked; a click scrolls to it.
// ponytail: fixed width, no Splitter; make it resizable like the Navigator if titles get cut.
export function ViewToc({ sections, reviewed, reviewedFiles, entries, current, onPick }: Props) {
  const isReviewed = (d: Opened) =>
    (d.kind === "file" ? reviewedFiles : reviewed).includes(openedPath(d));
  const all = sections.flatMap((s) => s.files);
  const reviewedCount = all.filter(isReviewed).length;
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
        const n = s.files.filter(isReviewed).length;
        const done = n === s.files.length;
        const c = s.files.reduce(
          (sum, d) => {
            const f = items.get(openedPath(d));
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
              ((done && s.files.length > 0) || s.generated) && muted,
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
            {s.files.length > 0 && (
              <span className={cn("shrink-0 tabular-nums", muted)}>
                {done ? "✓" : `${n}/${s.files.length}`}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
