# Large-PR responsiveness investigation

Date: 2026-11-02. Scope: PRs with 1,000+ files, on the current checkout including the uncommitted navigation fixes. The baseline investigation is followed by the first production improvements measured below.

## Conclusion

Yes: substantial unnecessary work can be removed before considering a renderer rewrite. File contents already load near the viewport and highlighting already uses workers, but the loading placeholder collapses and defeats the intended lookahead budget. Separately, review indicators still read/hash whole-PR contents, and the renderer mounts one React shell per file even when its code is not visible.

The first implementation should preserve placeholder heights and bound/prioritize reads. Then cache and narrow fingerprint work, followed by file-shell and sidebar windowing. Moving diff parsing off the renderer is a separate improvement for large individual files.

## First implementation

Pending cards retain their estimated height. Core reads share a four-slot queue: prefetch can occupy two slots, visible reads three, and explicit navigation all four. Queued reads coalesce and can be promoted. Worktree content reads use asynchronous filesystem access. Review indicators first select paths with baselines or prior marks; immutable revision/path content digests share a bounded 20,000-entry in-memory cache, including overlapping requests. Existing persisted fingerprint formats and live-edit detection remain unchanged. See [ADR 0043](../adr/0043-visible-first-file-reads.md).

| Synthetic measurement                            |   Before |  After |
| ------------------------------------------------ | -------: | -----: |
| Reads before first response, 1,200-file viewport |       66 |      2 |
| Repeat fingerprints, 1,200 × 400 lines           | 279.2 ms | 3.0 ms |
| Changed-since-review with no marks/baselines     | 366.0 ms | 0.3 ms |
| Overlapping full/subset fingerprint requests     | 331.2 ms | 6.2 ms |

In this first-stage measurement, the production renderer fixture kept the full scroll height during loading without fixture CSS. Mount time was still about 74 ms with 2,401 query records; file-shell/sidebar windowing was implemented in the next stage below. First fingerprint work still reads complete batches (193.2 ms in this run), retains transient buffers, and can block the main process while hashing. Live bulk fingerprint reads remain synchronous and uncached. Queued abandoned reads are not cancelled; explicit navigation can promote pending work and use reserved capacity. Streaming batches, cancellation, off-thread diff parsing and fewer mounted shells remain follow-ups. Single-run timing differences are directional evidence, not production latency guarantees.

## Windowing and parsing follow-up

Guide and Changes now retain lightweight measured file shells and Find registrations while releasing distant Viewer subscriptions. Sidebar file/thread groups use the same measured window; sections and directory rows remain mounted. Explicit destinations mount before focus/reveal. Files with unsent text, selections, expanded context or thread editing remain mounted. App scopes entries to their file/root once, and sidebar lookups use shared Maps/Sets.

Pierre’s public parser now runs in a dedicated presentation worker. Rendering uses precomputed FileDiff metadata, and offscreen Find shares that preparation. Concurrent parses coalesce by source identity; failures can retry. A no-progress watchdog replaces a stuck worker after 15 seconds. This avoids synchronous fallback and does not move source reads out of the core. See [ADR 0044](../adr/0044-windowed-review-content.md).

| Development fixture, 1,200 files    | Before windowing | After windowing |
| ----------------------------------- | ---------------: | --------------: |
| Initial mount wall time             |          73.5 ms |         24.5 ms |
| Query records before first response |            2,401 |               4 |
| Reads before first response         |                2 |               2 |

A separate 200-file fixture with cached source reads mounts 11 Viewers and 36 sidebar file rows initially; after jumps through the full list and back, only 12 file-read queries remain observed. It retains an unsent thread draft and verifies distant arrows/Home/End, Space review, two threads on one file, offscreen declaration/Find, Find updates after changed contents, context matches in unmounted files, and worker error recovery. A 30,000-line parse allowed 11 renderer timer ticks while pending. These are deterministic assertions plus single-run measurements, not production p95 claims. Existing reply-scroll checks pass in unified, split, file and prose layouts; all 19 sidebar keyboard checks pass.

Remaining costs: lightweight shells/Find registrations and section/directory projections still scale with list size. Deliberately retained editing/context can keep additional Viewers alive. Query-cached source and metadata retain their normal lifetime. One parsing worker is serial and requests are not individually cancelled; cold core fingerprint batch buffering/live bulk reads are unchanged. A real-PR production-build profile remains useful before claiming a target-click latency guarantee.

## Baseline measurements

