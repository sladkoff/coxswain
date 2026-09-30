import type { Db } from "./db";
import { follow, lineMap } from "./follow.ts";
import { pinRevision, readTexts } from "./git.ts";

// ADR 0015: a workspace's entries (glossary): notes, questions and answers, threaded by parent_id; and the agent's
// explanations and findings, which belong to a view too (viewId, ADR 0023).
// An entry's anchor is a line range of a file; side 'old' is the merge base (removed lines in a diff), 'new' the
// worktree. code: the lines as they were, since line numbers drift as the worktree changes. No anchor: it floats.
// base, head: the range of the view it was written in (ADR 0015); head null is the worktree (the live diff).
// revision: the commit its code is at (#31), which its lines are followed from.
type Anchor = {
  path: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  code: string;
  base: string;
  head: string | null;
};

export type ReviewEntry = {
  id: number;
  workspaceId: number;
  kind: "note" | "question" | "answer" | "explanation" | "finding";
  body: string;
  parentId: number | null; // the thread's first entry, for replies, follow-ups and answers
  viewId: number | null;
  path: string | null;
  side: "old" | "new" | null;
  startLine: number | null;
  endLine: number | null;
  code: string | null;
  base: string | null;
  head: string | null;
  createdAt: string;
  resolvedAt: string | null; // on a thread's first entry: when it was resolved
  agentSessionId: string | null; // a question: the agent session it went to
  revision: string | null;
  // ADR 0015: current while its lines are unchanged in the live diff (the worktree, or the merge base for the old
  // side), wherever they moved; outdated once they changed. The same whatever range it's listed for. A reply or
  // answer takes its thread's. Floating entries are current.
  state: "current" | "outdated";
  // In the range it was listed for: whether its lines are there unchanged; startLine and endLine are then where.
  shown: boolean;
  // Outdated: the lines that now stand where its code was, "" if none; null if it can't be told.
  now: string | null;
};

// A note or question from the user: anchored, or a follow-up in a thread (parentId).
export type NewEntry = { workspaceId: number; body: string; anchor?: Anchor; parentId?: number };

export const columns = [
  "id",
  "workspace_id as workspaceId",
  "kind",
  "body",
  "parent_id as parentId",
  "view_id as viewId",
  "path",
  "side",
  "start_line as startLine",
  "end_line as endLine",
  "code",
  "base",
  "head",
  "created_at as createdAt",
  "resolved_at as resolvedAt",
  "agent_session_id as agentSessionId",
  "revision",
] as const;

// Every entry of the workspace, in order.
// ponytail: every entry the workspace ever had; page or archive them if workspaces collect hundreds.
export type Row = Omit<ReviewEntry, "state" | "shown" | "now">;

export const workspaceEntries = (db: Db, workspaceId: number): Promise<Row[]> =>
  db
    .selectFrom("entries")
    .select(columns)
    .where("workspace_id", "=", workspaceId)
    .orderBy("id")
    .execute();

// Files at commits, which never change. ponytail: never evicted; an LRU if long sessions grow it too big.
const atCommit = new Map<string, string | null>();

// The workspace's entries, each followed from its revision (ADR 0015): its state in the live diff from mergeBase, and
// where it is in the range of base → head (the worktree without head).
export async function listEntries(
  db: Db,
  workspaceId: number,
  mergeBase: string,
  base: string,
  head?: string,
): Promise<ReviewEntry[]> {
  const rows = await workspaceEntries(db, workspaceId);
  const anchored = rows.filter((e) => e.path && !e.parentId);
  // Every text needed, read once per commit; the worktree's afresh.
  const texts = new Map<string, string | null>();
  const key = (commit: string | undefined, path: string) => `${commit ?? "worktree"}:${path}`;
  const wanted = new Map<string | undefined, Set<string>>();
  const want = (commit: string | undefined, path: string) => {
    if (commit && atCommit.has(key(commit, path)))
      texts.set(key(commit, path), atCommit.get(key(commit, path))!);
    else wanted.set(commit, (wanted.get(commit) ?? new Set()).add(path));
  };
  const live = (e: Row) => (e.side === "old" ? mergeBase : undefined);
  const range = (e: Row) => (e.side === "old" ? base : head);
  for (const e of anchored) {
    if (!e.revision) continue;
    want(e.revision, e.path!);
    want(live(e), e.path!);
    want(range(e), e.path!);
  }
  await Promise.all(
    [...wanted].map(async ([commit, paths]) => {
      for (const [path, text] of await readTexts(db, workspaceId, [...paths], commit)) {
        texts.set(key(commit, path), text);
        if (commit) atCommit.set(key(commit, path), text);
      }
    }),
  );
  // One line map per file and pair of versions, however many entries it has. A file that's gone keeps no lines.
  const maps = new Map<string, Int32Array>();
  const at = (e: Row, to: string | undefined) => {
    const from = texts.get(key(e.revision!, e.path!));
    if (from == null) return null;
    const b = texts.get(key(to, e.path!))?.split("\n") ?? [];
    const k = `${e.revision}>${key(to, e.path!)}`;
    const map = maps.get(k) ?? lineMap(from.split("\n"), b);
    maps.set(k, map);
    return follow(map, b, e.startLine!, e.endLine!);
  };
  const followed = new Map(
    anchored.map((e) => {
      const [inLive, inRange] = e.revision ? [at(e, live(e)), at(e, range(e))] : [null, null];
      const state = inLive?.status === "moved" ? ("current" as const) : ("outdated" as const);
      const now = inLive?.status === "changed" ? inLive.now : null;
      return [e.id, { state, now, shown: inRange?.status === "moved", lines: inRange }] as const;
    }),
  );
  return rows.map((e) => {
    const f = followed.get(e.parentId ?? e.id);
    const lines =
      !e.parentId && f?.lines?.status === "moved"
        ? { startLine: f.lines.start, endLine: f.lines.end }
        : {};
    return {
      ...e,
      ...lines,
      state: f?.state ?? "current",
      shown: f?.shown ?? false,
      now: f?.now ?? null,
    };
  });
}

export async function addEntry(db: Db, kind: ReviewEntry["kind"], e: NewEntry): Promise<Row> {
  if (!e.body.trim()) throw new Error(`A ${kind} needs text`);
  const a = e.anchor;
  if (a && a.side !== "old" && a.side !== "new") throw new Error(`Not a side: ${a.side}`);
  const [start, end] = a ? [a.startLine, a.endLine].sort((x, y) => x - y) : [null, null];
  const revision = a && (await pinRevision(db, e.workspaceId, a.side === "old" ? a.base : a.head));
  return db
    .insertInto("entries")
    .values({
      workspace_id: e.workspaceId,
      kind,
      body: e.body.trim(),
      parent_id: e.parentId ?? null,
      view_id: null,
      path: a?.path ?? null,
      side: a?.side ?? null,
      start_line: start,
      end_line: end,
      code: a?.code ?? null,
      base: a?.base ?? null,
      head: a?.head ?? null,
      revision: revision ?? null,
      created_at: new Date().toISOString(),
    })
    .returning(columns)
    .executeTakeFirstOrThrow();
}

// A new entry is current, and shown in the view it was written in.
export const fresh = (e: Row): ReviewEntry => ({ ...e, state: "current", shown: true, now: null });

export async function addNote(db: Db, e: NewEntry): Promise<ReviewEntry> {
  return fresh(await addEntry(db, "note", e));
}
