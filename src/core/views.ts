import type { McpTool } from "./agents";
import type { Db } from "./db";
import {
  type ChangedFile,
  listChangedFiles,
  listFilesAt,
  openedBefore,
  openWorktree,
  readTexts,
  resolveCommit,
  snapshot,
} from "./git.ts";
import { fileSummaries, summarise } from "./summaries.ts";

// ADR 0023, 0026: a view (glossary) is made by the agent pane's session with the tools below. It's pinned to base →
// head, the merge base → a snapshot of the worktree when it was started (ADR 0028), and holds sections of markdown; its explanations and findings
// are entries with its id. A guide is a view that goes through every changed file. Views are kept until the user
// removes one.

// A section as the canvas shows it: its heading, then prose (markdown, with mermaid fences drawn as diagrams) and the
// source files and file diffs its fences embed. muted (glossary): the reader can pass over it (made by a tool, tests, a
// mechanical change, or what the user said doesn't matter); it's low-lighted.
export type ViewPart =
  | { kind: "prose"; text: string }
  | { kind: "diff" | "file"; path: string; muted: boolean };
export type ViewSection = { title: string; parts: ViewPart[] };
// worktree: its head was a snapshot of the worktree, so it's stale once the worktree moves on; a view of a commit, a
// turn or what's on GitHub never is. writing: being written (glossary), a turn that changed it still runs.
export type View = {
  id: number;
  workspaceId: number;
  title: string;
  guide: boolean;
  worktree: boolean;
  base: string;
  head: string;
  sections: ViewSection[];
  createdAt: string;
  writing: boolean;
};

