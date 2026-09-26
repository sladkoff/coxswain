import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { type Generated, Kysely, SqliteDialect } from 'kysely'

// ADR 0005: one SQLite database, owned by the core. Append migrations; never edit one that has shipped.
const migrations = [
  `create table projects (
    id integer primary key,
    owner text not null,
    name text not null,
    last_opened_at text not null,
    unique (owner, name)
  )`,
  `create table workspaces (
    id integer primary key,
    project_id integer not null references projects (id) on delete cascade,
    pr_number integer not null,
    last_opened_at text not null,
    unique (project_id, pr_number)
  )`,
  `create table agent_sessions (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    agent text not null,
    agent_session_id text not null unique,
    created_at text not null
  )`,
  `create table comments (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    path text not null,
    side text not null check (side in ('old', 'new')),
    start_line integer not null,
    end_line integer not null,
    code text not null,
    body text not null,
    created_at text not null,
    sent_at text
  )`,
  `create table viewed_files (
    workspace_id integer not null references workspaces (id) on delete cascade,
    path text not null,
    fingerprint text not null,
    primary key (workspace_id, path)
  )`,
  // An agent session asked from a comment, whose replies show in the comment's thread rather than in L4.
  `alter table agent_sessions add column comment_id integer references comments (id) on delete cascade`,
  // A guide to a workspace's diff, made by an agent. groups: JSON, [{ title, description, paths }].
  `create table guides (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    merge_base text not null,
    model text not null,
    groups text not null,
    created_at text not null
  )`,
  // The user's settings that the core needs, e.g. the guide prompt. Unset keys use the core's defaults.
  `create table settings (key text primary key, value text not null)`,
  // ADR 0010: a guide is stored once grouped and filled in group by group; finished_at is null until it's done.
  // Guides made before were stored finished.
  `alter table guides add column started_at text;
   alter table guides add column finished_at text;
   update guides set finished_at = created_at`,
  // ADR 0010: a one-sentence summary per file diff, reused while the file diff's fingerprint is unchanged.
  `create table file_summaries (
    workspace_id integer not null references workspaces (id) on delete cascade,
    path text not null,
    fingerprint text not null,
    summary text not null,
    primary key (workspace_id, path)
  )`,
  // ADR 0011: review rounds of entries replace comments, which are dropped with the agent sessions asked from them.
  // agent_sessions is rebuilt to lose comment_id, which a foreign key keeps from being dropped.
  `create table review_rounds (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    created_at text not null
  );
  create table entries (
    id integer primary key,
    review_round_id integer not null references review_rounds (id) on delete cascade,
    kind text not null check (kind in ('note', 'question', 'answer')),
    body text not null,
    parent_id integer references entries (id) on delete cascade,
    path text,
    side text check (side in ('old', 'new')),
    start_line integer,
    end_line integer,
    code text,
    created_at text not null,
    sent_at text
  );
  create table agent_sessions_new (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    agent text not null,
    agent_session_id text not null unique,
    created_at text not null,
    review_round_id integer references review_rounds (id) on delete cascade
  );
  insert into agent_sessions_new (id, workspace_id, agent, agent_session_id, created_at)
    select id, workspace_id, agent, agent_session_id, created_at from agent_sessions where comment_id is null;
  drop table agent_sessions;
  alter table agent_sessions_new rename to agent_sessions;
  drop table comments`,
  // ADR 0012: wrapping up ends a round and drafts its action items. entry_ids: JSON, the entries an item came from.
  `alter table review_rounds add column ended_at text;
  create table action_items (
    id integer primary key,
    review_round_id integer not null references review_rounds (id) on delete cascade,
    position integer not null,
    body text not null,
    entry_ids text not null,
    path text,
    side text check (side in ('old', 'new')),
    start_line integer,
    end_line integer,
    code text,
    created_at text not null
  )`,
  // A guide to one commit's diff (its commit diff): head is the commit, merge_base its parent. Null: all changes.
  `alter table guides add column head text`,
  // ADR 0014: a guide to all changes is pinned to the PR head it was made at (head), and kind says which range it
  // is. Guides from before have no head and keep showing the live diff. Viewed keeps a row per fingerprint, so a
  // pinned file diff and a live one can both be viewed.
  `alter table guides add column kind text not null default 'all' check (kind in ('all', 'commit'));
  update guides set kind = 'commit' where head is not null;
  create table viewed_files_new (
    workspace_id integer not null references workspaces (id) on delete cascade,
    path text not null,
    fingerprint text not null,
    primary key (workspace_id, path, fingerprint)
  );
  insert into viewed_files_new select workspace_id, path, fingerprint from viewed_files;
  drop table viewed_files;
  alter table viewed_files_new rename to viewed_files`,
  // ADR 0015: an entry records the range it was written in (head null: the worktree), and a round its first
  // entry's. Entries from before have none.
  `alter table entries add column base text;
  alter table entries add column head text;
  alter table review_rounds add column merge_base text;
  alter table review_rounds add column head text`,
  // ADR 0019: an action item can be ticked done; a round whose items are all done is resolved.
  `alter table action_items add column done_at text`,
  // ADR 0020: a phase is a PR head coxswain saw. base: the old side of what it changed (the merge base, or the
  // previous head when this one builds on it). intent, why: its change summary, null until made.
  `create table phases (
    id integer primary key,
    workspace_id integer not null references workspaces (id) on delete cascade,
    head text not null,
    base text not null,
    merge_base text not null,
    seen_at text not null,
    intent text,
    why text,
    model text,
    summarised_at text,
    unique (workspace_id, head)
  )`,
  // ADR 0020: a change summary is prose, which the intent and why only steer. Summaries made before are dropped, so
  // they're made again.
  `alter table phases drop column intent;
  alter table phases drop column why;
  alter table phases add column summary text;
  update phases set model = null, summarised_at = null`,
]

