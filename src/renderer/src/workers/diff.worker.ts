import { parseDiffFromFile, type FileContents } from "@pierre/diffs";

self.onmessage = ({
  data,
}: MessageEvent<{ id: number; old: FileContents; next: FileContents }>) => {
  try {
    self.postMessage({ id: data.id, diff: parseDiffFromFile(data.old, data.next) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