// A source or diff fence: ```file path=src/a.ts or ```diff path="a b.ts", optionally muted (or generated, the word it
// had first, which still means the same), closed by ```.
// A fence without path= is an ordinary code block.
const codeFence = /^ {0,3}```(diff|file)\s+(?=.*\bpath=)(.*)$/;
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
    const fence = codeFence.exec(lines[i]);
    const path = fence && pathAttr.exec(fence[2]);
    if (!fence || !path) {
      prose.push(lines[i]);
      continue;
    }
    flush();
    parts.push({
      kind: fence[1] as "diff" | "file",
      path: path[1] ?? path[2],
      muted: /\b(muted|generated)\b/.test(fence[2].replace(pathAttr, "")),
    });
    while (i + 1 < lines.length && !fenceEnd.test(lines[i + 1])) i++;
    i++;
  }
  flush();
  return { title: first.replace(/^#+\s*/, ""), parts };
}

// The code of a section's mermaid diagrams.
const diagrams = (markdown: string) =>
  [...markdown.matchAll(/^ {0,3}```mermaid[^\n]*\n([\s\S]*?)\n {0,3}```[ \t]*$/gm)].map(
    (m) => m[1],
  );

// How the tools check that diagrams draw, given each one's error or null (ADR 0026). Set by the main process, which
// draws them in the window; unset, they aren't checked.
let checkDiagrams = async (codes: string[]): Promise<(string | null)[]> => codes.map(() => null);
export const setDiagramCheck = (check: typeof checkDiagrams) => void (checkDiagrams = check);

const embedded = (sections: ViewSection[]) =>
  sections.flatMap((s) => s.parts.flatMap((p) => (p.kind !== "prose" ? [p] : [])));

const columns = [
  "id",
  "workspace_id as workspaceId",
  "title",
  "guide",
  "worktree",
  "base",
  "head",
  "sections",
  "created_at as createdAt",
] as const;
type Row = { id: number; guide: number; worktree: number; sections: string };
const markdownOf = (r: Row): string[] => JSON.parse(r.sections);
const fromRow = <R extends Row>(
  r: R,
): Omit<R, "guide" | "worktree" | "sections"> &
  Pick<View, "guide" | "worktree" | "sections" | "writing"> => ({
  ...r,
  guide: !!r.guide,
  worktree: !!r.worktree,
  sections: markdownOf(r).map(parseSection),
  writing: writing.has(r.id),
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

// Removes a view, with its explanations and findings (entries.view_id cascades).
export async function removeView(db: Db, viewId: number): Promise<void> {
  await db.deleteFrom("views").where("id", "=", viewId).execute();
  writing.delete(viewId);
}

// Told when a tool changed a workspace's view or its entries, so the UI refetches them while the agent works.
const listeners = new Set<(workspaceId: number) => void>();
export function onViewChange(listener: (workspaceId: number) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
const tell = (workspaceId: number) => listeners.forEach((l) => l(workspaceId));

// Being written (glossary): the views a tool changed in the turn still running, each with its workspace. Only in memory:
// the turn is gone after a restart too. There's no step for the agent to finish a view; it could forget it, or be stopped.
// ponytail: the tools don't know which session calls them, so any turn of the workspace ending finishes them all; key
// them by session if two turns at once in one workspace become common.
const writing = new Map<number, number>();
const beingWritten = (workspaceId: number, viewId: number) => {
  writing.set(viewId, workspaceId);
  tell(workspaceId);
};
// A turn of the workspace ended (done, stopped or failed): its views are written.
export function turnEnded(workspaceId: number) {
  let any = false;
  for (const [viewId, w] of writing) if (w === workspaceId) any = writing.delete(viewId);
  if (any) tell(workspaceId);
}

// The messages the New View menu puts in the agent pane's composer. How to make a view is in start_view's result, so
// one asked for in the agent's own words is made the same way.
export const viewRequests = {
  guide: "Make a guide to this workspace's changes with coxswain's tools.",
  review:
    "Make a guide to this workspace's changes with coxswain's tools, and review them: add findings where you see bugs, risks or better ways.",
  "data model":
    "Make a view with coxswain's tools of the data model this workspace contains: the types, tables or schemas, how they relate, and what changed, as a diagram with the key source files and any relevant diffs.",
  "data flow":
    "Make a view with coxswain's tools of how data flows through the code this workspace contains, from where it enters to where it's stored or shown, as a diagram with the key source files and any relevant diffs.",
  custom: "Make a view with coxswain's tools of ",
};
export type ViewRequest = keyof typeof viewRequests;

// What the canvas shows when a view is asked for, if not all of the workspace's changes: a commit, an agent turn, or a
// scope (ADR 0028). head null: the worktree as it is when the view starts.
export type ViewRange = { what: string; base: string; head: string | null };

// The message for the agent pane's composer: the request, after the range it's for, which start_view is told to take.
export const viewRequest = (kind: ViewRequest, range: ViewRange | null) =>
  range
    ? `For ${range.what} only (start_view with base "${range.base}" and head "${range.head ?? "worktree"}"): ${viewRequests[kind]}`
    : viewRequests[kind];

const howToView = `How to write the view: add its sections in reading order with write_section. Each section is markdown
(GitHub-flavoured: tables, lists, code) and starts with a "## " heading, which lists it in the view's table of contents.
Three kinds of fenced blocks do more than show code:
- A diagram: a \`\`\`mermaid block (flowchart, sequenceDiagram, erDiagram, classDiagram, stateDiagram-v2). Use erDiagram
  or classDiagram for data models, flowchart or sequenceDiagram for data flow. Keep diagrams small enough to read in a
  column; split a big one. write_section draws each diagram before saving the section, and refuses it with mermaid's
  error if one doesn't draw.
- A file diff: \`\`\`diff path=<a changed file, as listed above>, closed by \`\`\` right after, embeds that file's diff as the
  user reviews it, where they can comment. Add the word muted after the path for a file the reader can pass over: made
  by a tool (lockfiles, generated clients or models, snapshots, build output), or one the user said doesn't matter to
  them; it's low-lighted, and so is a section of only muted files. Each file can be embedded once in a view. A \`\`\`diff block without path= is an ordinary code block.
- A whole source file: \`\`\`file path=<repository-relative path>, closed by \`\`\` right after, embeds its contents at
  the view's snapshot, even if it has no changes. Quote paths containing spaces. It supports line comments,
  explanations and its own Reviewed mark, separate from the file's diff. Use this to trace existing code.
Each path can be embedded once, as either a file or a diff. Views can contain only prose and diagrams and need no diff.
Write a sentence or two before an embedded file or diff saying what to look at in it.`;

