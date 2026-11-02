// Run with the development app started using REMOTE_DEBUGGING_PORT=9222 pnpm dev.
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
    timeout = setTimeout(
      () => reject(new Error("Sidebar check timed out; retry after the app finishes reloading")),
      15000,
    );
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id === 1) resolve(message.result);
    });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(${checkSidebarKeyboard.toString()})()`,
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  );
  const result = await response;
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
  assert.deepEqual(result.result.value.failures, []);
  console.log(`PASS ${result.result.value.checks} sidebar keyboard checks`);
} finally {
  clearTimeout(timeout);
  socket.close();
}

async function checkSidebarKeyboard() {
  const { sidebarKeyDown } = await import(`/src/components/sidebar-keyboard.ts?t=${Date.now()}`);
  const host = document.createElement("nav");
  host.style = "position:fixed;inset:60px;z-index:99999;background:white;overflow:auto";
  host.innerHTML = `
    <button data-sidebar-nav="open" id="keyboard-section">Section</button>
    <div data-sidebar-row><button data-sidebar-nav="open" id="keyboard-file">File</button>
    <input type="checkbox" aria-label="Reviewed"></div>
    <div style="display:none"><button data-sidebar-nav="open">Hidden file</button></div>
    <button data-sidebar-nav="open" disabled>Disabled file</button>
    <div inert><button data-sidebar-nav="open">Inactive file</button></div>
    <button data-sidebar-nav="open" id="keyboard-thread">Thread</button>
    <button data-sidebar-nav="disclosure" id="keyboard-group" aria-expanded="false">Group</button>
    <button data-sidebar-nav="open" id="keyboard-last">Last file</button>`;
  document.body.append(host);
  const opened = [];
  const failures = [];
  let checks = 0;
  const check = (condition, message) => {
    checks++;
    if (!condition) failures.push(message);
  };
  host.addEventListener("keydown", sidebarKeyDown, true);
  for (const button of host.querySelectorAll("button"))
    button.addEventListener("click", () => opened.push(button.id));
  const group = host.querySelector("#keyboard-group");
  group.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") group.setAttribute("aria-expanded", "true");
    if (event.key === "ArrowLeft") group.setAttribute("aria-expanded", "false");
  });
  const focus = (id) => host.querySelector(`#${id}`).focus();
  const key = (name, modifiers = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    document.activeElement.dispatchEvent(event);
    return event;
  };
  try {
    focus("keyboard-section");
    check(key("ArrowDown").defaultPrevented, "handled arrows prevent page scrolling");
    check(document.activeElement.id === "keyboard-file", "Down focuses the next file");
    check(opened.at(-1) === "keyboard-file", "Down opens the file");
    key("ArrowDown");
    check(
      document.activeElement.id === "keyboard-thread",
      "Down reaches threads and skips hidden/disabled/inert rows and checkboxes",
    );
    check(opened.at(-1) === "keyboard-thread", "Down opens the selected thread");
    const count = opened.length;
    key("ArrowDown");
    check(document.activeElement === group, "Down crosses onto a group header");
    check(
      opened.length === count && group.getAttribute("aria-expanded") === "false",
      "moving to a group does not toggle it",
    );
    key("ArrowRight");
    check(group.getAttribute("aria-expanded") === "true", "Right keeps group expansion behavior");
    key("ArrowLeft");
    check(group.getAttribute("aria-expanded") === "false", "Left keeps group collapse behavior");
    key("End");
    check(
      document.activeElement.id === "keyboard-last" && opened.at(-1) === "keyboard-last",
      "End opens the last row across groups",
    );
    const lastCount = opened.length;
    key("ArrowDown");
    check(opened.length === lastCount, "Down at the boundary does not reopen the same file");
    key("Home");
    check(document.activeElement.id === "keyboard-section", "Home returns to the first row");
    check(
      !key("ArrowDown", { metaKey: true }).defaultPrevented,
      "modified shortcuts stay untouched",
    );
    key("ArrowDown");
    key("ArrowUp");
    check(
      document.activeElement.id === "keyboard-section",
      "Up returns to the previous navigation row",
    );
    focus("keyboard-file");
    const review = host.querySelector("input");
    const opensBeforeReview = opened.length;
    check(
      key(" ").defaultPrevented && review.checked,
      "Space marks the focused file reviewed without scrolling",
    );
    check(
      document.activeElement.id === "keyboard-file" && opened.length === opensBeforeReview,
      "Space retains row focus without opening the file",
    );
    key(" ", { repeat: true });
    check(review.checked, "holding Space does not repeatedly toggle review");
    key(" ");
    check(!review.checked, "Space can unmark the focused file");
    const checkbox = host.querySelector("input");
    checkbox.focus();
    check(
      !key("ArrowDown").defaultPrevented && !checkbox.checked,
      "review controls keep their own keyboard behavior",
    );
    return { checks, failures };
  } finally {
    host.remove();
  }
}
