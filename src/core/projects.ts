import type { Db } from "./db";
import { emit } from "./events.ts";

// A project is a GitHub repository added to coxswain. Its clone's path follows from owner/name (git.ts), so it isn't stored.
export type Project = { id: number; owner: string; name: string; lastOpenedAt: string };

const columns = ["id", "owner", "name", "last_opened_at as lastOpenedAt"] as const;

// Most recently opened first; the first one is the current project.
export function listProjects(db: Db): Promise<Project[]> {
  return db.selectFrom("projects").select(columns).orderBy("last_opened_at", "desc").execute();
}

// Adds the project if it's new, and makes it the current one.
export async function openProject(db: Db, fullName: string): Promise<Project> {
  const [owner, name, ...rest] = fullName.split("/");
  if (!owner || !name || rest.length) throw new Error(`Not an owner/name: ${fullName}`);
  const project = await db
    .insertInto("projects")
    .values({ owner, name, last_opened_at: new Date().toISOString() })
    .onConflict((oc) =>
      oc
        .columns(["owner", "name"])
        .doUpdateSet((eb) => ({ last_opened_at: eb.ref("excluded.last_opened_at") })),
    )
    .returning(columns)
    .executeTakeFirstOrThrow();
  emit({ what: "projects" });
  return project;
}

export async function getProject(db: Db, id: number): Promise<Project> {
  const project = await db
    .selectFrom("projects")
    .select(columns)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!project) throw new Error(`No project ${id}`);
  return project;
}
