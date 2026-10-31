import { canvasScroller, type Scroll } from "./restore-scroll.ts";

// Capture an anchor that will survive the new reviewed-file filter, before React removes cards.
export function reviewFilterScroll(canvas: HTMLElement, showReviewed: boolean): Scroll | null {
  const scroller = canvasScroller(canvas);
  if (!scroller) return null;
  const viewport = scroller.getBoundingClientRect();
  const padding = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
  const readingTop = viewport.top + padding;
  const cards = [...scroller.querySelectorAll<HTMLElement>('[id^="diff:"]')];
  const current = cards.find((card) => {
    const rect = card.getBoundingClientRect();
    return rect.top <= readingTop && rect.bottom > readingTop;
  });
  const surviving = cards.filter((card) => showReviewed || card.dataset.reviewed !== "true");
  const next = surviving.find((card) => card.getBoundingClientRect().bottom > readingTop);
  const candidate = current && surviving.includes(current) ? current : (next ?? surviving.at(-1));
  // In Guide's explanation column the section, rather than a file card, owns the reading position.
  const section =
    !current &&
    [...scroller.querySelectorAll<HTMLElement>('[id^="view-section-"]')].find((section) => {
      const rect = section.getBoundingClientRect();
      return rect.top <= readingTop && rect.bottom > readingTop;
    });
  const anchor = section || candidate;
  if (!anchor) return { top: scroller.scrollTop, offset: 0 };
  const currentRemoved = current && !surviving.includes(current);
  return {
    top: scroller.scrollTop,
    anchor: anchor.id,
    offset: currentRemoved ? -padding : viewport.top - anchor.getBoundingClientRect().top,
  };
}
