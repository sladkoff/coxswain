import type { McpTool } from "./agents";
import type { Db } from "./db";
import { type ChangedFile, listChangedFiles, openedBefore, openWorktree, readTexts } from "./git";

// ADR 0023, 0026: a view (glossary) is made by the agent pane's session with the tools below. It's pinned to base →
// head, the merge base → the PR head when it was started, and holds sections of markdown; its explanations and findings
// are entries with its id. A guide is a view that goes through every changed file. Every view is kept.

// A section as the canvas shows it: its heading, then prose (markdown, with mermaid fences drawn as diagrams) and the
// file diffs its diff fences embed. generated: the file is made by a tool, not written by hand; it's low-lighted.
export type ViewPart =
  | { kind: "prose"; text: string }
  | { kind: "diff"; path: string; generated: boolean };
export type ViewSection = { title: string; parts: ViewPart[] };
export type View = {
  id: number;
  workspaceId: number;
  title: string;
  guide: boolean;
  base: string;
  head: string;
  sections: ViewSection[];
  createdAt: string;
};

// A diff fence: ```diff path=src/a.ts (or path="a b.ts"), optionally with the flag generated, closed by ```. A diff
// fence without path= is an ordinary code block.
const diffFence = /^ {0,3}```diff\s+(?=.*\bpath=)(.*)$/;
const fenceEnd = /^ {0,3}```\s*$/;
const pathAttr = /\bpath=(?:"([^"]*)"|(\S+))/;

// A section's markdown as parts. Its first line is its heading (checked by write_section).
export function parseSection(markdown: string): ViewSection {
  const [first, ...lines] = markdown.trim().split("\n");
  const parts: ViewPart[] = [];
  let prose: string[] = [];
  const flush = () => {
    const text = prose.join("\n").trim();
    if (text) parts.push({ kind: "prose", text });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const fence = diffFence.exec(lines[i]);
    const path = fence && pathAttr.exec(fence[1]);
    if (!fence || !path) {
      prose.push(lines[i]);
      continue;
    }
    flush();
    parts.push({
      kind: "diff",
      path: path[1] ?? path[2],
      generated: /\bgenerated\b/.test(fence[1].replace(pathAttr, "")),
    });
    while (i + 1 < lines.length && !fenceEnd.test(lines[i + 1])) i++;
    i++;
  }
  flush();
  return { title: first.replace(/^#+\s*/, ""), parts };
}

const embedded = (sections: ViewSection[]) =>
  sections.flatMap((s) => s.parts.flatMap((p) => (p.kind === "diff" ? [p.path] : [])));

const columns = [
  "id",
  "workspace_id as workspaceId",
  "title",
  "guide",
  "base",
  "head",
  "sections",
  "created_at as createdAt",
] as const;
type Row = { guide: number; sections: string };
const markdownOf = (r: Row): string[] => JSON.parse(r.sections);
const fromRow = <R extends Row>(
  r: R,
): Omit<R, "guide" | "sections"> & Pick<View, "guide" | "sections"> => ({
  ...r,
  guide: !!r.guide,
  sections: markdownOf(r).map(parseSection),
});

// The workspace's views, newest first.
export async function listViews(db: Db, workspaceId: number): Promise<View[]> {
  const rows = await db
    .selectFrom("views")
    .select(columns)
    .where("workspace_id", "=", workspaceId)
    .orderBy("id", "desc")
    .execute();
  return rows.map(fromRow);
}

// Told when a tool changed a workspace's view or its entries, so the UI refetches them while the agent works.
const listeners = new Set<(workspaceId: number) => void>();
export function onViewChange(listener: (workspaceId: number) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
const tell = (workspaceId: number) => listeners.forEach((l) => l(workspaceId));

// The messages the New View menu puts in the agent pane's composer. How to make a view is in start_view's result, so
// one asked for in the agent's own words is made the same way.
export const viewRequests = {
  guide: "Make a guide to this PR's changes with coxswain's tools.",
  review:
    "Make a guide to this PR's changes with coxswain's tools, and review them: add findings where you see bugs, risks or better ways.",
  "data model":
    "Make a view with coxswain's tools of the data model this PR changes: the types, tables or schemas, how they relate, and what changed, as a diagram with the key file diffs.",
  "data flow":
    "Make a view with coxswain's tools of how data flows through the code this PR changes, from where it enters to where it's stored or shown, as a diagram with the key file diffs.",
  custom: "Make a view with coxswain's tools of ",
};

const howToView = `How to write the view: add its sections in reading order with write_section. Each section is markdown
(GitHub-flavoured: tables, lists, code) and starts with a "## " heading, which lists it in the view's table of contents.
Two kinds of fenced blocks do more than show code:
- A diagram: a \`\`\`mermaid block (flowchart, sequenceDiagram, erDiagram, classDiagram, stateDiagram-v2). Use erDiagram
  or classDiagram for data models, flowchart or sequenceDiagram for data flow. Keep diagrams small enough to read in a
  column; split a big one.
- A file diff: \`\`\`diff path=<a changed file, as listed above>, closed by \`\`\` right after, embeds that file's diff as the
  user reviews it, where they can comment. Add the word generated after the path for a file made by a tool rather than
  written by hand (lockfiles, generated clients or models, snapshots, build output); it's low-lighted. Each file can be
  embedded once in a view. A \`\`\`diff block without path= is an ordinary code block.
Write a sentence or two before an embedded file diff saying what to look at in it.`;

const howToGuide = `How to make the guide:
- Read the diffs, and the code around them where it helps.
- Sort the changed files into sections, each about one theme (a feature, a refactor, tests, configuration, ...), in
  the order a reviewer should read them: the core change first, supporting changes after, files made by a tool last.
  Give each section a short heading, one to three sentences saying what the reviewer is looking at and what to check,
  and then, for each of its files, one sentence on what to look at in it followed by its diff fence. Embed every
  changed file in exactly one section; any left out show after the guide, under "Not in the guide". Add a diagram
  where it shows how pieces connect better than words.
- Where lines need explaining (a subtle condition, why something moved, how pieces connect), add an explanation on
  them with add_explanation. Explain; don't judge. A few good ones beat many obvious ones.
- Only if the user asked for a review: add findings with add_finding on lines where you see a bug, a risk, a missing
  case or a better way. Otherwise add none.
- When you're done, say in a few lines what the PR does and how the guide is laid out. The guide shows in the app as
  you add to it; don't repeat it in the chat.`;

const howToOther = `This view shows only what you put in it: embed just the file diffs that matter to what it's about,
and explain the rest with prose, tables and diagrams. When you're done, say in a line or two what it shows; it shows in
the app as you add to it, so don't repeat it in the chat.`;

// The files of a view's range, to check the tools' paths against.
async function changedFiles(
  db: Db,
  v: Pick<View, "workspaceId" | "base" | "head">,
): Promise<ChangedFile[]> {
  const listed = await listChangedFiles(db, v.workspaceId, v.base, v.head);
  if (listed.status !== "ok") throw new Error(listed.message);
  return listed.files;
}

async function latestView(db: Db, workspaceId: number) {
  const row = await db
    .selectFrom("views")
    .select(columns)
    .where("workspace_id", "=", workspaceId)
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) throw new Error("No view yet: call start_view first");
  return { ...fromRow(row), markdown: markdownOf(row) };
}

const anchorSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "The file, as listed by start_view" },
    side: {
      enum: ["new", "old"],
      description: '"new": lines of the file at the head; "old": removed lines, at the base',
    },
    start_line: { type: "integer" },
    end_line: { type: "integer" },
    body: { type: "string", description: "Markdown" },
  },
  required: ["path", "side", "start_line", "end_line", "body"],
};
type AnchorArgs = {
  path: string;
  side: "new" | "old";
  start_line: number;
  end_line: number;
  body: string;
};

