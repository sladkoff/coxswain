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
