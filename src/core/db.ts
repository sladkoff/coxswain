import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { type Generated, Kysely, SqliteDialect } from 'kysely'

// ADR 0005: one SQLite database, owned by the core. Append migrations; never edit one that has shipped.
// The history up to here was squashed into the first one; databases made before it are refused (openDatabase).
const migrations = [
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
]

// ADR 0016: the tables as the migrations above leave them. Change this with every migration that changes a table.
type Side = 'old' | 'new'
type Tables = {
  projects: { id: Generated<number>; owner: string; name: string; last_opened_at: string }
  workspaces: { id: Generated<number>; project_id: number; pr_number: number; last_opened_at: string }
  agent_sessions: {
    id: Generated<number>
    workspace_id: number
    agent: string
    agent_session_id: string
    created_at: string
  }
  reviewed_files: { workspace_id: number; path: string; fingerprint: string }
  guides: { id: Generated<number>; workspace_id: number; base: string; head: string; groups: Generated<string>; created_at: string }
  settings: { key: string; value: string }
  entries: {
    id: Generated<number>
    workspace_id: number
    kind: 'note' | 'question' | 'answer' | 'explanation' | 'finding'
    body: string
    parent_id: number | null
    guide_id: number | null
    path: string | null
    side: Side | null
    start_line: number | null
    end_line: number | null
    code: string | null
    base: string | null
    head: string | null
    created_at: string
    resolved_at: Generated<string | null>
  }
}

export type Db = Kysely<Tables>

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path)
  db.exec('pragma foreign_keys = on')
  const { user_version } = db.prepare('pragma user_version').get() as { user_version: number }
  if (user_version > migrations.length)
    throw new Error(`${path} was made by an older coxswain whose migrations were squashed; move it away to start afresh`)
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
