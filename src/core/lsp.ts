import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createMessageConnection,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  FileChangeType,
  InitializedNotification,
  InitializeRequest,
  type Location,
  type LocationLink,
  type MessageConnection,
  ReferencesRequest,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver-protocol/node";
import type { Db } from "./db";
import { type Checkout, checkoutAt, pruneCheckouts } from "./git.ts";
import { type LanguageServer, languageServers } from "./language-servers/index.ts";
import { changesBetween, snapshotOf } from "./snapshot.ts";

// ADR 0034: Go to Definition and Find Usages, answered by the file's language server in a checkout of the revision the
// name was clicked in.

// Where a name was clicked: a file at a commit, or in the worktree (null), and the name's line (1-based) and first
// character (0-based, in UTF-16 code units, as the canvas and LSP both count).
export type CodeAt = { commit: string | null; path: string; line: number; character: number };
// A line found, in the same revision, e.g. where a name is defined or used.
export type CodeLine = { path: string; line: number; text: string };
export type CodeProblem = {
  status: "no-language-server" | "language-server-error";
  message: string;
};
export type CodeLineList = { status: "ok"; lines: CodeLine[] } | CodeProblem;

// ponytail: fixed; per machine if memory or checkout disk becomes a complaint.
export const lspLimits = { servers: 4 };

export const languageServerFor = (path: string): LanguageServer | undefined =>
  languageServers.find((s) => extname(path) in s.languageIds);

export const findDefinitions = (db: Db, workspaceId: number, at: CodeAt) =>
  ask(db, workspaceId, at, "definitions");
export const findUsages = (db: Db, workspaceId: number, at: CodeAt) =>
  ask(db, workspaceId, at, "usages");

async function ask(
  db: Db,
  workspaceId: number,
  at: CodeAt,
  what: "definitions" | "usages",
): Promise<CodeLineList> {
  try {
    const found = await lookUp(await checkoutAt(db, workspaceId, at.commit), at, what);
    // ponytail: a checkout made while this runs, not yet read by a server, could go too; rare, and made again.
    await pruneCheckouts(
      db,
      workspaceId,
      [...running.values()].map((r) => r.root),
    );
    return found;
  } catch (e) {
    return { status: "language-server-error", message: (e as Error).message };
  }
}

// The file's language server's answer, in a checkout of the revision clicked in.
export async function lookUp(
  checkout: Checkout,
  at: CodeAt,
  what: "definitions" | "usages",
): Promise<CodeLineList> {
  const server = languageServerFor(at.path);
  if (!server)
    return {
      status: "no-language-server",
      message: `No language server for ${extname(at.path) || basename(at.path)} files`,
    };
  try {
    const running = await serverIn(server, checkout);
    await tellChanges(running, checkout.path);
    const file = join(checkout.path, at.path);
    const uri = pathToFileURL(file).href;
    // Sent as it is on disk each time: an open document is the server's to track, so it wouldn't see the file change.
    const text = readFileSync(file, "utf8");
    const version = (running.versions.get(uri) ?? 0) + 1;
    running.versions.set(uri, version);
    const c = running.connection;
    if (version === 1)
      void c.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: server.languageIds[extname(file)], version, text },
      });
    else
      void c.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    const position = {
      textDocument: { uri },
      position: { line: at.line - 1, character: at.character },
    };
    const found =
      what === "definitions"
        ? await c.sendRequest(DefinitionRequest.type, position)
        : await c.sendRequest(ReferencesRequest.type, {
            ...position,
            context: { includeDeclaration: true },
          });
    return { status: "ok", lines: codeLines(checkout.path, found) };
  } catch (e) {
    return { status: "language-server-error", message: `${server.name}: ${(e as Error).message}` };
  }
}

type Found = Location | Location[] | LocationLink[] | null;

// The locations found as lines of the checkout. ponytail: one outside it (a linked node_modules seen from a commit's
// checkout) is left out, not shown from the worktree.
function codeLines(root: string, found: Found): CodeLine[] {
  const locations = (Array.isArray(found) ? found : found ? [found] : []).map((l) =>
    "targetUri" in l ? { uri: l.targetUri, range: l.targetSelectionRange } : l,
  );
  const files = new Map<string, string[]>();
  return locations.flatMap(({ uri, range }) => {
    const path = relative(root, fileURLToPath(uri));
    if (path.startsWith("..") || isAbsolute(path)) return [];
    if (!files.has(path)) files.set(path, readFileSync(join(root, path), "utf8").split("\n"));
    const line = range.start.line + 1;
    return [{ path, line, text: files.get(path)![line - 1]?.trim() ?? "" }];
  });
}

