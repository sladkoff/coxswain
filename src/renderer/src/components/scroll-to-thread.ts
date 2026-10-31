import { canvasElement, canvasScroller } from "./restore-scroll.ts";

// Scrolls to a thread once it's drawn. The file diffs' Virtualizer draws only the lines near the viewport, so a thread
// further away isn't there yet: go to its file (or view section), page down it until the thread is drawn, then keep it in place until it
// holds (after a jump the Virtualizer applies a fix-up worked out for the old place, as in restoreScroll). Waits for the
// file while it loads; stops when the user scrolls, and is cancelled on navigation. ponytail: a screen per step, about
// a second per thousand lines of a long file; ask the library for the line's position if that's too slow.
export function scrollToThread(canvas: HTMLElement, containerId: string, threadId: number) {
  let timer: ReturnType<typeof setTimeout>;
  let steps = 200;
  let held = 0;
  const events = ["wheel", "keydown", "pointerdown", "review-scroll-cancel"] as const;
  const stop = () => {
    clearTimeout(timer);
    events.forEach((e) => canvas.removeEventListener(e, stop));
  };
  const go = () => {
    timer = setTimeout(go, 50);
    const scroller = canvasScroller(canvas);
    const file = canvasElement(canvas, containerId);
    if (!scroller || !file || !canvas.contains(file)) return;
    if (steps-- <= 0) return stop();
    const view = scroller.getBoundingClientRect();
    // The library keeps a thread's element while its lines aren't drawn, but without a box.
    const thread = canvasElement(canvas, `thread:${threadId}`);
    if (thread && canvas.contains(thread) && thread.getClientRects().length) {
      // A code row can contain several annotations, and its sibling can be the entire code grid.
      // Align the selected conversation itself so each thread has its own destination.
      const box = thread.getBoundingClientRect();
      const chrome = getComputedStyle(canvas);
      const clearance =
        (canvas
          .closest(".workspace-shell")
          ?.querySelector(".workspace-bar")
          ?.getBoundingClientRect().height || 44) +
        (parseFloat(chrome.getPropertyValue("--review-gutter")) || 24);
      const headerHeight =
        file.querySelector(".review-file-header")?.getBoundingClientRect().height ?? 0;
      const by = box.top - view.top - clearance - headerHeight - 24;
      if (Math.abs(by) < 2) return void (++held >= 4 && stop());
      held = 0;
      scroller.scrollTop += by;
      return;
    }
    // At its top (give or take a pixel, which scrollTop rounds away) or past it: page down.
    const f = file.getBoundingClientRect();
    scroller.scrollTop +=
      f.top > view.top + 2 || f.bottom < view.top
        ? f.top - view.top
        : Math.min(view.height * 0.8, Math.max(0, f.bottom - view.bottom));
  };
  events.forEach((e) => canvas.addEventListener(e, stop));
  timer = setTimeout(go);
  return stop;
}
