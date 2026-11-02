import type { FileContents, FileDiffMetadata } from "@pierre/diffs";

let worker: Worker | undefined;
let nextId = 0;
let watchdog: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<
  number,
  { resolve: (diff: FileDiffMetadata) => void; reject: (error: Error) => void }
>();
// Query-owned FileContents identities retain metadata only as long as their source reads remain cached.
const cache = new WeakMap<FileContents, WeakMap<FileContents, Promise<FileDiffMetadata>>>();
function watchParser() {
  clearTimeout(watchdog);
  watchdog = pending.size
    ? setTimeout(() => stopParser(new Error("Diff preparation timed out")), 15000)
    : undefined;
}
function stopParser(error: Error) {
  clearTimeout(watchdog);
  watchdog = undefined;
  worker?.terminate();
  worker = undefined;
  for (const task of pending.values()) task.reject(error);
  pending.clear();
}
if (import.meta.hot) import.meta.hot.dispose(() => stopParser(new Error("Diff worker reloaded")));
function parser() {
  if (worker) return worker;
  worker = new Worker(new URL("./workers/diff.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({
    data,
  }: MessageEvent<{ id: number; diff: FileDiffMetadata; error?: string }>) => {
    const task = pending.get(data.id);
    if (!task) return;
    pending.delete(data.id);
    watchParser();
    if (data.error) task.reject(new Error(data.error));
    else task.resolve(data.diff);
  };
  worker.onerror = (event) => stopParser(new Error(event.message || "Diff worker failed"));
  worker.onmessageerror = () => stopParser(new Error("Could not read diff worker result"));
  return worker;
}
export function prepareDiff(old: FileContents, next: FileContents): Promise<FileDiffMetadata> {
  let versions = cache.get(old);
  if (!versions) cache.set(old, (versions = new WeakMap()));
  const hit = versions.get(next);
  if (hit) return hit;
  const id = ++nextId;
  const task = new Promise<FileDiffMetadata>((resolve, reject) => {
    const target = parser();
    pending.set(id, { resolve, reject });
    try {
      target.postMessage({ id, old, next });
      if (!watchdog) watchParser();
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  }).catch((error) => {
    versions.delete(next);
    throw error;
  });
  versions.set(next, task);
  return task;
}
