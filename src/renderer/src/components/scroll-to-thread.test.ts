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
