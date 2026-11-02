import { match, P } from "ts-pattern";
import { createHash } from "node:crypto";

// Values are small digests, never file buffers. Keys identify immutable revisions and paths.
export class ContentDigests {
  private cached = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private readonly limit: number;
  constructor(limit = 20000) {
    this.limit = limit;
  }
  async read(
    scope: string,
    paths: string[],
    load: (missing: string[]) => Promise<Map<string, Buffer | null>>,
    kind: "diff" | "file" = "diff",
  ) {
    const key = (path: string) => JSON.stringify([scope, kind, path]);
    const missing = [...new Set(paths)].filter(
      (path) => !this.cached.has(key(path)) && !this.pending.has(key(path)),
    );
    if (missing.length) {
      const loading = load(missing);
      for (const path of missing) {
        const id = key(path);
        const pending = loading
          .then((blobs) => {
            const bytes = blobs.get(path) ?? null;
            const value = digestContent(bytes, kind);
            this.cached.set(id, value);
            while (this.cached.size > this.limit) {
              const oldest = this.cached.keys().next().value;
              if (oldest !== undefined) this.cached.delete(oldest);
            }
            return value;
          })
          .finally(() => this.pending.delete(id));
        this.pending.set(id, pending);
      }
    }
    return new Map(
      await Promise.all(
        paths.map(async (path) => {
          const id = key(path);
          const hit = this.cached.get(id);
          if (hit) {
            this.cached.delete(id);
            this.cached.set(id, hit);
          }
          const value = hit ?? (await this.pending.get(id));
          if (!value) throw new Error(`Missing content digest: ${path}`);
          return [path, value] as const;
        }),
      ),
    );
  }
}

export function digestContent(bytes: Buffer | null, kind: "diff" | "file") {
  return match({ kind, bytes })
    .with({ kind: "file" }, () =>
      createHash("sha1")
        .update("file\0")
        .update(bytes ?? "deleted")
        .digest("hex"),
    )
    .with({ kind: "diff", bytes: null }, () => "absent")
    .with({ kind: "diff", bytes: P.nonNullable.select() }, (content) =>
      createHash("sha1").update(content).digest("hex"),
    )
    .exhaustive();
}
