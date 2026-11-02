import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export function mountWindow(element: HTMLElement) {
  element.dispatchEvent(new Event("window-content-mount"));
}

// A lightweight, measured shell preserves anchors while offscreen React subscriptions are released.
// Editors with text, a new annotation, or keyboard focus stay mounted until that state is cleared.
export function WindowedContent({
  children,
  estimate,
  force = false,
  sidebar = false,
  path,
}: {
  children: ReactNode;
  estimate: number;
  force?: boolean;
  sidebar?: boolean;
  path?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expandedContext = useRef(false);
  const height = useRef<number | undefined>(undefined);
  const previousEstimate = useRef(estimate);
  if (previousEstimate.current !== estimate) {
    height.current = undefined;
    previousEstimate.current = estimate;
  }
  const live = near || force || pinned;
  const latest = useRef({ live, force });
  latest.current = { live, force };
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const mount = () => flushSync(() => setNear(true));
    node.addEventListener("window-content-mount", mount);
    const viewport = node.closest(".overflow-auto, .overflow-y-auto");
    const observer = new IntersectionObserver(
      ([item]) => {
        if (item.isIntersecting) setNear(true);
        else {
          // Shadow DOM focus belongs to the host. Draft textareas live in light-DOM annotation portals.
          const editing =
            expandedContext.current ||
            node.contains(document.activeElement) ||
            !!node.querySelector('[data-window-pin="true"]') ||
            [...node.querySelectorAll("textarea, input:not([type=checkbox])")].some(
              (input) => (input as HTMLInputElement).value.length > 0,
            );
          setPinned(editing);
          setNear(false);
        }
      },
      { root: viewport, rootMargin: sidebar ? "400px 0px" : "1500px 0px" },
    );
    observer.observe(node);
    const resize = new ResizeObserver(() => {
      if (latest.current.live) height.current = node.getBoundingClientRect().height;
    });
    resize.observe(node);
    return () => {
      observer.disconnect();
      resize.disconnect();
      node.removeEventListener("window-content-mount", mount);
    };
  }, [sidebar]);
  useLayoutEffect(() => {
    if (live && root.current) height.current = root.current.getBoundingClientRect().height;
  });
  return (
    <div
      ref={root}
      data-window-content
      data-window-placeholder={live ? undefined : "true"}
      data-window-file={path}
      data-sidebar-file={!live && sidebar ? path : undefined}
      data-diff-pending={!live && !sidebar ? true : undefined}
      style={live ? undefined : { height: height.current ?? estimate }}
      onClickCapture={(event) => {
        if (
          event.nativeEvent
            .composedPath()
            .some((node) => node instanceof Element && node.hasAttribute("data-expand-button"))
        )
          expandedContext.current = true;
      }}
      onInputCapture={() => {
        if (!near) setPinned(true);
      }}
    >
      {live ? children : null}
    </div>
  );
}
