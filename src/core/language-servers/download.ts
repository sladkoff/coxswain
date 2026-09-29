import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// ADR 0034: a language server that isn't an npm package, fetched on first use from a pinned release: one archive per
// platform, checked against its pinned sha256 before it's unpacked, then kept in
// ~/coxswain/language-servers/<name>-<version>/. Unpacked with the system's tar (bsdtar also reads Windows' zips).
export type Release = {
  name: string;
  version: string;
  exe: string; // the executable's path inside the archive
  // By `${process.platform}-${process.arch}`: the archive's URL and its sha256.
  archives: Record<string, { url: string; sha256: string }>;
};

const root = join(homedir(), "coxswain", "language-servers");
const fetching = new Map<string, Promise<string>>();

// The executable's path, fetched first if it isn't here yet; once, however many ask at a time.
export function downloaded(r: Release): Promise<string> {
  const dir = join(root, `${r.name}-${r.version}`);
  const exe = join(dir, r.exe);
  if (existsSync(exe)) return Promise.resolve(exe);
  if (!fetching.has(dir))
    fetching.set(
      dir,
      fetchRelease(r, dir).then(
        () => exe,
        (e) => {
          fetching.delete(dir);
          throw e;
        },
      ),
    );
  return fetching.get(dir)!;
}

async function fetchRelease(r: Release, dir: string) {
  const platform = `${process.platform}-${process.arch}`;
  const archive = r.archives[platform];
  if (!archive) throw new Error(`${r.name} has no build for ${platform}`);
  const response = await fetch(archive.url);
  if (!response.ok) throw new Error(`Could not download ${r.name}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (sha256 !== archive.sha256) throw new Error(`${r.name}'s download doesn't match its checksum`);
  // Unpacked beside the final folder and renamed into place, so a half-unpacked one never looks done.
  mkdirSync(root, { recursive: true });
  const tmp = mkdtempSync(join(root, `.${r.name}-`));
  try {
    const file = join(tmp, archive.url.slice(archive.url.lastIndexOf("/") + 1));
    writeFileSync(file, data);
    await promisify(execFile)("tar", ["-xf", file, "-C", tmp]);
    rmSync(file);
    if (process.platform !== "win32") chmodSync(join(tmp, r.exe), 0o755);
    renameSync(tmp, dir);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}
