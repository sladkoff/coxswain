import { homedir } from "node:os";
import { dirname } from "node:path";
import type { Db } from "./db";
import { emit } from "./events.ts";

// ADR 0040: a project is a git repository added to coxswain. path: the user's own repository (a local repository), or
// null for coxswain's clone, whose path follows from github (git.ts). github: owner/name when it's on GitHub, else null.
// where: for the UI, the GitHub owner of a clone, or the folder a local repository is in.
export type Project = {
  id: number;
  name: string;
  path: string | null;
  github: string | null;
  lastOpenedAt: string;
  where: string;
};

const columns = ["id", "name", "path", "github", "last_opened_at as lastOpenedAt"] as const;

const home = homedir();
const withWhere = (p: Omit<Project, "where">): Project => {
  const dir = p.path && dirname(p.path);
  const where = !dir
    ? p.github!.split("/")[0]
    : dir === home || dir.startsWith(`${home}/`)
      ? `~${dir.slice(home.length)}`
      : dir;
  return { ...p, where };
};

// Most recently opened first; the first one is the current project.
export async function listProjects(db: Db): Promise<Project[]> {
  const rows = await db
    .selectFrom("projects")
    .select(columns)
    .orderBy("last_opened_at", "desc")
    .execute();
  return rows.map(withWhere);
}

const now = () => new Date().toISOString();

// Makes the project the current one.
export async function openProject(db: Db, id: number): Promise<void> {
  await db.updateTable("projects").set({ last_opened_at: now() }).where("id", "=", id).execute();
  emit({ what: "projects" });
}

// A GitHub repository from the list, which coxswain clones: added if it's new, and made the current project.
export async function addGitHubProject(db: Db, fullName: string): Promise<Project> {
  const [owner, name, ...rest] = fullName.split("/");
  if (!owner || !name || rest.length) throw new Error(`Not an owner/name: ${fullName}`);
  const found = await db
    .selectFrom("projects")
    .select("id")
    .where("github", "=", fullName)
    .where("path", "is", null)
    .executeTakeFirst();
  return found ? touch(db, found.id) : insert(db, { name, path: null, github: fullName });
}

// A local repository at path (its top level, checked by git.ts), on GitHub as github if its origin is there: added if
// it's new, and made the current project.
export async function addLocalProject(
  db: Db,
  path: string,
  name: string,
  github: string | null,
): Promise<Project> {
  const found = await db
    .selectFrom("projects")
    .select("id")
    .where("path", "=", path)
    .executeTakeFirst();
  if (!found) return insert(db, { name, path, github });
  // Its origin may have moved since it was added.
  await db.updateTable("projects").set({ github }).where("id", "=", found.id).execute();
  return touch(db, found.id);
}

async function insert(db: Db, p: { name: string; path: string | null; github: string | null }) {
  const project = await db
    .insertInto("projects")
    .values({ ...p, last_opened_at: now() })
    .returning(columns)
    .executeTakeFirstOrThrow();
  emit({ what: "projects" });
  return withWhere(project);
}

async function touch(db: Db, id: number): Promise<Project> {
  await openProject(db, id);
  return getProject(db, id);
}

export async function getProject(db: Db, id: number): Promise<Project> {
  const project = await db
    .selectFrom("projects")
    .select(columns)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!project) throw new Error(`No project ${id}`);
  return withWhere(project);
}

// A project's GitHub repository, for the GitHub API; throws for a project that isn't on GitHub.
export function gitHubRepo(p: { github: string | null }): { owner: string; name: string } {
  if (!p.github) throw new Error("The project isn't on GitHub");
  const [owner, name] = p.github.split("/");
  return { owner, name };
}
