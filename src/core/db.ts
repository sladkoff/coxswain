import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { type Generated, Kysely, SqliteDialect } from "kysely";

// ADR 0005: one SQLite database, owned by the core. Append migrations; never edit one that has shipped.
// The history up to here was squashed into the first one; databases made before it are refused (openDatabase).
export const migrations = [
  `create table projects (
    id integer primary key,
    owner text not null,
    name text not null,
    last_opened_at text not null,
    unique (owner, name)
  );
  create table workspaces (
    id integer primary key,
    project_id integer not null references projects (id) on delete cascade,
    pr_number integer not null,
    last_opened_at text not null,
    unique (project_id, pr_number)
  );
  -- The agent pane's sessions; agent_session_id is the agent's own (ADR 0018).
  create table agent_sessions (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    agent text not null,
    agent_session_id text not null unique,
    created_at text not null
  );
  -- ADR 0014: one row per fingerprint of a reviewed file diff's contents.
  create table reviewed_files (
    workspace_id integer not null references workspaces (id) on delete cascade,
    path text not null,
    fingerprint text not null,
    primary key (workspace_id, path, fingerprint)
  );
  -- ADR 0023: a guide is a pinned range and its groups (JSON, [{ title, description, paths, notes, tags }]).
  create table guides (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    base text not null,
    head text not null,
    groups text not null default '[]',
    created_at text not null
  );
  -- The user's settings that the core needs. Unset keys use the core's defaults.
  create table settings (key text primary key, value text not null);
  -- ADR 0015: a workspace's entries, threaded by parent_id. base, head: the range they were written in (head null:
  -- the worktree). An explanation or finding has its guide_id. resolved_at is set on a thread's first entry.
  create table entries (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    kind text not null check (kind in ('note', 'question', 'answer', 'explanation', 'finding')),
    body text not null,
    parent_id integer references entries (id) on delete cascade,
    guide_id integer references guides (id) on delete cascade,
    path text,
    side text check (side in ('old', 'new')),
    start_line integer,
    end_line integer,
    code text,
    base text,
    head text,
    created_at text not null,
    resolved_at text
  )`,
  // ADR 0026: guides become views, sections of markdown whose diff fences embed file diffs. A guide's groups turn into
  // sections: the title as a heading, the description, then each file's note and its diff fence.
  `alter table guides rename to views;
  alter table entries rename column guide_id to view_id;
  alter table views add column title text not null default 'Guide';
  alter table views add column guide integer not null default 1;
  alter table views add column sections text not null default '[]';
  update views set sections = (
    select coalesce(json_group_array(md), '[]') from (
      select '## ' || json_extract(g.value, '$.title') || char(10, 10) || json_extract(g.value, '$.description') || coalesce((
        select group_concat(
          char(10, 10) || coalesce(json_extract(g.value, '$.notes."' || p.value || '"') || char(10, 10), '') ||
            '\`\`\`diff path="' || p.value || '"' ||
            iif(json_extract(g.value, '$.tags') like '%"generated"%', ' generated', '') || char(10) || '\`\`\`',
          '')
        from json_each(g.value, '$.paths') p), '') as md
      from json_each(views.groups) g
      order by json_extract(g.value, '$.tags') like '%"generated"%', g.key
    )
  );
  alter table views drop column groups`,
  // An agent session's title: the agent's own once it names the session, else its first message.
  `alter table agent_sessions add column title text`,
  // ADR 0028: a workspace is a PR or a branch, so pr_number may be null. SQLite can't drop a not null, so the table is
  // rebuilt (openDatabase turns foreign keys off meanwhile, or dropping it would cascade). branch, base_branch: set for
  // a workspace started on a branch, kept once it gets a PR; its worktree is named by the branch.
  // turns: the worktree's snapshot before and after each agent turn that changed it, for the turn's diff.
  `create table workspaces_new (
    id integer primary key,
    project_id integer not null references projects (id) on delete cascade,
    pr_number integer,
    branch text,
    base_branch text,
    last_opened_at text not null,
    unique (project_id, pr_number),
    unique (project_id, branch),
    check (pr_number is not null or (branch is not null and base_branch is not null))
  );
  insert into workspaces_new (id, project_id, pr_number, last_opened_at)
    select id, project_id, pr_number, last_opened_at from workspaces;
  drop table workspaces;
  alter table workspaces_new rename to workspaces;
  create table turns (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    before text not null,
    after text not null,
    title text not null,
    created_at text not null
  )`,
  // ADR 0029: file summaries, one per fingerprint of a file diff's contents (ADR 0014). model: what wrote it,
  // "coxswain" for those written without a model (lockfiles, deletions, binary files).
  `create table file_summaries (
    workspace_id integer not null references workspaces (id) on delete cascade,
    path text not null,
    fingerprint text not null,
    summary text not null,
    model text not null,
    created_at text not null,
    primary key (workspace_id, path, fingerprint)
  )`,
  // ADR 0029: summary jobs, for Activity. A job still running when coxswain quit is stopped at the next start, as of
  // updated_at, when its progress was last stored.
  `create table summary_jobs (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    workspace text not null,
    why text not null check (why in ('ahead', 'view')),
    base text not null,
    head text not null,
    agent text not null,
    model text not null,
    ran_on text,
    files integer not null,
    reused integer not null,
    done integer not null,
    failed integer not null,
    calls integer not null,
    state text not null check (state in ('running', 'done', 'failed', 'stopped')),
    error text,
    started_at text not null,
    finished_at text,
    updated_at text not null
  )`,
  // A view pinned to the worktree (1) goes stale when the worktree moves on; one of a commit, a turn or what's on
  // GitHub (0) doesn't.
  `alter table views add column worktree integer not null default 1`,
  // The user's own prompts for New View, for every project; the built-in ones are in the code (src/core/views.ts).
  `create table prompts (
    id integer primary key,
    title text not null,
    body text not null,
    created_at text not null
  )`,
  // Original attachment previews, linked from the agent-owned transcript (ADR 0032).
  `create table agent_attachments (
    id text primary key,
    agent_session_id text not null references agent_sessions (agent_session_id) on delete cascade,
    attachments text not null
  )`,
  // A question: the agent session it went to, so a follow-up to another session sends the thread along (#11). Not a
  // foreign key: the question stays when its session goes.
  `alter table entries add column agent_session_id text`,
];