// An explanation or finding on lines of the latest view's range, with the code it's on (ADR 0015).
async function addOnLines(
  db: Db,
  workspaceId: number,
  kind: "explanation" | "finding",
  a: AnchorArgs,
): Promise<string> {
  const view = await latestView(db, workspaceId);
  const file = (await changedFiles(db, view)).find((f) => f.path === a.path);
  if (!file) throw new Error(`${a.path} isn't changed in the view's range`);
  const [start, end] = [a.start_line, a.end_line].sort((x, y) => x - y);
  const commit = a.side === "old" ? view.base : view.head;
  const readPath = a.side === "old" ? (file.previousPath ?? a.path) : a.path;
  const text = (await readTexts(db, workspaceId, [readPath], commit)).get(readPath);
  if (text == null) throw new Error(`${a.path} has no ${a.side} side`);
  const lines = text.split("\n");
  if (start < 1 || end > lines.length)
    throw new Error(`${a.path} has ${lines.length} lines on the ${a.side} side`);
  if (!a.body.trim()) throw new Error("body is empty");
  await db
    .insertInto("entries")
    .values({
      workspace_id: workspaceId,
      kind,
      body: a.body.trim(),
      parent_id: null,
      view_id: view.id,
      path: a.path,
      side: a.side,
      start_line: start,
      end_line: end,
      code: lines.slice(start - 1, end).join("\n"),
      base: view.base,
      head: view.head,
      created_at: new Date().toISOString(),
    })
    .execute();
  tell(workspaceId);
  const shown = embedded(view.sections).includes(a.path)
    ? ""
    : view.guide
      ? ` ${a.path} isn't in a section yet; it shows under "Not in the guide" until it is.`
      : ` ${a.path} isn't embedded in the view, so it won't show until a section embeds it.`;
  return `Added the ${kind} on ${a.path}:${start}${end > start ? `-${end}` : ""}.${shown}`;
}