// Servers by checkout and language, started on first use; beyond lspLimits the least recently used stops, and the
// checkouts no server reads any more are removed. One that stops by itself is started again when next asked.
type Running = {
  child: ChildProcess;
  connection: MessageConnection;
  versions: Map<string, number>; // each open document's
  // In the worktree, the snapshot of it the server last saw (ADR 0028); null in a commit's checkout, which never changes.
  seen: string | null;
};
const running = new Map<string, { root: string; server: Promise<Running>; used: number }>();

async function serverIn(server: LanguageServer, checkout: Checkout) {
  const key = `${server.name}:${checkout.path}`;
  let r = running.get(key);
  if (!r) {
    const entry = { root: checkout.path, server: start(server, checkout), used: Date.now() };
    const forget = () => running.get(key) === entry && running.delete(key);
    entry.server.then((s) => s.child.once("exit", forget), forget);
    running.set(key, (r = entry));
    const idle = [...running.entries()].sort(([, a], [, b]) => a.used - b.used);
    for (const [k, old] of idle.slice(0, Math.max(0, running.size - lspLimits.servers))) {
      running.delete(k);
      void old.server.then(
        (s) => s.child.kill(),
        () => {},
      );
    }
  }
  r.used = Date.now();
  return r.server;
}

async function start(server: LanguageServer, checkout: Checkout): Promise<Running> {
  // A commit's checkout reads the worktree's dependencies. ponytail: the worktree's versions, not the commit's.
  if (checkout.path !== checkout.worktree)
    for (const d of server.dependencies) {
      const from = join(checkout.worktree, d);
      const to = join(checkout.path, d);
      if (existsSync(from) && !existsSync(to)) symlinkSync(from, to, "junction");
    }
  // Before it starts, so a change made while it reads the files is told to it too. Not a repository (a test's folder):
  // nothing to compare with, so nothing is told.
  const seen =
    checkout.path === checkout.worktree ? await snapshotOf(checkout.path).catch(() => null) : null;
  const { command, args } = await server.start();
  const child = spawn(command, args, { cwd: checkout.path, stdio: ["pipe", "pipe", "ignore"] });
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout!),
    new StreamMessageWriter(child.stdin!),
  );
  // What the server asks of the client (watchers, configuration, progress) is answered with nothing.
  connection.onRequest(() => null);
  connection.listen();
  const gone = new Promise<never>((_, fail) => {
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`stopped (${code ?? "killed"})`)));
  });
  gone.catch(() => connection.dispose());
  const uri = pathToFileURL(checkout.path).href;
  await Promise.race([
    gone,
    connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: uri,
      workspaceFolders: [{ uri, name: basename(checkout.path) }],
      capabilities: {},
      initializationOptions: await server.initializationOptions?.(checkout.path),
    }),
  ]);
  void connection.sendNotification(InitializedNotification.type, {});
  return { child, connection, versions: new Map(), seen };
}

// What changed in the worktree since the server last looked (a commit, a pull, an agent's edit), told to it before it's
// asked: gopls doesn't watch files itself, so it would answer from the files as they were. An open document that
// changed is closed, so the server reads it from disk again and the next lookup opens it afresh.
async function tellChanges(running: Running, root: string) {
  if (running.seen === null) return;
  const now = await snapshotOf(root);
  if (now === running.seen) return;
  const changes = await changesBetween(root, running.seen, now);
  running.seen = now;
  const c = running.connection;
  const types: Record<string, FileChangeType> = {
    A: FileChangeType.Created,
    D: FileChangeType.Deleted,
  };
  for (const { path } of changes) {
    const uri = pathToFileURL(join(root, path)).href;
    if (running.versions.delete(uri))
      void c.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } });
  }
  void c.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: changes.map(({ path, status }) => ({
      uri: pathToFileURL(join(root, path)).href,
      type: types[status] ?? FileChangeType.Changed,
    })),
  });
}

// On quit.
export function stopLanguageServers() {
  for (const r of running.values())
    void r.server.then(
      (s) => s.child.kill(),
      () => {},
    );
  running.clear();
}
