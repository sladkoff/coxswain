import { DatabaseSync } from 'node:sqlite'

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
]

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('pragma foreign_keys = on')
  const { user_version } = db.prepare('pragma user_version').get() as { user_version: number }
  for (let i = user_version; i < migrations.length; i++) {
    db.exec('begin')
    db.exec(migrations[i])
    db.exec(`pragma user_version = ${i + 1}`)
    db.exec('commit')
  }
  return db
}