const howToGuide = `How to make the guide:
- Work from the file summaries above: plan the sections and write each file's sentence from its summary. Read a diff
  only where the summary doesn't do: a file without one or with an unclear one, the few files at the heart of the
  change, and lines you explain or (in a review) judge. Every diff read makes each later step slower, so don't read
  them all.
- Sort the changed files into sections, each about one theme (a feature, a refactor, tests, configuration, ...), in
  the order a reviewer should read them: the core change first, supporting changes after, muted ones last. Give each
  section a short heading, one to three sentences saying what the reviewer is looking at and what to check, and then,
  for each of its files, one sentence on what to look at in it followed by its diff fence. Add a diagram where it shows
  how pieces connect better than words.
- Embed every changed file in exactly one section; never leave one out. Files made by a tool, and those the user says
  they don't care about (tests, mechanical fixes, whatever they name), go in sections of their own at the end with
  every fence muted: a heading that says what they are and one line for the section, no sentence per file.
- Where lines need explaining (a subtle condition, why something moved, how pieces connect), add an explanation on
  them with add_explanation. Explain; don't judge. A few good ones beat many obvious ones.
- Only if the user asked for a review: add findings with add_finding on lines where you see a bug, a risk, a missing
  case or a better way. Otherwise add none.
- Write the sections in a few calls, not one each: give write_section several at once in sections, and
  add_explanation several in explanations (add_finding: findings).
- When you're done, say in a few lines what the changes do and how the guide is laid out. The guide shows in the app as
  you add to it; don't repeat it in the chat.`;

const howToOther = `This view shows only what you put in it: embed just the source files or file diffs that matter to what it's about,
and explain the rest with prose, tables and diagrams. Don't embed files only to mute them; mute an embed only when it's
there for context rather than the point, e.g. a generated type the data passes through. When you're done, say in a line or two what it shows; it shows in
the app as you add to it, so don't repeat it in the chat.`;

