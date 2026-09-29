import { python } from "./python.ts";
import { typescript } from "./typescript.ts";

// ADR 0034: a language server coxswain can start, one file per language in this folder. Adding a language is a new
// file and a line in `languageServers`; the client (lsp.ts), the checkouts and the UI don't change.
export type LanguageServer = {
  name: string; // what the user is told about, e.g. when it can't start
  languageIds: Record<string, string>; // the file extensions it takes, with their LSP language IDs
  // Folders read from the worktree, symlinked into a commit's checkout, which doesn't have them (e.g. node_modules).
  dependencies: string[];
  start: () => Promise<{ command: string; args: string[] }>; // may fetch it first (download.ts)
};

export const languageServers: LanguageServer[] = [typescript, python];
