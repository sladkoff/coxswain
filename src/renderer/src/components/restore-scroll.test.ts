import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreScroll } from "./restore-scroll.ts";

test("a restored pane never pulls the reader back after a manual scroll", async () => {
  const scroller = { scrollTop: 0, scrollHeight: 2000, clientHeight: 200 };
  const canvas = Object.assign(new EventTarget(), { querySelector: () => scroller });
  const stop = restoreScroll(canvas as unknown as HTMLElement, { top: 300, offset: 0 });
  assert.equal(scroller.scrollTop, 300, "cached position is applied synchronously before paint");
  scroller.scrollTop = 900;
  canvas.dispatchEvent(new Event("wheel"));
  await new Promise((done) => setTimeout(done, 80));
  assert.equal(scroller.scrollTop, 900, "virtualizer retries yield to user input");
  stop();
});

test("navigation cleanup cancels restoration while lazy content is still loading", async () => {
  const scroller = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 };
  const canvas = Object.assign(new EventTarget(), { querySelector: () => scroller });
  const stop = restoreScroll(canvas as unknown as HTMLElement, { top: 600, offset: 0 });
  stop();
  scroller.scrollHeight = 2000;
  await new Promise((done) => setTimeout(done, 80));
  assert.equal(scroller.scrollTop, 0, "an old destination cannot move the newly mounted canvas");
});

test("anchor restoration searches only the destination canvas, never an inactive retained tab", async () => {
  const oldCSS = globalThis.CSS;
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: (id: string) => id },
  });
  const scroller = {
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 200,
    getBoundingClientRect: () => ({ top: 10 }),
  };
  const anchor = { getBoundingClientRect: () => ({ top: 210 }) };
  const selectors: string[] = [];
  const canvas = Object.assign(new EventTarget(), {
    querySelector: (selector: string) => {
      selectors.push(selector);
      return selector.startsWith("[id=") ? anchor : scroller;
    },
  });
  const stop = restoreScroll(canvas as unknown as HTMLElement, {
    top: 0,
    anchor: "diff:shared.ts",
    offset: 0,
  });
  assert.equal(scroller.scrollTop, 200);
  assert.ok(selectors.includes('[id="diff:shared.ts"]'));
  stop();
  if (oldCSS) Object.defineProperty(globalThis, "CSS", { configurable: true, value: oldCSS });
  else Reflect.deleteProperty(globalThis, "CSS");
});

test("a clicked file stays anchored when deferred diffs change height after the initial jump", async (t) => {
  const oldCSS = globalThis.CSS;
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: (id: string) => id },
  });
  t.after(() => {
    if (oldCSS) Object.defineProperty(globalThis, "CSS", { configurable: true, value: oldCSS });
    else Reflect.deleteProperty(globalThis, "CSS");
  });
  const scroller = {
    scrollTop: 0,
    scrollHeight: 4000,
    clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0 }),
  };
  let anchorTop = 800;
  const anchor = { getBoundingClientRect: () => ({ top: anchorTop - scroller.scrollTop }) };
  const canvas = Object.assign(new EventTarget(), {
    querySelector: (selector: string) => (selector.startsWith("[id=") ? anchor : scroller),
  });
  const stop = restoreScroll(canvas as unknown as HTMLElement, {
    top: 0,
    anchor: "diff:clicked.ts",
    offset: -80,
  });
  t.after(stop);
  assert.equal(scroller.scrollTop, 720);
  await new Promise((resolve) => setTimeout(resolve, 100));
  anchorTop = 1800;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    anchor.getBoundingClientRect().top,
    80,
    "the clicked header remains below the toolbar as preceding diffs load",
  );
});

test("anchor resize tracking survives slow loading and yields immediately to manual input", async (t) => {
  const oldCSS = globalThis.CSS;
  const oldObserver = globalThis.ResizeObserver;
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: (id: string) => id },
  });
  let resize = () => {};
  let disconnected = false;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = () => {
        if (!disconnected) callback();
      };
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  } as unknown as typeof ResizeObserver;
  t.after(() => {
    if (oldCSS) Object.defineProperty(globalThis, "CSS", { configurable: true, value: oldCSS });
    else Reflect.deleteProperty(globalThis, "CSS");
    if (oldObserver) globalThis.ResizeObserver = oldObserver;
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });
  const scroller = {
    scrollTop: 0,
    scrollHeight: 6000,
    clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0 }),
  };
  let top = 800;
  const anchor = { getBoundingClientRect: () => ({ top: top - scroller.scrollTop }) };
  const canvas = Object.assign(new EventTarget(), {
    querySelector: (selector: string) => (selector.startsWith("[id=") ? anchor : scroller),
  });
  const stop = restoreScroll(canvas as unknown as HTMLElement, {
    top: 0,
    anchor: "diff:slow.ts",
    offset: -80,
  });
  t.after(stop);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  top = 2800;
  resize();
  assert.equal(
    anchor.getBoundingClientRect().top,
    80,
    "a slow diff completing after the retry window keeps the file anchored",
  );
  canvas.dispatchEvent(new Event("wheel"));
  scroller.scrollTop = 1000;
  top = 3800;
  resize();
  assert.equal(scroller.scrollTop, 1000, "the observer cannot override manual scrolling");
  assert.equal(disconnected, true);
});