// ADR 0016: the tables as the migrations above leave them. Change this with every migration that changes a table.
type Side = "old" | "new";
type Tables = {
  projects: { id: Generated<number>; owner: string; name: string; last_opened_at: string };
  workspaces: {
    id: Generated<number>;
    project_id: number;
    pr_number: number | null;
    branch: string | null;
    base_branch: string | null;
    last_opened_at: string;
  };
  turns: {
    id: Generated<number>;
    workspace_id: number;
    before: string;
    after: string;
    title: string;
    created_at: string;
  };
  agent_attachments: { id: string; agent_session_id: string; attachments: string };
  agent_sessions: {
    id: Generated<number>;
    workspace_id: number;
    agent: string;
    agent_session_id: string;
    created_at: string;
    title: string | null;
  };
  reviewed_files: { workspace_id: number; path: string; fingerprint: string };
  summary_jobs: {
    id: Generated<number>;
    workspace_id: number;
    workspace: string;
    why: "ahead" | "view";
    base: string;
    head: string;
    agent: "claude" | "codex";
    model: string;
    ran_on: string | null;
    files: number;
    reused: number;
    done: number;
    failed: number;
    calls: number;
    state: "running" | "done" | "failed" | "stopped";
    error: string | null;
    started_at: string;
    finished_at: string | null;
    updated_at: string;
  };
  file_summaries: {
    workspace_id: number;
    path: string;
    fingerprint: string;
    summary: string;
    model: string;
    created_at: string;
  };
  views: {
    id: Generated<number>;
    workspace_id: number;
    base: string;
    head: string;
    title: string;
    guide: number; // 1: a guide, which goes through every changed file
    worktree: Generated<number>; // 1: pinned to a snapshot of the worktree, so it can go stale
    sections: Generated<string>; // JSON, the markdown of each section
    created_at: string;
  };
  settings: { key: string; value: string };
  prompts: { id: Generated<number>; title: string; body: string; created_at: string };
  entries: {
    id: Generated<number>;
    workspace_id: number;
    kind: "note" | "question" | "answer" | "explanation" | "finding";
    body: string;
    parent_id: number | null;
    view_id: number | null;
    path: string | null;
    side: Side | null;
    start_line: number | null;
    end_line: number | null;
    code: string | null;
    base: string | null;
    head: string | null;
    created_at: string;
    resolved_at: Generated<string | null>;
    agent_session_id: Generated<string | null>;
  };
};

export type Db = Kysely<Tables>;

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("pragma foreign_keys = off"); // node:sqlite turns them on; see below
  const { user_version } = db.prepare("pragma user_version").get() as { user_version: number };
  if (user_version > migrations.length)
    throw new Error(
      `${path} was made by an older coxswain whose migrations were squashed; move it away to start afresh`,
    );
  for (let i = user_version; i < migrations.length; i++) {
    db.exec("begin");
    db.exec(migrations[i]);
    db.exec(`pragma user_version = ${i + 1}`);
    db.exec("commit");
  }
  // Off while migrating, so a table rebuilt (dropped and made again) keeps its children; checked once they're done.
  if (db.prepare("pragma foreign_key_check").all().length)
    throw new Error(`${path}: a migration broke a foreign key`);
  db.exec("pragma foreign_keys = on");
  // Kysely's SQLite dialect expects better-sqlite3's statements: parameters as one array, and a reader flag.
  const database = {
    close: () => db.close(),
    prepare: (query: string) => {
      const stmt = db.prepare(query);
      const args = (p: readonly unknown[]) => p as SQLInputValue[];
      return {
        reader: stmt.columns().length > 0,
        all: (p: readonly unknown[]) => stmt.all(...args(p)),
        run: (p: readonly unknown[]) => stmt.run(...args(p)),
        iterate: (p: readonly unknown[]) => stmt.iterate(...args(p)),
      };
    },
  };
  return new Kysely<Tables>({ dialect: new SqliteDialect({ database }) });
}
