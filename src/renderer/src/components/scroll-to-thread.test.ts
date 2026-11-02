import { match } from "ts-pattern";
import { restoreScroll } from "./restore-scroll.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollToThread } from "./scroll-to-thread.ts";

test("threads sharing a code anchor still navigate to their own conversation", async (t) => {
  const oldCSS = globalThis.CSS;
  const oldStyle = globalThis.getComputedStyle;
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: (id: string) => id },
  });
  globalThis.getComputedStyle = (() => ({
    getPropertyValue: () => "24",
  })) as unknown as typeof getComputedStyle;
  t.after(() => {
    if (oldCSS) Object.defineProperty(globalThis, "CSS", { configurable: true, value: oldCSS });
    else Reflect.deleteProperty(globalThis, "CSS");
    if (oldStyle) globalThis.getComputedStyle = oldStyle;
    else Reflect.deleteProperty(globalThis, "getComputedStyle");
  });
  const scroller = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, height: 500 }) };
  const file = { querySelector: () => null };
  const sharedCode = { getBoundingClientRect: () => ({ top: 100 - scroller.scrollTop }) };
  const thread = (top: number) => ({
    getBoundingClientRect: () => ({ top: top - scroller.scrollTop }),
    getClientRects: () => [{}],
    assignedSlot: { closest: () => ({ previousElementSibling: sharedCode }) },
  });
  const first = thread(200);
  const second = thread(1200);
  const canvas = Object.assign(new EventTarget(), {
    closest: () => null,
    contains: () => true,
    querySelector: (selector: string) => {
      if (selector.startsWith(":scope")) return scroller;
      if (selector.includes("thread:1")) return first;
      if (selector.includes("thread:2")) return second;
      return file;
    },
  });
  for (const id of [1, 2, 1]) {
    const stop = scrollToThread(canvas as unknown as HTMLElement, "diff:file.ts", id);
    await new Promise((resolve) => setTimeout(resolve, 70));
    stop();
    assert.equal(
      (id === 1 ? first : second).getBoundingClientRect().top,
      92,
      `thread ${id} aligns below the toolbar instead of its shared code anchor`,
    );
  }
});

test("thread navigation takes over from an older file scroll restoration", async (t) => {
  const oldCSS = globalThis.CSS;
  const oldStyle = globalThis.getComputedStyle;
  const oldObserver = globalThis.ResizeObserver;
  const observers = new Set<() => void>();
  let queuedResize = () => {};
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: (id: string) => id },
  });
  globalThis.getComputedStyle = (() => ({
    getPropertyValue: () => "24",
  })) as unknown as typeof getComputedStyle;
  globalThis.ResizeObserver = class {
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      queuedResize = callback;
      observers.add(callback);
    }
    observe() {}
    disconnect() {
      observers.delete(this.callback);
    }
  } as unknown as typeof ResizeObserver;
  t.after(() => {
    if (oldCSS) Object.defineProperty(globalThis, "CSS", { configurable: true, value: oldCSS });
    else Reflect.deleteProperty(globalThis, "CSS");
    if (oldStyle) globalThis.getComputedStyle = oldStyle;
    else Reflect.deleteProperty(globalThis, "getComputedStyle");
    if (oldObserver) globalThis.ResizeObserver = oldObserver;
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });
  const scroller = {
    scrollTop: 0,
    scrollHeight: 4000,
    clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0, height: 500 }),
  };
  const file = {
    querySelector: () => null,
    getBoundingClientRect: () => ({ top: 500 - scroller.scrollTop }),
  };
  const thread = {
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ top: 1500 - scroller.scrollTop }),
  };
  const canvas = Object.assign(new EventTarget(), {
    closest: () => null,
    contains: () => true,
    querySelector: (selector: string) =>
      match(selector)
        .when(
          (value) => value.startsWith(":scope"),
          () => scroller,
        )
        .when(
          (value) => value.includes("thread:"),
          () => thread,
        )
        .otherwise(() => file),
  });
  t.after(
    restoreScroll(canvas as unknown as HTMLElement, {
      top: 0,
      anchor: "diff:file.ts",
      offset: -92,
    }),
  );
  t.after(scrollToThread(canvas as unknown as HTMLElement, "diff:file.ts", 2));
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(thread.getBoundingClientRect().top, 92);
  for (const callback of observers) callback();
  queuedResize();
  assert.equal(
    thread.getBoundingClientRect().top,
    92,
    "a virtualizer resize must not pull the conversation back to the old file anchor",
  );
});
