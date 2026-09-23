import type { DatabaseSync } from 'node:sqlite'

// A project is a GitHub repository added to coxswain. ponytail: no local clone yet; add repo_path when cloning lands.
export type Project = { id: number; owner: string; name: string; lastOpenedAt: string }

// Most recently opened first; the first one is the current project.
export function listProjects(db: DatabaseSync): Project[] {
  return db
    .prepare('select id, owner, name, last_opened_at as lastOpenedAt from projects order by last_opened_at desc')
    .all() as Project[]
}

// Adds the project if it's new, and makes it the current one.
export function openProject(db: DatabaseSync, fullName: string): Project {
  const [owner, name, ...rest] = fullName.split('/')
  if (!owner || !name || rest.length) throw new Error(`Not an owner/name: ${fullName}`)
  return db
    .prepare(
      `insert into projects (owner, name, last_opened_at) values (?, ?, ?)
       on conflict (owner, name) do update set last_opened_at = excluded.last_opened_at
       returning id, owner, name, last_opened_at as lastOpenedAt`,
    )
    .get(owner, name, new Date().toISOString()) as Project
}