These are single-run synthetic fixtures on an Apple M5 Pro, Node 26.8.1 and Electron 44.4.5, not production p95 results. Fixture generation warms disk caches; “first call” below is not cold storage. The renderer uses the development React build, a separate root with the app's worker-pool configuration, empty thread lists and fake file responses. It does not include the full Guide/sidebar mount, real IPC/git latency, large individual files or a complete scroll sweep. Absolute numbers should not be generalized to other machines. Raw output is in [large-pr-benchmark-results.json](large-pr-benchmark-results.json).

### The lazy-load cascade is measurable

A real `Viewer`/Pierre `Virtualizer` fixture mounts 1,200 files, each with 120 added and 120 deleted lines, in a 600 px viewport. File responses are deliberately delayed 2,000 ms, and sampling happens at 800 ms. The comparison changes only loading-placeholder sizing using fixture-scoped CSS; it is not a production fix.

| Measurement                                    | Current behavior | Stable pending height experiment |
| ---------------------------------------------- | ---------------: | -------------------------------: |
| Content reads started before any response      |               66 |                                2 |
| Peak concurrent fixture reads                  |               66 |                                2 |
| Pending card height after entering read margin |            64 px |                         4,044 px |
| Scroll height before loading                   |     4,852,800 px |                     4,852,800 px |
| Scroll height during loading                   |     4,721,460 px |                     4,852,800 px |
| Query records                                  |            2,401 |                            2,401 |
| React mount render duration                    |          36.1 ms |                          34.7 ms |
| Synchronous mount wall time                    |          74.4 ms |                          71.6 ms |

That is 33 files scheduled instead of one old/new pair before the first response. The cold placeholder reserves 4,044 px; the pending branch replaces it with a 64 px Loading box. Each shrink brings more cards into the 1,500 px read margin. Holding the height prevents this cascade. This measures reduced scheduling/height churn, **not a claimed end-to-end load-time speedup**. [Placeholder branches](/Users/florianwagner/Developer/coxswain/src/renderer/src/Viewer.tsx:495), [near-viewport gate](/Users/florianwagner/Developer/coxswain/src/renderer/src/Viewer.tsx:204).

Mounting only 120 files took 3.4 ms React render / 5.6 ms wall time and created 241 query records. The 1,200-file shell cost is therefore real even before any text is returned; stable heights alone do not remove it. Theme queries share one cache record, but every Viewer still creates its own theme/read observers, appearance subscription and input listeners. The full App can retain both Guide and Changes surfaces, so this fixture undercounts workspace-wide work. [All-card rendering](/Users/florianwagner/Developer/coxswain/src/renderer/src/App.tsx:1878), [retained canvases](/Users/florianwagner/Developer/coxswain/src/renderer/src/components/RetainedCanvas.tsx:20).

### Core work grows with the whole PR

The synthetic git fixtures change one line in every file. The 1,200-file fixtures contain 20.8 MiB or 69.5 MiB of source per revision, respectively. Timings use the actual core APIs against a temporary repository and database.

| Operation                                       | 120 files × 120 lines | 1,200 × 120 lines | 1,200 × 400 lines |
| ----------------------------------------------- | --------------------: | ----------------: | ----------------: |
| Changed-file metadata                           |               16.7 ms |          100.6 ms |          132.2 ms |
| Read 10 visible files                           |                8.7 ms |            9.9 ms |            9.7 ms |
| Fingerprint every file, first call              |               24.6 ms |          222.7 ms |          286.1 ms |
| Fingerprint every file again                    |               26.5 ms |          213.2 ms |          279.2 ms |
| Changed-since-review, **no marks or baselines** |               35.2 ms |          253.5 ms |          366.0 ms |
| Overlapping full/subset fingerprint requests    |               27.8 ms |          240.8 ms |          331.2 ms |
| Live-worktree fingerprint every file            |               16.1 ms |          147.8 ms |          191.5 ms |

The larger fixture recorded maximum event-loop delays of 49–53 ms for fingerprint/indicator work and **90.8 ms** during overlapping full/subset requests. This code runs in Electron's main process, so synchronous reads, concatenation and hashing can delay UI-facing IPC. Whole-process sampled peak RSS reached 499 MiB by the end of the larger run; this is not an operation's incremental allocation and is not evidence of a leak. The 20.8 MiB fixture peaked at 244 MiB by its final operation. File count alone is not a sufficient workload description; bytes and diff complexity matter too.

