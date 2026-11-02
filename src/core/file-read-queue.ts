import { match } from "ts-pattern";
import type { FileReadPriority } from "../shared/file-reads.ts";

type Task = {
  key: string;
  priority: FileReadPriority;
  promise: Promise<unknown>;
  start: () => Promise<void>;
  running: boolean;
};

// ponytail: abandoned queued reads still finish; add consumer cancellation/reference counts when windowing file shells.
// Awaited reads share one bounded runner. Reserve capacity for viewport reads and explicit navigation.
export class FileReadQueue {
  private tasks = new Map<string, Task>();
  private active = 0;
  private pending = {
    interactive: new Map<string, Task>(),
    visible: new Map<string, Task>(),
    prefetch: new Map<string, Task>(),
  };
  private readonly concurrency: number;
  constructor(concurrency = 4) {
    this.concurrency = concurrency;
    if (concurrency < 3) throw new Error("File reads need at least three priority slots");
  }
  run<T>(key: string, priority: FileReadPriority, work: () => Promise<T>): Promise<T> {
    const existing = this.tasks.get(key);
    if (existing) {
      this.prioritize(key, priority);
      return existing.promise as Promise<T>;
    }
    const deferred = Promise.withResolvers<T>();
    const task: Task = {
      key,
      priority,
      running: false,
      promise: deferred.promise,
      start: async () => {
        try {
          deferred.resolve(await work());
        } catch (error) {
          deferred.reject(error);
        } finally {
          this.tasks.delete(key);
          this.active--;
          this.drain();
        }
      },
    };
    this.tasks.set(key, task);
    this.pending[priority].set(key, task);
    this.drain();
    return deferred.promise;
  }
  prioritize(key: string, priority: FileReadPriority) {
    const task = this.tasks.get(key);
    if (!task || task.running || this.rank(priority) >= this.rank(task.priority)) return;
    this.pending[task.priority].delete(key);
    task.priority = priority;
    this.pending[priority].set(key, task);
    this.drain();
  }
  private rank(priority: FileReadPriority) {
    return match(priority)
      .with("interactive", () => 0)
      .with("visible", () => 1)
      .with("prefetch", () => 2)
      .exhaustive();
  }
  private drain() {
    while (this.active < this.concurrency) {
      const priority = (["interactive", "visible", "prefetch"] as const).find(
        (priority) =>
          this.active < this.concurrency - this.rank(priority) && this.pending[priority].size > 0,
      );
      if (!priority) return;
      const task = this.pending[priority].values().next().value;
      if (!task) return;
      this.pending[priority].delete(task.key);
      task.running = true;
      this.active++;
      void Promise.resolve().then(task.start);
    }
  }
}
