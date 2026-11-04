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
    timeout = setTimeout(() => reject(new Error("Banner checks timed out")), 90000);
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
        expression: `(${checkBanner.toString()})()`,
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
async function checkBanner() {
  const main = await (await fetch("/src/main.tsx")).text();
  const dep = (name) => main.match(new RegExp('from "([^" ]*deps/' + name + '\\.js[^" ]*)"'))[1];
  const { createElement: h } = (await import(dep("react"))).default;
  const { createRoot } = (await import(dep("react-dom_client"))).default;
  const { flushSync } = (
    await import(dep("react-dom_client").replace("react-dom_client", "react-dom"))
  ).default;
  const { StaleGuideBanner } = await import("/src/components/StaleGuideBanner.tsx");
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  const host = document.createElement("div");
  host.style = "position:fixed;inset:80px;z-index:99999;background:white;height:600px";
  document.body.append(host);
  const root = createRoot(host);
  let refreshes = 0,
    enables = 0,
    finish;
  let automatic = false,
    running = false;
  const render = () =>
    flushSync(() =>
      root.render(
        h(
          "div",
          { className: "review-canvas flex h-full flex-col" },
          h(
            "div",
            { "data-stale-guide-banner": "", className: "shrink-0 pt-[var(--ui-toolbar-height)]" },
            h(StaleGuideBanner, {
              automatic,
              running,
              onRefresh: () => {
                refreshes++;
                return new Promise((resolve, reject) => {
                  finish = { resolve, reject };
                });
              },
              onEnableAutomatic: async () => {
                enables++;
                automatic = true;
                render();
              },
            }),
          ),
          h(
            "div",
            { className: "min-h-0 flex-1 overflow-auto" },
            h("div", { style: { height: 4000 } }, "Guide content"),
          ),
        ),
      ),
    );
  const button = (text) =>
    [...host.querySelectorAll("button")].find((node) => node.textContent === text);
  try {
    render();
    assert(host.textContent.includes("out of date"), "Missing stale text");
    assert(
      button("Enable Auto-update from Remote"),
      "Missing remote auto-update action when disabled",
    );
    const banner = host.querySelector('[role="status"]');
    const before = banner.getBoundingClientRect().top;
    assert(before >= host.getBoundingClientRect().top + 40, "Banner is behind the toolbar");
    host.querySelector(".overflow-auto").scrollTop = 500;
    await settle();
    assert(banner.getBoundingClientRect().top === before, "Banner scrolled with the Guide");
    button("Refresh Guide").click();
    await settle();
    assert(
      refreshes === 1 &&
        button("Refresh Guide").disabled &&
        button("Enable Auto-update from Remote").disabled,
      "Pending actions allow duplicate requests",
    );
    finish.reject(new Error("Fixture refresh failed"));
    await settle();
    assert(
      host.textContent.includes("Fixture refresh failed") && !button("Refresh Guide").disabled,
      "Refresh error cannot be retried",
    );
    button("Refresh Guide").click();
    await settle();
    finish.resolve();
    await settle();
    assert(
      refreshes === 2 && !host.textContent.includes("Fixture refresh failed"),
      "Refresh retry did not clear the error",
    );
    button("Enable Auto-update from Remote").click();
    await settle();
    assert(
      enables === 1 && !button("Enable Auto-update from Remote"),
      "Auto-update from Remote did not reflect enabled state",
    );
    running = true;
    render();
    assert(
      host.textContent.includes("Refreshing…") && button("Refresh Guide").disabled,
      "Running update is not represented",
    );
    return {
      staleBanner: true,
      toolbarClearance: true,
      fixedWhileScrolling: true,
      duplicateProtection: true,
      retry: true,
      automaticAction: true,
      runningState: true,
    };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