`listChangedSinceReview` fingerprints every changed path before filtering by baseline or previous review. It even does so when both are empty and its result must be empty. `reviewed` events invalidate that query on every toggle. `readBlobs` shares only identical concurrent requests; it drops the entry when finished, and a different subset/order has a different key. Repeated calls therefore still read/hash the same immutable contents. [Indicator implementation](/Users/florianwagner/Developer/coxswain/src/core/reviewed.ts:159), [invalidations](/Users/florianwagner/Developer/coxswain/src/renderer/src/queries.ts:120), [fingerprints](/Users/florianwagner/Developer/coxswain/src/core/git.ts:878), [batch-read lifetime](/Users/florianwagner/Developer/coxswain/src/core/git.ts:961).

## Recommended implementation sequence

1. **Preserve pending heights; make loading visible-first and bounded.** Carry the estimated or last measured height through pending/error states. Prioritize explicit click/declaration/thread targets and actual viewport files before overscan. Limit concurrent reads with a core-owned queue; UI reads already awaited by the user do not need a second background-job runner. Consider a shared `git cat-file` reader rather than one `git show` process per displayed side. Shrinking overscan alone will not fix collapsing placeholders. [Per-file git read](/Users/florianwagner/Developer/coxswain/src/core/git.ts:1014).
2. **Stop whole-PR fingerprint rereads on routine interactions.** Read baseline/review metadata first; skip an empty candidate set and hash only candidates. Cache content digests by immutable git blob identity and reuse them across ranges and path subsets. Stream batch contents/digests rather than retaining every file in concatenated buffers. Preserve the current fingerprint semantics: a git blob ID includes its header and is not interchangeable with the existing SHA-1 of raw contents. Live worktree digests need reliable change-based invalidation. Do not make Hide Reviewed Files temporarily incorrect to gain first paint. [Existing fingerprint format](/Users/florianwagner/Developer/coxswain/src/core/git.ts:894).
3. **Reduce all-file React/update work.** Index reviewed paths, entries, threads and section ownership once. Hoist Guide's all-file Map outside each section. Share appearance/modifier subscriptions rather than installing them per Viewer. Avoid passing the entire changing turns/entries collections to every file. These are source-audit recommendations; this investigation has not isolated their individual speedups.
4. **Window file shells, then review sidebar groups.** The simple Pierre virtualizer windows code DOM, but coxswain's 1,200 Viewers and their hooks remain. The pinned Pierre 1.4.3 already contains `CodeView` with file-item windowing and ID/line targets; no upgrade is required to prototype Changes first. Guide's prose, diagrams, sticky layouts and threads make its migration a separate job. Keep drafts and disclosure state outside any component that will unmount. Expanded sidebar rows also need variable-height windowing eventually. See [detailed library/source audit](large-pr-rendering-options.md).
5. **Move or cache diff parsing, not just highlighting.** `MultiFileDiff` synchronously calls `parseDiffFromFile` inside React before worker highlighting. The separate public `FileDiff` component accepts precomputed metadata. `CodeView` also requires metadata; its `loadDiffFiles` hydrates missing text and does not magically calculate diffs asynchronously. Profile large individual files before choosing core versus worker parsing. [Pinned library parsing](/Users/florianwagner/Developer/coxswain/node_modules/@pierre/diffs/dist/react/utils/useFileDiffInstance.js:132).

Do not start by adding more highlighting workers: they already exist, and the measured unnecessary reads and whole-PR status work are separate bottlenecks. Do not unmount the whole canvas on every selection; that would regress the scroll, focus, thread and loading fixes.

## Reproduce

```sh
node scripts/benchmark-large-pr.mjs 120 120
node scripts/benchmark-large-pr.mjs 1200 120
node scripts/benchmark-large-pr.mjs 1200 400
# Against a dev app with REMOTE_DEBUGGING_PORT=9222:
node scripts/benchmark-large-pr-renderer.mjs 1200
node scripts/benchmark-large-pr-renderer.mjs 1200 --stable-placeholder
node scripts/benchmark-large-pr-renderer.mjs 120
node scripts/check-large-pr-windowing.mjs
```

Core fixtures are removed afterward. Renderer queries are intercepted with fake responses in a separate QueryClient; no synthetic git reads, account changes, agent requests or user-database writes are made. The temporary canvas and workers are disposed afterward. Run the renderer cases sequentially and let hot reload finish first.

Before implementing a larger change, add production-build measurements on a real 1,000–2,000-file PR: cold first usable viewport, target-click latency p50/p95, long tasks, concurrent git reads, memory after a complete scroll sweep, and a review toggle during streaming. Compare Guide, Changes and Files separately. Preserve sidebar arrows/Space review, offscreen Find, drafts, Back/Forward, same-file thread/file navigation and user-cancellable scroll ownership.
