// Run against REMOTE_DEBUGGING_PORT=9222 pnpm dev. Uses synthetic query responses only.
// This temporarily mounts a separate review canvas; it does not change user data.
import assert from "node:assert/strict";
const files = Number(process.argv[2] ?? 1200);
const stablePlaceholder = process.argv.includes("--stable-placeholder");
assert.ok(Number.isSafeInteger(files) && files > 0 && files <= 2000);
const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = pages.find((page) => page.type === "page" && page.url.startsWith("http://localhost:"));
assert.ok(page, "Start a development app with REMOTE_DEBUGGING_PORT=9222");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let timeout;
try {
  const response = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Renderer benchmark timed out")), 30000);
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id === 2) resolve(message.result);
    });
  });
  // Keep the benchmark's measurement timers responsive even if the dev window is behind Codex.
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Emulation.setFocusEmulationEnabled",
      params: { enabled: true },
    }),
  );
  socket.send(
    JSON.stringify({
      id: 2,
      method: "Runtime.evaluate",
      params: {
        expression: `(${benchmark.toString()})(${files}, ${stablePlaceholder})`,
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  );
  const result = await response;
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
  console.log(JSON.stringify(result.result.value));
} finally {
  clearTimeout(timeout);
  socket.send(
    JSON.stringify({
      id: 3,
      method: "Emulation.setFocusEmulationEnabled",
      params: { enabled: false },
    }),
  );
  socket.close();
}
async function benchmark(count, stablePlaceholder) {
  const main = await (await fetch("/src/main.tsx")).text();
  const dependency = (name) =>
    main.match(new RegExp('from "([^" ]*deps/' + name + '\\.js[^" ]*)"'))[1];
  const { createElement: h, Profiler } = (await import(dependency("react"))).default;
  const { createRoot } = (await import(dependency("react-dom_client"))).default;
  const { flushSync } = (
    await import(dependency("react-dom_client").replace("react-dom_client", "react-dom"))
  ).default;
  const { QueryClient, QueryClientProvider } = await import(dependency("@tanstack_react-query"));
  const { Virtualizer, WorkerPoolContextProvider } = await import(
    dependency("@pierre_diffs_react")
  );
  const { default: DiffsWorker } = await import(
    main.match(/from "([^" ]*\/worker\/worker.js\?worker)"/)[1]
  );
  const { Viewer } = await import("/src/Viewer.tsx");
  let reads = 0,
    active = 0,
    peakActive = 0;
  const timers = new Set();
  const text = Array.from({ length: 120 }, (_, i) => `export const value_${i} = "old value";`).join(
    "\n",
  );
  class FixtureQueries extends QueryClient {
    defaultQueryOptions(options) {
      const result = super.defaultQueryOptions(options);
      const [name, workspace, revision] = result.queryKey ?? [];
      if (workspace !== -991 || name !== "readFileAt") return result;
      return {
        ...result,
        queryFn: ({ signal }) =>
          new Promise((resolve, reject) => {
            reads++;
            active++;
            peakActive = Math.max(peakActive, active);
            const timer = setTimeout(() => {
              timers.delete(timer);
              active--;
              resolve({
                status: "ok",
                binary: false,
                text: revision === "base" ? text : text.replaceAll("old value", "new value"),
              });
            }, 2000);
            timers.add(timer);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                timers.delete(timer);
                active--;
                reject(new Error("Fixture read cancelled"));
              },
              { once: true },
            );
          }),
      };
    }
  }
  const queries = new FixtureQueries({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(["getCodeTheme"], "default");
  const reserve = document.createElement("style");
  reserve.textContent = stablePlaceholder
    ? "[data-large-pr-benchmark] [data-diff-pending] { min-height: 4044px; }"
    : "";
  document.head.append(reserve);
  const host = document.createElement("div");
  host.dataset.largePrBenchmark = "";
  host.style =
    "position:fixed;inset:60px;z-index:99999;background:white;display:flex;flex-direction:column";
  document.body.append(host);
  const root = createRoot(host);
  let mountRenderMs = 0;
  const onRender = (_id, phase, duration) => {
    if (phase === "mount") mountRenderMs += duration;
  };
  try {
    const started = performance.now();
    const nodes = Array.from({ length: count }, (_, i) =>
      h(
        "div",
        { key: i, id: `diff:benchmark-${i}.ts` },
        h(Viewer, {
          workspace: { id: -991, prNumber: null },
          mergeBase: "base",
          head: "head",
          opened: {
            kind: "diff",
            file: {
              path: `benchmark-${i}.ts`,
              previousPath: null,
              status: "modified",
              additions: 120,
              deletions: 120,
            },
          },
          entries: [],
          turns: {},
          reviewed: false,
          stacked: true,
          diffStyle: "unified",
          onAsk: () => {},
          onAnswerPermission: () => {},
          onOpenFile: () => {},
          onReviewedChange: () => {},
        }),
      ),
    );
    const canvas = h(
      Virtualizer,
      { className: "overflow-auto", style: { height: 600, overflowAnchor: "none" } },
      ...nodes,
    );
    const tree = h(
      WorkerPoolContextProvider,
      {
        poolOptions: { workerFactory: () => new DiffsWorker() },
        highlighterOptions: { preferredHighlighter: "shiki-js", useTokenTransformer: true },
      },
      h(
        QueryClientProvider,
        { client: queries },
        h(Profiler, { id: "large-pr", onRender }, canvas),
      ),
    );
    flushSync(() => root.render(tree));
    const mountWallMs = performance.now() - started;
    const scroller = host.querySelector(".overflow-auto");
    const initialScrollHeight = scroller.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return {
      count,
      stablePlaceholder,
      mountRenderMs: +mountRenderMs.toFixed(1),
      mountWallMs: +mountWallMs.toFixed(1),
      readsBeforeFirstResponse: reads,
      peakConcurrentFixtureReads: peakActive,
      totalQueryRecords: queries.getQueryCache().getAll().length,
      pendingPlaceholders: host.querySelectorAll("[data-diff-pending]").length,
      loadingHeights: [...host.querySelectorAll("[data-diff-pending]")]
        .filter((element) => element.textContent === "Loading…")
        .slice(0, 4)
        .map((element) => element.getBoundingClientRect().height),
      initialScrollHeight,
      duringLoadingScrollHeight: scroller.scrollHeight,
      note: "Development React build; 600px viewport; 2000ms synthetic read latency; sample at 800ms; no real git or IPC file reads.",
    };
  } finally {
    flushSync(() => root.unmount());
    queries.clear();
    for (const timer of timers) clearTimeout(timer);
    host.remove();
    reserve.remove();
  }
}
