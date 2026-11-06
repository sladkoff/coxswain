import type { View } from "../../core/views";
import type { Opened } from "./Viewer";

export type SectionPart =
  | { kind: "prose"; text: string }
  | { kind: "code"; d: Opened; muted: boolean };

// The canvas and Guide navigator share authored order, whole-file embeds and unlisted changes.
export function viewSections(view: View, diffs: Extract<Opened, { kind: "diff" }>[]) {
  const byPath = new Map(diffs.map((d) => [d.file.path, d]));
  // Muted (glossary): a section of only muted embeds is low-lighted whole; its heading says why.
  const section = (title: string | null, parts: SectionPart[], allMuted: boolean) => {
    const files = parts.flatMap((p) => (p.kind === "code" ? [p.d] : []));
    return { title, parts, muted: allMuted, files };
  };
  const listed = new Set<string>();
  const all = view.sections.map((x) => {
    const parts = x.parts.flatMap((p): SectionPart[] => {
      if (p.kind === "prose") return [p];
      const d: Opened | undefined =
        p.kind === "file" ? { kind: "file", path: p.path } : byPath.get(p.path);
      if (!d) return [];
      if (p.kind === "diff") listed.add(p.path);
      return [{ kind: "code", d, muted: p.muted }];
    });
    const embeds = parts.filter((p) => p.kind === "code");
    return section(x.title, parts, embeds.length > 0 && embeds.every((p) => p.muted));
  });
  const rest = diffs.filter((d) => !listed.has(d.file.path));
  if (view.guide && rest.length)
    all.push(
      section(
        null,
        rest.map((d) => ({ kind: "code", d, muted: false })),
        false,
      ),
    );
  return all;
}
