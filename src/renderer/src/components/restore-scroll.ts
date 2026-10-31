export const cancelScrollRestore = (canvas: HTMLElement) =>
  canvas.dispatchEvent(new Event("review-scroll-cancel"));

export type Scroll = { top: number; anchor?: string; offset: number };
export const canvasElement = (canvas: HTMLElement, id: string) =>
  canvas.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
export const canvasScroller = (canvas: HTMLElement) =>
  canvas.querySelector<HTMLElement>(":scope > .overflow-auto:not(.hidden)");

// Restore before paint when ready, and retry as virtualized cards acquire their final heights.
// Anchored navigation follows later content resizes until user input or navigation cancels it.
// Numeric restores retry up to two seconds while virtualized content arrives.
export function restoreScroll(canvas: HTMLElement, saved: Scroll) {
  let tries = 40;
  let timer: ReturnType<typeof setTimeout>;
  let observer: ResizeObserver | undefined;
  const events = ["wheel", "touchstart", "pointerdown", "keydown", "review-scroll-cancel"] as const;
  const stop = () => {
    clearTimeout(timer);
    observer?.disconnect();
    events.forEach((event) => canvas.removeEventListener(event, stop));
  };
  const go = () => {
    const scroller = canvasScroller(canvas);
    const anchor = saved.anchor ? canvasElement(canvas, saved.anchor) : null;
    const ready = saved.anchor
      ? anchor
      : scroller && scroller.scrollHeight - scroller.clientHeight >= saved.top;
    if (!ready && tries-- > 0) {
      clearTimeout(timer);
      timer = setTimeout(go, 50);
      return;
    }
    if (saved.anchor && !anchor) {
      if (!observer) stop();
      return;
    }
    if (!scroller) return stop();
    const by = anchor
      ? anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + saved.offset
      : saved.top - scroller.scrollTop;
    if (!saved.anchor && Math.abs(by) < 2) return stop();
    if (Math.abs(by) >= 2) scroller.scrollTop += by;
    if (tries-- > 0) {
      clearTimeout(timer);
      timer = setTimeout(go, 50);
    } else if (!observer) stop();
  };
  events.forEach((event) => canvas.addEventListener(event, stop, { passive: true }));
  if (saved.anchor && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(go);
    const scroller = canvasScroller(canvas);
    if (scroller) observer.observe(scroller.firstElementChild ?? scroller);
  }
  go();
  return stop;
}