// The agent pane's tools for a workspace (ADR 0023, 0026).
export function viewTools(db: Db, workspaceId: number): McpTool[] {
  return [
    {
      name: "start_view",
      description:
        "Start a new view of the PR's changes in coxswain, the app the user reads them in: sections of markdown, with diagrams and embedded file diffs the user can comment on. A guide is a view that walks through every changed file in reading order; other views show one aspect (the data model, a data flow, whatever the user asked for). Returns the range the view is pinned to, the changed files and how to write the view.",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: 'A name of one to three words, e.g. "Guide", "Data model"',
          },
          guide: {
            type: "boolean",
            description: "It walks through every changed file (a guide or a review)",
          },
        },
        required: ["title", "guide"],
      },
      call: async (v: { title: string; guide: boolean }) => {
        const at = (await openedBefore(db, workspaceId)) ?? (await openWorktree(db, workspaceId));
        if (at.status !== "ok")
          throw new Error("message" in at ? at.message : `GitHub: ${at.status}`);
        const files = await changedFiles(db, { workspaceId, base: at.mergeBase, head: at.head });
        if (!files.length) throw new Error("The PR has no changes to show");
        if (!v.title.trim()) throw new Error("title is empty");
        const { id } = await db
          .insertInto("views")
          .values({
            workspace_id: workspaceId,
            title: v.title.trim(),
            guide: v.guide ? 1 : 0,
            base: at.mergeBase,
            head: at.head,
            created_at: new Date().toISOString(),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        tell(workspaceId);
        const listed = files.map(
          (f) =>
            `${f.status} +${f.additions} -${f.deletions} ${f.previousPath ? `${f.previousPath} -> ` : ""}${f.path}`,
        );
        return [
          `View ${id} started. It's pinned to ${at.mergeBase} (the merge base) → ${at.head} (the PR head); local changes aren't in it.`,
          `Read a diff with \`git diff ${at.mergeBase} ${at.head} -- <path>\`. Line numbers are the file's at the head (side "new") or, for removed lines, at the base (side "old").`,
          `Changed files (status, lines added and removed, path):\n${listed.join("\n")}`,
          howToView,
          v.guide ? howToGuide : howToOther,
        ].join("\n\n");
      },
    },
    {
      name: "write_section",
      description:
        "Add a section to the latest view, after the ones so far, or with number replace section number N (1 is the first). Call start_view first.",
      inputSchema: {
        type: "object",
        properties: {
          markdown: {
            type: "string",
            description: 'Starts with a "## " heading; may hold mermaid and diff fences',
          },
          number: { type: "integer", description: "The section to replace; leave out to add one" },
        },
        required: ["markdown"],
      },
      call: async (a: { markdown: string; number?: number }) => {
        const view = await latestView(db, workspaceId);
        const markdown = a.markdown.trim();
        if (!/^## \S/.test(markdown)) throw new Error('A section starts with a "## " heading');
        const at = a.number === undefined ? view.markdown.length : a.number - 1;
        if (at < 0 || at > view.markdown.length - (a.number === undefined ? 0 : 1))
          throw new Error(`The view has ${view.markdown.length} sections`);
        const changed = (await changedFiles(db, view)).map((f) => f.path);
        const others = embedded(view.sections.filter((_, i) => i !== at));
        const mine = embedded([parseSection(markdown)]);
        for (const [i, p] of mine.entries()) {
          if (!changed.includes(p)) throw new Error(`${p} isn't changed in the view's range`);
          if (others.includes(p) || mine.indexOf(p) !== i)
            throw new Error(`${p} is already embedded in the view`);
        }
        const sections = view.markdown.toSpliced(at, a.number === undefined ? 0 : 1, markdown);
        await db
          .updateTable("views")
          .set({ sections: JSON.stringify(sections) })
          .where("id", "=", view.id)
          .execute();
        tell(workspaceId);
        const done = `Section ${at + 1} ${a.number === undefined ? "added" : "replaced"}.`;
        if (!view.guide) return done;
        const all = new Set([...others, ...mine]);
        const left = changed.filter((p) => !all.has(p));
        return left.length
          ? `${done} ${left.length} files in no section yet: ${left.join(", ")}`
          : `${done} Every changed file is in a section.`;
      },
    },
    {
      name: "add_explanation",
      description:
        "Explain lines of a changed file in the view: what they do and why, to help the user read them. Call start_view first.",
      inputSchema: anchorSchema,
      call: (a: AnchorArgs) => addOnLines(db, workspaceId, "explanation", a),
    },
    {
      name: "add_finding",
      description:
        "Add a review finding on lines of a changed file in the view: a bug, risk, missing case or better way. Only when the user asked for a review. Call start_view first.",
      inputSchema: anchorSchema,
      call: (a: AnchorArgs) => addOnLines(db, workspaceId, "finding", a),
    },
  ];
}
