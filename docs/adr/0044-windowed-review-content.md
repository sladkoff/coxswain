# 0044 — Windowed review content and worker diff metadata

## Status

Accepted.

## Context

Pierre virtualizes code rows, but a large Guide or Changes canvas still mounts every Viewer and its query, appearance and input subscriptions. Expanded review sidebars retain every file/thread row. MultiFileDiff also parses old/new text synchronously during React rendering before background highlighting begins.

## Decision

Keep lightweight measured-height shells at every file anchor in Guide and Changes. Mount the Viewer within 1,500 px of its scrollport and release it outside that window, preserving its last measured height. Keep an explicit code/thread destination mounted. Keep editors with unsent text, focus, selections, new annotations, expanded resolved/outdated threads, summaries or expanded diff context mounted to preserve transient state. The single Files editor stays mounted. Guide prose, sections and directories stay mounted.

Window sidebar file/thread groups with 400 px lookahead and measured heights. Primary arrow/Home/End navigation includes placeholder groups, mounts its destination synchronously, and then focuses/opens the appropriate file or thread. Guide reading markers and auto-follow can target the persistent shell.

Retain a lightweight Find registration for each canvas shell, so searching offscreen files does not mount their Viewers. Explicit Find reveal mounts only the destination. File reads stay in the core. Prepare diff metadata with Pierre’s public parseDiffFromFile API in a dedicated renderer presentation worker, then render the public FileDiff with that metadata. Find reuses the same preparation path. Coalesce/cache by query-owned FileContents identity with weak keys, and evict failures for retry. Metadata queries use normal query-cache retention. Worker errors reject pending work; a 15-second no-progress watchdog replaces a stuck worker. Display a retry control rather than falling back to synchronous parsing. No schema change or additional library is required.

## Alternatives considered

- Pierre CodeView: useful for a pure diff list, but cannot directly represent Guide prose/diagram layouts or the current annotation/composer state. Measured outer shells preserve the existing canvas and navigation anchors.
- CSS content-visibility only: retains React subscriptions and per-file handlers.
- Unmount every offscreen editor: loses unsent text, selection and disclosure state.
- Parse in Electron main: presentation computation would compete with core reads and agent-facing IPC.
- Synchronous fallback after worker failure: reintroduces renderer stalls on precisely the expensive inputs.

## Consequences

Heavy subscriptions and sidebar markup track the viewport plus deliberately retained editing state. Lightweight shells, Find registrations, section/directory markup and list projection still scale with file count; this is not constant-memory rendering. Query-cache contents and metadata can outlive mounted Viewers until normal collection. Explicit expanded-context files remain retained for the life of that canvas. Single-worker parsing is serial and abandoned parse requests are not individually cancelled; its watchdog bounds a stuck batch. Source strings and metadata still cross the worker boundary, and cold core fingerprint buffering is unchanged.
