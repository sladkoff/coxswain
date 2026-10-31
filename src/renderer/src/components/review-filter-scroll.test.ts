import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewFilterScroll } from "./review-filter-scroll.ts";

function fixture(
  t: { after: (cleanup: () => void) => void },
  cards: { id: string; top: number; reviewed?: boolean }[],
  sections: { id: string; top: number }[] = [],
) {
  const old = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (() => ({
    scrollPaddingTop: "80px",
  })) as unknown as typeof getComputedStyle;
  t.after(() => {
    if (old) globalThis.getComputedStyle = old;
    else Reflect.deleteProperty(globalThis, "getComputedStyle");
  });
  const element = (item: { id: string; top: number; reviewed?: boolean }) => ({
    id: item.id,
    dataset: { reviewed: String(!!item.reviewed) },
    getBoundingClientRect: () => ({ top: item.top - 1350, bottom: item.top - 1350 + 1200 }),
  });
  const scroller = {
    scrollTop: 1350,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: (selector: string) =>
      selector.includes("diff:") ? cards.map(element) : sections.map(element),
  };
  return { querySelector: () => scroller } as unknown as HTMLElement;
}

test("filtering reviewed cards above a surviving file preserves its reading offset", (t) => {
  const canvas = fixture(t, [
    { id: "diff:reviewed", top: 0, reviewed: true },
    { id: "diff:reading", top: 1200 },
  ]);
  for (const showReviewed of [false, true])
    assert.deepEqual(reviewFilterScroll(canvas, showReviewed), {
      top: 1350,
      anchor: "diff:reading",
      offset: 150,
    });
});

test("hiding the current reviewed file chooses the next surviving card", (t) => {
  const canvas = fixture(t, [
    { id: "diff:removed", top: 1200, reviewed: true },
    { id: "diff:next", top: 2400 },
  ]);
  assert.deepEqual(reviewFilterScroll(canvas, false), {
    top: 1350,
    anchor: "diff:next",
    offset: -80,
  });
});

test("the previous surviving file is used when there is no next file", (t) => {
  const canvas = fixture(t, [
    { id: "diff:previous", top: 0 },
    { id: "diff:removed", top: 1200, reviewed: true },
  ]);
  assert.deepEqual(reviewFilterScroll(canvas, false), {
    top: 1350,
    anchor: "diff:previous",
    offset: -80,
  });
});

test("Guide prose preserves its section instead of jumping to a later file", (t) => {
  const canvas = fixture(
    t,
    [{ id: "diff:later", top: 2400 }],
    [{ id: "view-section-1", top: 1200 }],
  );
  assert.deepEqual(reviewFilterScroll(canvas, false), {
    top: 1350,
    anchor: "view-section-1",
    offset: 150,
  });
});
