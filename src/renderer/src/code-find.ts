import {
  FileDiff,
  VirtualizedFile,
  VirtualizedFileDiff,
  parseDiffFromFile,
  type File,
  type FileContents,
  type FileDiffMetadata,
  type SelectionSide,
} from "@pierre/diffs";
import { useVirtualizer } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { diffFindLines, findText } from "./find-text";
import {
  refreshFind,
  registerFindTarget,
  textRange,
  type FindMatch,
  type FindTarget,
} from "./find";

type FindFiles = { old: FileContents; new: FileContents };
type Options = {
  root: RefObject<HTMLDivElement | null>;
  placeholder: RefObject<HTMLDivElement | null>;
  identity: string;
  path: string;
  kind: "file" | "diff";
  files: FindFiles | undefined;
  load: () => Promise<FindFiles | null>;
  reveal: () => void;
};

// File reads use the existing core bridge and query cache. Searching an off-screen file does not mount its viewer;
// only navigating to a result does. Pierre's public post-render hook then supplies its line-position API.
export function useCodeFind<A>(options: Options) {
  const virtualizer = useVirtualizer();
  const instance = useRef<File<A> | FileDiff<A> | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const { identity, path, kind } = options;
  const target = useMemo<FindTarget>(() => {
    let loaded: FindFiles | null | undefined;
    let loading: Promise<void> | undefined;
    let parsed: { old: string; new: string; diff: FileDiffMetadata } | undefined;
    const element = () => latest.current.root.current ?? latest.current.placeholder.current;
    return {
      pane: "canvas",
      label: path,
      element,
      prepare() {
        loading ??= latest.current
          .load()
          .then(
            (files) => {
              loaded = files;
            },
            (error) => {
              loaded = null;
              throw error;
            },
          )
          .finally(() => {
            loading = undefined;
          });
        return loading;
      },
      search(query, matchCase) {
        const files = loaded === null ? null : (latest.current.files ?? loaded);
        if (!files || !query) return [];
        const viewer = instance.current;
        let diff: FileDiffMetadata | undefined;
        if (kind === "diff") {
          if (!parsed || parsed.old !== files.old.contents || parsed.new !== files.new.contents) {
            parsed = {
              old: files.old.contents,
              new: files.new.contents,
              diff: parseDiffFromFile(files.old, files.new),
            };
          }
          diff = parsed.diff;
        }
        const matches: FindMatch[] = [];
        const add = (text: string, line: number, side: SelectionSide, context: boolean) => {
          const offsets = findText(text, query, matchCase);
          if (!offsets.length) return;
          if (context && diff) {
            const shown =
              viewer instanceof FileDiff
                ? viewer.isLineRenderable(line)
                : diff.hunks.some(
                    (h) => line >= h.additionStart && line < h.additionStart + h.additionCount,
                  );
            if (!shown) return;
          }
          const lineElement = () => {
            const shadow =
              latest.current.root.current?.querySelector("diffs-container")?.shadowRoot;
            const rows = shadow?.querySelectorAll<HTMLElement>(
              `[data-content] [data-line="${line}"]`,
            );
            return [...(rows ?? [])].find((row) => {
              if (kind === "file") return true;
              const column = row.closest("[data-code]");
              if (column?.hasAttribute("data-unified")) {
                const deletion = row.getAttribute("data-line-type") === "change-deletion";
                return side === "deletions" ? deletion : !deletion;
              }
              return column?.hasAttribute(`data-${side}`);
            });
          };
          for (const [start, end] of offsets)
            matches.push({
              key: `${identity}:${side}:${line}:${start}:${end}`,
              file: path,
              range: () => textRange(lineElement(), start, end),
              reveal: () => {
                latest.current.reveal();
                const row = lineElement();
                if (row?.getBoundingClientRect().height) {
                  row.scrollIntoView({ block: "center", inline: "nearest" });
                  return;
                }
                const rendered = instance.current;
                const root = element();
                if (!root) return;
                if (!virtualizer || !latest.current.root.current) {
                  root.scrollIntoView({ block: "start" });
                  return;
                }
                const position =
                  rendered instanceof VirtualizedFileDiff
                    ? rendered.getLinePosition(line, side)
                    : rendered instanceof VirtualizedFile
                      ? rendered.getLinePosition(line)
                      : undefined;
                if (!position) {
                  root.scrollIntoView({ block: "start" });
                  return;
                }
                const scrollRoot = virtualizer.getRoot();
                const height =
                  scrollRoot instanceof HTMLElement ? scrollRoot.clientHeight : innerHeight;
                virtualizer.scrollTo({
                  top: virtualizer.getOffsetInScrollContainer(root) + position.top - height / 2,
                });
              },
            });
        };
        if (diff) {
          // Unified reading order counts shared context once, even in split layout.
          for (const row of diffFindLines(diff)) add(row.text, row.line, row.side, row.context);
        } else {
          files.new.contents.split("\n").forEach((text, i) => add(text, i + 1, "additions", false));
        }
        return matches;
      },
    };
  }, [identity, path, kind, virtualizer]);
  useEffect(() => registerFindTarget(target), [target]);
  useEffect(() => {
    refreshFind(target);
  }, [target, options.files]);
  return useCallback(
    (_node: HTMLElement, rendered: File<A> | FileDiff<A>) => {
      instance.current = rendered;
      refreshFind(target);
    },
    [target],
  );
}