// ADR 0016: the tables as the migrations above leave them. Change this with every migration that changes a table.
type Side = 'old' | 'new'
export type Tables = {
  projects: { id: Generated<number>; owner: string; name: string; last_opened_at: string }
  workspaces: { id: Generated<number>; project_id: number; pr_number: number; last_opened_at: string }
  agent_sessions: {
    id: Generated<number>
    workspace_id: number
    agent: string
    agent_session_id: string
    created_at: string
    review_round_id: number | null
  }
  viewed_files: { workspace_id: number; path: string; fingerprint: string }
  guides: {
    id: Generated<number>
    workspace_id: number
    merge_base: string
    head: string | null
    kind: Generated<'all' | 'commit'>
    model: string
    groups: string // JSON
    created_at: string
    started_at: string | null
    finished_at: string | null
  }
  settings: { key: string; value: string }
  file_summaries: { workspace_id: number; path: string; fingerprint: string; summary: string }
  review_rounds: {
    id: Generated<number>
    workspace_id: number
    created_at: string
    ended_at: string | null
    merge_base: string | null
    head: string | null
  }
  entries: {
    id: Generated<number>
    review_round_id: number
    kind: 'note' | 'question' | 'answer'
    body: string
    parent_id: number | null
    path: string | null
    side: Side | null
    start_line: number | null
    end_line: number | null
    code: string | null
    base: string | null
    head: string | null
    created_at: string
    sent_at: string | null
  }
  phases: {
    id: Generated<number>
    workspace_id: number
    head: string
    base: string
    merge_base: string
    seen_at: string
    summary: string | null
    model: string | null
    summarised_at: string | null
  }
  action_items: {
    id: Generated<number>
    review_round_id: number
    position: number
    body: string
    entry_ids: string // JSON
    path: string | null
    side: Side | null
    start_line: number | null
    end_line: number | null
    code: string | null
    created_at: string
    done_at: string | null
  }
}

export type Db = Kysely<Tables>

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path)
  db.exec('pragma foreign_keys = on')
  const { user_version } = db.prepare('pragma user_version').get() as { user_version: number }
  for (let i = user_version; i < migrations.length; i++) {
    db.exec('begin')
    db.exec(migrations[i])
    db.exec(`pragma user_version = ${i + 1}`)
    db.exec('commit')
  }
  // Kysely's SQLite dialect expects better-sqlite3's statements: parameters as one array, and a reader flag.
  const database = {
    close: () => db.close(),
    prepare: (query: string) => {
      const stmt = db.prepare(query)
      const args = (p: readonly unknown[]) => p as SQLInputValue[]
      return {
        reader: stmt.columns().length > 0,
        all: (p: readonly unknown[]) => stmt.all(...args(p)),
        run: (p: readonly unknown[]) => stmt.run(...args(p)),
        iterate: (p: readonly unknown[]) => stmt.iterate(...args(p)),
      }
    },
  }
  return new Kysely<Tables>({ dialect: new SqliteDialect({ database }) })
}
