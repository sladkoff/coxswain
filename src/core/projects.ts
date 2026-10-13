import { homedir } from "node:os";
import { dirname } from "node:path";
import type { Db } from "./db";
import { emit } from "./events.ts";
import { type Forge, forgeOf, type ForgeKind, type ForgeRepo } from "./forge.ts";

// ADR 0040: a project is a git repository added to coxswain. path: the user's own repository (a local repository), or
// null for coxswain's clone, whose path follows from its repository on its forge (git.ts). forge, host, repo: where it
// is on a forge (ADR 0041), else null. names: how the UI names its forge and its PRs. where: for the UI, the owner or
// group of a clone, or the folder a local repository is in.
export type Project = {
  id: number;
  name: string;
  path: string | null;
  forge: ForgeKind | null;
  host: string | null;
  repo: string | null;
  lastOpenedAt: string;
  names: Forge["names"] | null;
  where: string;
};

const columns = [
  "id",
  "name",
  "path",
  "forge",
  "host",
  "repo",
  "last_opened_at as lastOpenedAt",
] as const;

const home = homedir();
const withWhere = (p: Omit<Project, "where" | "names">): Project => {
  const dir = p.path && dirname(p.path);
  const where = !dir
    ? p.repo!.split("/").slice(0, -1).join("/")
    : dir === home || dir.startsWith(`${home}/`)
      ? `~${dir.slice(home.length)}`
      : dir;
  return { ...p, names: p.forge && forgeOf(p.forge).names, where };
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

// A repository from a forge's list, which coxswain clones: added if it's new, and made the current project.
export async function addForgeProject(db: Db, repo: ForgeRepo): Promise<Project> {
  const name = repo.path.split("/").at(-1);
  if (!name || repo.path.split("/").some((s) => !s))
    throw new Error(`Not a repository: ${repo.path}`);
  const found = await db
    .selectFrom("projects")
    .select("id")
    .where("forge", "=", repo.forge)
    .where("host", "=", repo.host)
    .where("repo", "=", repo.path)
    .where("path", "is", null)
    .executeTakeFirst();
  return found ? touch(db, found.id) : insert(db, { name, path: null }, repo);
}

// A local repository at path (its top level, checked by git.ts), on the forge its origin is on if coxswain knows it:
// added if it's new, and made the current project.
export async function addLocalProject(
  db: Db,
  path: string,
  name: string,
  repo: ForgeRepo | null,
): Promise<Project> {
  const found = await db
    .selectFrom("projects")
    .select("id")
    .where("path", "=", path)
    .executeTakeFirst();
  if (!found) return insert(db, { name, path }, repo);
  // Its origin may have moved since it was added.
  await db.updateTable("projects").set(onForge(repo)).where("id", "=", found.id).execute();
  return touch(db, found.id);
}

const onForge = (repo: ForgeRepo | null) => ({
  forge: repo?.forge ?? null,
  host: repo?.host ?? null,
  repo: repo?.path ?? null,
});

async function insert(db: Db, p: { name: string; path: string | null }, repo: ForgeRepo | null) {
  const project = await db
    .insertInto("projects")
    .values({ ...p, ...onForge(repo), last_opened_at: now() })
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

// A project's repository on its forge, or null for one on none.
export const forgeRepo = (p: Pick<Project, "forge" | "host" | "repo">): ForgeRepo | null =>
  p.forge && p.host && p.repo ? { forge: p.forge, host: p.host, path: p.repo } : null;
