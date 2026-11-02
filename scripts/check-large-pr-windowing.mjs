// Run against REMOTE_DEBUGGING_PORT=9222 pnpm dev. Uses synthetic query responses only.
// This temporarily mounts a separate review canvas; it does not change user data.
import assert from "node:assert/strict";

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
    timeout = setTimeout(() => reject(new Error("Windowing checks timed out")), 90000);
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
        expression: `(${checkWindowing.toString()})()`,
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
async function checkWindowing() {
  const main = await (await fetch("/src/main.tsx")).text();
  const dep = (name) => main.match(new RegExp('from "([^" ]*deps/' + name + '\\.js[^" ]*)"'))[1];
  const { createElement: h } = (await import(dep("react"))).default;
  const { createRoot } = (await import(dep("react-dom_client"))).default;
  const { flushSync } = (
    await import(dep("react-dom_client").replace("react-dom_client", "react-dom"))
  ).default;
  const { QueryClientProvider } = await import(dep("@tanstack_react-query"));
  const { Virtualizer } = await import(dep("@pierre_diffs_react"));
  const { Viewer } = await import("/src/Viewer.tsx");
  const { SidebarFileThreads } = await import("/src/components/SidebarFileThreads.tsx");
  const { sidebarKeyDown } = await import("/src/components/sidebar-keyboard.ts");
  const { prepareDiff } = await import("/src/diff-metadata.ts");
  const { queryClient: q } = await import(main.match(/from "([^" ]*\/src\/queries.ts[^" ]*)"/)[1]);
  const find = await import("/src/find.ts");
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, message) => {
    for (let i = 0; i < 100; i++) {
      if (test()) return;
      await sleep(50);
    }
    throw new Error(message);
  };
  const source = Array.from({ length: 150 }, (_, i) => `const line${i} = ${i};`).join("\n");
  const count = 200;
  const paths = Array.from({ length: count }, (_, i) => `window-${i}.ts`);
  for (const [i, path] of paths.entries()) {
    q.setQueryData(["readFileAt", -993, "base", path], {
      status: "ok",
      binary: false,
      text: source,
    });
    q.setQueryData(["readFileAt", -993, "head", path], {
      status: "ok",
      binary: false,
      text: source.replace(
        "const line9 = 9;",
        `const line9 = "${i === count - 1 ? "needle_unique_window" : "changed"}";`,
      ),
    });
  }
  const app = document.getElementById("root");
  const visibility = app?.style.visibility;
  if (app) app.style.visibility = "hidden";
  const host = document.createElement("div");
  host.style = "position:fixed;inset:50px;z-index:99999;background:white";
  document.body.append(host);
  const errors = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error.stack) });
  let opened;
  let picked = "";
  const thread = {
    id: -993,
    workspaceId: -993,
    path: paths[0],
    kind: "question",
    body: "Fixture question",
    parentId: null,
    side: "new",
    startLine: 10,
    endLine: 10,
    shown: true,
    state: "current",
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  };
  const props = (path) => ({
    workspace: { id: -993, prNumber: null },
    mergeBase: "base",
    head: "head",
    opened: { kind: "diff", file: { path, status: "modified", additions: 1, deletions: 1 } },
    entries: path === paths[0] ? [thread] : [],
    turns: {},
    stacked: true,
    reviewed: false,
    diffStyle: "unified",
    onAsk() {},
    onAnswerPermission() {},
    onOpenFile() {},
    onReviewedChange() {},
    codeLine: opened ? { path: opened, line: 10, side: "additions" } : undefined,
  });
  const render = () =>
    flushSync(() =>
      root.render(
        h(
          QueryClientProvider,
          { client: q },
          h(
            "div",
            { style: { display: "flex" } },
            h(
              "nav",
              {
                className: "overflow-y-auto",
                style: { width: 280, height: 600 },
                onKeyDownCapture: sidebarKeyDown,
              },
              ...paths.map((path) =>
                h(SidebarFileThreads, {
                  key: path,
                  path,
                  showFolder: false,
                  reviewed: false,
                  onReviewed(on) {
                    picked = `review:${path}:${on}`;
                  },
                  onOpen() {
                    picked = path;
                  },
                  threads:
                    path === paths.at(-1)
                      ? [
                          { ...thread, id: -997 },
                          { ...thread, id: -996 },
                        ]
                      : [],
                  replies: new Map(),
                  turns: {},
                  onThread(id) {
                    picked = `thread:${id}`;
                  },
                }),
              ),
            ),
            h(
              Virtualizer,
              {
                className: "overflow-auto",
                style: { height: 600, width: 800, overflowAnchor: "none" },
              },
              ...paths.map((path) =>
                h("div", { key: path, id: `diff:${path}` }, h(Viewer, props(path))),
              ),
            ),
          ),
        ),
      ),
    );
  try {
    render();
    const canvas = host.querySelector(".overflow-auto");
    const sidebar = host.querySelector("nav");
    await until(
      () => host.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-line]"),
      "First worker diff did not render",
    );
    const initialViewers = host.querySelectorAll(".review-file-header").length;
    const initialSidebar = sidebar.querySelectorAll("button[data-sidebar-nav]").length;
    assert(initialViewers < 30, `Mounted ${initialViewers} viewers`);
    assert(initialSidebar < 60, `Mounted ${initialSidebar} sidebar rows`);
    const before = canvas.scrollTop;
    await sleep(200);
    assert(Math.abs(canvas.scrollTop - before) < 1, "Idle parsing shifted the viewport");
    await until(() => host.querySelector("textarea"), "Thread composer did not render");
    const draftInput = host.querySelector("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(
      draftInput,
      "Unsent windowing draft",
    );
    draftInput.dispatchEvent(new Event("input", { bubbles: true }));
    draftInput.blur();
    // Jump across the complete list, allowing each window to settle. Prior source queries stay cached but unobserved.
    for (const index of [40, 80, 120, 160, 199, 0]) {
      host.querySelector(`[id="diff:${paths[index]}"]`).scrollIntoView({ block: "start" });
      await sleep(250);
      assert(
        draftInput.isConnected && draftInput.value === "Unsent windowing draft",
        `errors=${JSON.stringify(errors)} host=${host.isConnected}/${host.innerHTML.length} ids=${[...host.querySelectorAll("[id]")].slice(0, 3).map((n) => n.id)} Draft after ${index}: connected=${draftInput.isConnected}, value=${draftInput.value}, inputs=${[...host.querySelectorAll("textarea")].map((n) => n.value)}, live=${host.querySelector(`[id="diff:${paths[0]}"]`)?.innerHTML.slice(0, 250)}`,
      );
      assert(
        host.querySelectorAll(".review-file-header").length < 35,
        `Viewers accumulated after reaching ${index}`,
      );
    }
    const observedReads = q
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[1] === -993 && query.getObserversCount() > 0).length;
    assert(observedReads < 70, `${observedReads} file reads remain observed after sweep`);
    const key = (element, key) =>
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    const first = sidebar.querySelector("button[data-sidebar-nav]");
    first.focus();
    key(first, "End");
    assert(
      picked === "thread:-996",
      `End picked ${picked}; focused ${document.activeElement?.textContent}; placeholders ${sidebar.querySelectorAll("[data-window-placeholder]").length}`,
    );
    assert(sidebar.contains(document.activeElement), "End lost keyboard focus");
    key(document.activeElement, "ArrowUp");
    assert(picked === "thread:-997", "ArrowUp did not select the other thread on the same file");
    key(document.activeElement, "ArrowUp");
    assert(picked === paths.at(-1), "ArrowUp did not select the containing file");
    key(document.activeElement, " ");
    assert(picked === `review:${paths.at(-1)}:true`, "Space did not review the distant file");
    key(document.activeElement, "ArrowUp");
    assert(picked === paths.at(-2), "ArrowUp did not cross unmounted row boundary");
    key(document.activeElement, "Home");
    assert(picked === paths[0], "Home did not return to first sidebar file");
    // Explicit offscreen code target must mount immediately, before any scrolling observer can see it.
    opened = paths[150];
    render();
    await until(
      () => host.querySelector(`[id="diff:${opened}"] diffs-container`),
      "Offscreen code target did not mount",
    );
    opened = undefined;
    render();
    canvas.scrollTop = 0;
    await sleep(250);
    find.activateFindPane("canvas");
    find.openFind();
    find.setFindQuery("needle_unique_window");
    await until(
      () => !find.findSnapshot().searching && find.findSnapshot().matches.length === 1,
      "Offscreen Find missed the last file",
    );
    await until(
      () => !!find.findSnapshot().matches[0].range(),
      "Find did not reveal/render the offscreen match",
    );
    await until(() => {
      const range = find.findSnapshot().matches[0]?.range()?.getBoundingClientRect();
      const viewport = canvas.getBoundingClientRect();
      return range && range.top >= viewport.top && range.bottom <= viewport.bottom;
    }, "Find match was not scrolled into view").catch((error) => {
      const match = find.findSnapshot().matches[0];
      throw new Error(
        `${error.message}: range=${JSON.stringify(match?.range()?.getBoundingClientRect())}, viewport=${JSON.stringify(canvas.getBoundingClientRect())}, scroll=${canvas.scrollTop}, last=${JSON.stringify(host.querySelector(`[id="diff:${paths.at(-1)}"]`).getBoundingClientRect())}`,
      );
    });
    q.setQueryData(["readFileAt", -993, "head", paths.at(-1)], {
      status: "ok",
      binary: false,
      text: source.replace("const line9 = 9;", 'const line9 = "needle_updated_window";'),
    });
    await until(
      () => find.findSnapshot().matches.length === 0,
      "Find retained matches from old live contents",
    );
    find.setFindQuery("needle_updated_window");
    await until(
      () => !find.findSnapshot().searching && find.findSnapshot().matches.length === 1,
      "Find missed updated live contents",
    );
    find.setFindQuery("const line8 = 8;");
    await until(
      () => !find.findSnapshot().searching && find.findSnapshot().matches.length === count,
      "Find missed context in unmounted files",
    );
    find.closeFind();
    // The worker path uses the same public Pierre parser and shares simultaneous callers.
    const old = { name: "worker.ts", contents: source, cacheKey: "worker-old" };
    const next = {
      name: "worker.ts",
      contents: source + "\nconst added = true;",
      cacheKey: "worker-new",
    };
    const a = prepareDiff(old, next),
      b = prepareDiff(old, next);
    assert(a === b, "Concurrent diff parsing did not coalesce");
    const metadata = await a;
    assert(
      metadata.hunks.length === 1 &&
        metadata.additionLines.some((line) => line.includes("const added")),
      "Worker metadata is incorrect",
    );
    const malformed = { name: "bad.ts", contents: null };
    let rejected = false;
    try {
      await prepareDiff(malformed, next);
    } catch {
      rejected = true;
    }
    assert(rejected, "Worker parse errors were not propagated");
    malformed.contents = source;
    assert((await prepareDiff(malformed, next)).hunks.length > 0, "Failed parse remained cached");
    let ticks = 0;
    const pulse = setInterval(() => ticks++, 0);
    try {
      const large = Array.from({ length: 30000 }, (_, i) => `const item${i} = ${i};`).join("\n");
      await prepareDiff(
        { name: "large.ts", contents: large },
        {
          name: "large.ts",
          contents: large.replace("const item15000 = 15000;", "let item15000 = 15001;"),
        },
      );
      assert(ticks > 0, "Large diff parsing blocked the renderer event loop");
    } finally {
      clearInterval(pulse);
    }
    assert(errors.length === 0, errors.join("\n"));
    return {
      rendererTicksDuringLargeParse: ticks,
      initialViewers,
      initialSidebar,
      observedReadsAfterSweep: observedReads,
      fullSweep: true,
      sidebarDistantNavigation: true,
      offscreenCodeTarget: true,
      offscreenFind: true,
      workerCoalescing: true,
      draftRetained: true,
      workerRecovery: true,
    };
  } finally {
    find.closeFind();
    flushSync(() => root.unmount());
    host.remove();
    if (app) app.style.visibility = visibility;
    q.removeQueries({ predicate: (query) => query.queryKey[1] === -993 });
  }
}
