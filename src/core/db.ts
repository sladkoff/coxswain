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