// The files of a view's range, to check the tools' paths against, and those at its head. Both are of commits, which
// never change, so each is read once: every write_section asks, and a big range takes seconds to list.
// ponytail: kept for every range asked about while the app runs; an LRU if that grows.
const changedOf = new Map<string, Promise<ChangedFile[]>>();
const filesOf = new Map<string, Promise<string[]>>();
function once<T>(cache: Map<string, Promise<T>>, key: string, read: () => Promise<T>) {
  let p = cache.get(key);
  if (!p) {
    p = read();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}
function changedFiles(
  db: Db,
  v: Pick<View, "workspaceId" | "base" | "head">,
): Promise<ChangedFile[]> {
  return once(changedOf, `${v.workspaceId} ${v.base} ${v.head}`, async () => {
    const listed = await listChangedFiles(db, v.workspaceId, v.base, v.head);
    if (listed.status !== "ok") throw new Error(listed.message);
    return listed.files;
  });
}
const filesAt = (db: Db, workspaceId: number, head: string) =>
  once(filesOf, `${workspaceId} ${head}`, () => listFilesAt(db, workspaceId, head));

// write_section and remove_section change a view one at a time, each on the view as the one before left it: two
// sessions or subagents writing at once would otherwise both start from the same sections, and the last write would win.
const changing = new Map<number, Promise<unknown>>();
async function changeView<T>(
  db: Db,
  workspaceId: number,
  id: number | undefined,
  change: (view: Awaited<ReturnType<typeof toolView>>) => Promise<T>,
): Promise<T> {
  const viewId = (await toolView(db, workspaceId, id)).id;
  const next = (changing.get(viewId) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => change(await toolView(db, workspaceId, viewId)));
  changing.set(viewId, next);
  beingWritten(workspaceId, viewId);
  try {
    return await next;
  } finally {
    if (changing.get(viewId) === next) changing.delete(viewId);
  }
}

// The files' summaries (ADR 0029) as lines for the agent: each file's, or why there's none.
async function summaryLines(
  db: Db,
  workspaceId: number,
  view: Pick<View, "base" | "head">,
  files: ChangedFile[],
  wait = 0,
): Promise<Map<string, string>> {
  const summaries = await fileSummaries(
    db,
    workspaceId,
    view.base,
    view.head,
    files.map((f) => f.path),
    wait,
  );
  return new Map(
    summaries.map((s) => [
      s.path,
      s.summary ??
        (s.state === "pending" ? "(summary being written)" : "(no summary: read its diff)"),
    ]),
  );
}
// Tool results stay under listChars characters of file list, about 6k tokens: Codex cuts a result of more than about
// 10k tokens in the middle, losing files without saying which. A longer list is paged: file_summaries with from.
export const viewLimits = { listChars: 20_000 };
const letter = { added: "A", modified: "M", deleted: "D", renamed: "R" } as const;

// The files from index from on, with their summary lines, grouped under their folders (a long path is written once),
// as many as fit. next: where the rest start, or null.
function listFiles(
  files: ChangedFile[],
  lines: Map<string, string>,
  from = 0,
): { text: string; next: number | null } {
  let text = "";
  let folder: string | null = null;
  let i = from;
  for (; i < files.length; i++) {
    const f = files[i];
    const dir = f.path.slice(0, f.path.lastIndexOf("/") + 1);
    const line = `  ${letter[f.status]} +${f.additions} -${f.deletions} ${f.path.slice(dir.length)}${f.previousPath ? ` (from ${f.previousPath})` : ""}: ${lines.get(f.path)}\n`;
    const chunk = (dir !== folder ? `${dir || "./"}\n` : "") + line;
    if (text && text.length + chunk.length > viewLimits.listChars) break;
    text += chunk;
    folder = dir;
  }
  return { text: text.trimEnd(), next: i < files.length ? i : null };
}
const listHeader = (files: ChangedFile[], from: number, next: number | null) =>
  `Changed files ${from + 1}–${next ?? files.length} of ${files.length}, by folder (a file's path is its folder and its name; A added, M modified, D deleted, R renamed; lines added and removed; then its file summary):`;
const listRest = (files: ChangedFile[], next: number | null) =>
  next === null
    ? ""
    : `\n… ${files.length - next} more files: call file_summaries with from: ${next} for the next ones.`;

const aboutSummaries =
  "File summaries are written ahead by a small model from each diff alone: plan from them and pick which few diffs to read. Call file_summaries only for those still being written; the rest are above.";

// The view a tool writes to: the one with the id given, or the workspace's latest.
async function toolView(db: Db, workspaceId: number, id: number | undefined) {
  let q = db.selectFrom("views").select(columns).where("workspace_id", "=", workspaceId);
  q = id === undefined ? q.orderBy("id", "desc").limit(1) : q.where("id", "=", id);
  const row = await q.executeTakeFirst();
  if (!row)
    throw new Error(
      id === undefined ? "No view yet: call start_view first" : `No view ${id}: see list_views`,
    );
  return { ...fromRow(row), markdown: markdownOf(row) };
}

const viewArg = {
  view: {
    type: "integer",
    description: "The view's id, from start_view or list_views; leave out for the latest",
  },
};

const anchorProperties = {
  path: {
    type: "string",
    description: "A changed file, or any file at the view snapshot (side new)",
  },
  side: {
    enum: ["new", "old"],
    description: '"new": lines of the file at the head; "old": removed lines, at the base',
  },
  start_line: { type: "integer" },
  end_line: { type: "integer" },
  body: { type: "string", description: "Markdown" },
};
const anchorFields = ["path", "side", "start_line", "end_line", "body"] as const;
// One explanation or finding in its fields, or several in a list (plural): one call for many.
const anchorSchema = (plural: string) => ({
  type: "object",
  properties: {
    ...anchorProperties,
    [plural]: {
      type: "array",
      description: "Several, in place of the fields above",
      items: { type: "object", properties: anchorProperties, required: [...anchorFields] },
    },
    ...viewArg,
  },
});
type AnchorArgs = {
  path: string;
  side: "new" | "old";
  start_line: number;
  end_line: number;
  body: string;
  view?: number;
};

// Each one given, or the one in a's fields; one that doesn't fit is reported and the rest still added.
async function addAll(
  db: Db,
  workspaceId: number,
  kind: "explanation" | "finding",
  a: Partial<AnchorArgs>,
  many: AnchorArgs[] | undefined,
): Promise<string> {
  if (!many) {
    const missing = anchorFields.filter((f) => a[f] === undefined);
    if (missing.length) throw new Error(`${missing.join(", ")} missing, or give a list`);
    return addOnLines(db, workspaceId, kind, a as AnchorArgs);
  }
  const results = await Promise.all(
    many.map((one, i) =>
      addOnLines(db, workspaceId, kind, { ...one, view: one.view ?? a.view }).then(
        (ok) => `${i + 1}. ${ok}`,
        (e: Error) => `${i + 1}. Not added: ${e.message}`,
      ),
    ),
  );
  if (results.every((r) => /^\d+\. Not added/.test(r))) throw new Error(results.join("\n"));
  return results.join("\n");
}

// An explanation or finding on lines of a view's range, with the code it's on (ADR 0015).
async function addOnLines(
  db: Db,
  workspaceId: number,
  kind: "explanation" | "finding",
  a: AnchorArgs,
): Promise<string> {
  const view = await toolView(db, workspaceId, a.view);
  const file = (await changedFiles(db, view)).find((f) => f.path === a.path);
  if (!file && (a.side === "old" || !(await filesAt(db, workspaceId, view.head)).includes(a.path)))
    throw new Error(`${a.path} isn't a file on that side of the view`);
  const [start, end] = [a.start_line, a.end_line].sort((x, y) => x - y);
  const commit = a.side === "old" ? view.base : view.head;
  const readPath = a.side === "old" ? (file?.previousPath ?? a.path) : a.path;
  const text = (await readTexts(db, workspaceId, [readPath], commit)).get(readPath);
  if (text == null) throw new Error(`${a.path} has no ${a.side} side`);
  const lines = text.split("\n");
  if (start < 1 || end > lines.length)
    throw new Error(`${a.path} has ${lines.length} lines on the ${a.side} side`);
  if (!a.body.trim()) throw new Error("body is empty");
  beingWritten(workspaceId, view.id);
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
  const shown = embedded(view.sections).some((p) => p.path === a.path)
    ? ""
    : view.guide && file
      ? ` ${a.path} isn't in a section yet; it shows under "Not in the guide" until it is.`
      : ` ${a.path} isn't embedded in the view, so it won't show until a section embeds it.`;
  return `Added the ${kind} on ${a.path}:${start}${end > start ? `-${end}` : ""} in view ${view.id}.${shown}`;
}

// What each tool does to what (ADR 0029): they only read or write coxswain's own views and entries, never the
// worktree or anything outside. Removing a section loses what it held, so it's the one that says so.
const readTool = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const closedTool = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const destructiveTool = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

// The agent pane's tools for a workspace (ADR 0023, 0026).
export function viewTools(db: Db, workspaceId: number): McpTool[] {
  return [
    {
      name: "start_view",
      annotations: closedTool,
      description:
        "Start a new view of code or changes in coxswain, the app the user reads them in: sections of markdown, with diagrams, source files and file diffs the user can comment on. No diff is required. A guide is a view that walks through every changed file in reading order; other views show one aspect (the data model, a data flow, whatever the user asked for). Call it first, before looking at the changes: it works out the range itself, all of the workspace's changes from the merge base (the one GitHub uses for the PR, right after merges from the base branch too) to the worktree, and lists the changed files, so don't work one out with git. Give base and head only when the user asks about one commit, an agent turn or a part of the changes. Returns the range the view is pinned to, the changed files and how to write the view.",
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
          base: {
            type: "string",
            description:
              "The commit the view's changes start from (a hash, HEAD, a branch or tag, e.g. a commit's parent); leave out for the merge base",
          },
          head: {
            type: "string",
            description:
              'The commit they end at (a hash, HEAD, a branch or tag), or "worktree" for the worktree as it is now, uncommitted changes included (the default)',
          },
        },
        required: ["title", "guide"],
      },
      call: async (v: { title: string; guide: boolean; base?: string; head?: string }) => {
        const at = (await openedBefore(db, workspaceId)) ?? (await openWorktree(db, workspaceId));
        if (at.status !== "ok")
          throw new Error("message" in at ? at.message : `GitHub: ${at.status}`);
        const base = v.base ? await resolveCommit(db, workspaceId, v.base) : at.mergeBase;
        // ADR 0028: pinned to the worktree as it is, local changes and all, unless a commit is given.
        const ofWorktree = !v.head || v.head === "worktree";
        let head: string;
        if (ofWorktree) {
          const now = await snapshot(db, workspaceId);
          if (now.status !== "ok") throw new Error(now.message);
          head = now.sha;
        } else head = await resolveCommit(db, workspaceId, v.head!);
        const files = await changedFiles(db, { workspaceId, base, head });
        if (!v.title.trim()) throw new Error("title is empty");
        const { id } = await db
          .insertInto("views")
          .values({
            workspace_id: workspaceId,
            title: v.title.trim(),
            guide: v.guide ? 1 : 0,
            worktree: ofWorktree ? 1 : 0,
            base,
            head,
            created_at: new Date().toISOString(),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        beingWritten(workspaceId, id);
        // ADR 0029: what has no summary yet starts being summarised now; what's ready is listed with each file.
        await summarise(db, workspaceId, base, head, "view");
        const summaries = await summaryLines(db, workspaceId, { base, head }, files);
        const listed = listFiles(files, summaries);
        return [
          `View ${id} started; the other tools write to it when given view: ${id}, or to the latest view without it. It's pinned to ${base}${base === at.mergeBase ? " (the merge base)" : ""} → ${head}${ofWorktree ? " (the worktree as it is now, uncommitted changes included, as a commit)" : ""}.`,
          `Read a diff with \`git diff ${base} ${head} -- <path>\`. Line numbers are the file's at the head (side "new") or, for removed lines, at the base (side "old").`,
          `Read a source file with \`git show ${head}:<path>\`; list available files with \`git ls-tree -r --name-only ${head}\`. Source-file line annotations use side "new".`,
          ...(files.length ? [aboutSummaries] : []),
          howToView,
          v.guide ? howToGuide : howToOther,
          files.length
            ? `${listHeader(files, 0, listed.next)}\n${listed.text}${listRest(files, listed.next)}`
            : "Changed files: none. You can still explain existing code with source files, prose and diagrams.",
        ].join("\n\n");
      },
    },
    {
      name: "write_section",
      annotations: closedTool,
      description:
        "Add a section to a view (the latest unless view is given), after the ones so far, or with number replace section number N (1 is the first). To write several, give sections instead: they're put in order in one call. Call start_view first.",
      inputSchema: {
        type: "object",
        properties: {
          markdown: {
            type: "string",
            description: 'Starts with a "## " heading; may hold mermaid, file and diff fences',
          },
          number: { type: "integer", description: "The section to replace; leave out to add one" },
          sections: {
            type: "array",
            description: "Several sections, in order, in place of markdown and number",
            items: {
              type: "object",
              properties: {
                markdown: { type: "string" },
                number: { type: "integer", description: "The section to replace" },
              },
              required: ["markdown"],
            },
          },
          ...viewArg,
        },
      },
      call: (a: {
        markdown?: string;
        number?: number;
        sections?: { markdown: string; number?: number }[];
        view?: number;
      }) =>
        changeView(db, workspaceId, a.view, async (view) => {
          const items =
            a.sections ??
            (a.markdown !== undefined ? [{ markdown: a.markdown, number: a.number }] : []);
          if (!items.length) throw new Error("Give markdown, or sections");
          const changed = (await changedFiles(db, view)).map((f) => f.path);
          let sections = view.markdown;
          const done: string[] = [];
          // One section on the sections so far: checked, then put in.
          const put = async (item: { markdown: string; number?: number }) => {
            const markdown = item.markdown.trim();
            if (!/^## \S/.test(markdown)) throw new Error('A section starts with a "## " heading');
            const at = item.number === undefined ? sections.length : item.number - 1;
            if (at < 0 || at > sections.length - (item.number === undefined ? 0 : 1))
              throw new Error(`The view has ${sections.length} sections`);
            const others = embedded(sections.filter((_, i) => i !== at).map(parseSection));
            const mine = embedded([parseSection(markdown)]);
            const files = mine.some((p) => p.kind === "file")
              ? await filesAt(db, workspaceId, view.head)
              : [];
            for (const [i, p] of mine.entries()) {
              if (!(p.kind === "diff" ? changed : files).includes(p.path))
                throw new Error(
                  p.kind === "diff"
                    ? `${p.path} isn't changed in the view's range`
                    : `${p.path} isn't a file at the view's snapshot`,
                );
              if (
                others.some((o) => o.path === p.path) ||
                mine.slice(0, i).some((o) => o.path === p.path)
              )
                throw new Error(`${p.path} is already embedded in the view`);
              if (view.guide && p.kind === "file" && changed.includes(p.path))
                throw new Error(
                  `${p.path} is changed; embed its diff in a guide, or use a non-guide view for source files`,
                );
            }
            const errors = (await checkDiagrams(diagrams(markdown))).flatMap((e, i) =>
              e ? [`Diagram ${i + 1} doesn't draw: ${e}`] : [],
            );
            if (errors.length)
              throw new Error(`${errors.join("\n")}\nFix it and write the section again.`);
            sections = sections.toSpliced(at, item.number === undefined ? 0 : 1, markdown);
            done.push(`Section ${at + 1} ${item.number === undefined ? "added" : "replaced"}.`);
          };
          const save = async () => {
            if (!done.length) return;
            await db
              .updateTable("views")
              .set({ sections: JSON.stringify(sections) })
              .where("id", "=", view.id)
              .execute();
            tell(workspaceId);
          };
          // In order; one that doesn't fit stops the rest, and those before it are kept.
          for (const [k, item] of items.entries()) {
            try {
              await put(item);
            } catch (e) {
              await save();
              throw new Error(
                `${items.length > 1 ? `Section ${k + 1} of those given: ` : ""}${(e as Error).message}${done.length ? `\nThe ${done.length} before it were saved: ${done.join(" ")}` : ""}`,
              );
            }
          }
          await save();
          const saved = `View ${view.id}: ${done.join(" ")}`;
          if (!view.guide) return saved;
          const all = new Set(
            embedded(sections.map(parseSection))
              .filter((p) => p.kind === "diff")
              .map((p) => p.path),
          );
          const left = changed.filter((p) => !all.has(p));
          return left.length
            ? `${saved} ${left.length} files in no section yet: ${left.slice(0, 10).join(", ")}${left.length > 10 ? `, and ${left.length - 10} more` : ""}`
            : `${saved} Every changed file is in a section.`;
        }),
    },
    {
      name: "remove_section",
      annotations: destructiveTool,
      description:
        "Remove section number N (1 is the first) from a view, the latest unless view is given. The sections after it move up.",
      inputSchema: {
        type: "object",
        properties: { number: { type: "integer" }, ...viewArg },
        required: ["number"],
      },
      call: (a: { number: number; view?: number }) =>
        changeView(db, workspaceId, a.view, async (view) => {
          if (a.number < 1 || a.number > view.markdown.length)
            throw new Error(`The view has ${view.markdown.length} sections`);
          await db
            .updateTable("views")
            .set({ sections: JSON.stringify(view.markdown.toSpliced(a.number - 1, 1)) })
            .where("id", "=", view.id)
            .execute();
          tell(workspaceId);
          return `Section ${a.number} of view ${view.id} removed; it has ${view.markdown.length - 1} left.`;
        }),
    },
    {
      name: "file_summaries",
      annotations: readTool,
      description:
        "The file summaries of a view's changed files (the latest view unless view is given): a sentence on what changed in each, written ahead by a small model from its diff alone. start_view lists them already, as many as fit; call this for the rest (from), for those still being written (paths and wait), or for a view started in an earlier turn. A long list comes in parts: the result says the from of the next. Summaries missing are started again; wait gives those being written up to that many seconds.",
      inputSchema: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Changed files to get; leave out for all",
          },
          wait: {
            type: "integer",
            description: "Seconds to wait for summaries being written, up to 120",
          },
          from: {
            type: "integer",
            description:
              "The index of the first file to list, from a result that stopped early; 0 for the start",
          },
          ...viewArg,
        },
      },
      call: async (a: { paths?: string[]; wait?: number; from?: number; view?: number }) => {
        const view = await toolView(db, workspaceId, a.view);
        const changed = await changedFiles(db, view);
        const unknown = (a.paths ?? []).filter((p) => !changed.some((f) => f.path === p));
        if (unknown.length)
          throw new Error(`Not changed in the view's range: ${unknown.join(", ")}`);
        const files = a.paths ? changed.filter((f) => a.paths!.includes(f.path)) : changed;
        if (!files.length) return "The view has no changed files.";
        await summarise(db, workspaceId, view.base, view.head, "view");
        const wait = Math.min(Math.max(a.wait ?? 0, 0), 120) * 1000;
        const from = Math.min(Math.max(a.from ?? 0, 0), files.length - 1);
        const lines = await summaryLines(db, workspaceId, view, files, wait);
        const listed = listFiles(files, lines, from);
        return `${listHeader(files, from, listed.next)}\n${listed.text}${listRest(files, listed.next)}`;
      },
    },
    {
      name: "list_views",
      annotations: readTool,
      description:
        "List the workspace's views, newest first: id, title, range and section headings. Use an id to write to a view other than the latest.",
      inputSchema: { type: "object", properties: {} },
      call: async () => {
        const views = await listViews(db, workspaceId);
        if (!views.length) return "No views yet.";
        return views
          .map((v) =>
            [
              `View ${v.id}: ${v.title}${v.guide ? " (guide)" : ""}, ${v.base} → ${v.head}`,
              ...v.sections.map((s, i) => `  ${i + 1}. ${s.title}`),
            ].join("\n"),
          )
          .join("\n\n");
      },
    },
    {
      name: "add_explanation",
      annotations: closedTool,
      description:
        "Explain lines of a file or file diff in the view: what they do and why, to help the user read them. Give several in explanations to add them in one call. Call start_view first.",
      inputSchema: anchorSchema("explanations"),
      call: (a: Partial<AnchorArgs> & { explanations?: AnchorArgs[] }) =>
        addAll(db, workspaceId, "explanation", a, a.explanations),
    },
    {
      name: "add_finding",
      annotations: closedTool,
      description:
        "Add a review finding on lines of a file or file diff in the view: a bug, risk, missing case or better way. Only when the user asked for a review. Give several in findings to add them in one call. Call start_view first.",
      inputSchema: anchorSchema("findings"),
      call: (a: Partial<AnchorArgs> & { findings?: AnchorArgs[] }) =>
        addAll(db, workspaceId, "finding", a, a.findings),
    },
  ];
}
