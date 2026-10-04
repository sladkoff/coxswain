import type { ComponentProps } from "react";
import { cn } from "./styles";

const field =
  "rounded-md border border-neutral-300 bg-transparent outline-none focus:border-neutral-500 dark:border-neutral-700";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(field, "px-3 py-1.5", className)} />;
}

// Enter submits, Shift+Enter adds a line, Esc cancels. `bare`: no border of its own, inside a box that has one.
// `long`: for longer markdown (a PR's description), Enter adds a line and ⌘Enter submits.
export function TextArea({
  onSubmit,
  onCancel,
  bare,
  long,
  className,
  onKeyDown,
  ...props
}: Omit<ComponentProps<"textarea">, "onSubmit"> & {
  onSubmit: () => void;
  onCancel?: () => void;
  bare?: boolean;
  long?: boolean;
}) {
  return (
    <textarea
      {...props}
      onKeyDown={(e) => {
        // The caller's own handling (a completion menu) goes first; preventDefault keeps the key from ours.
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Escape") onCancel?.();
        // Home and End go to the start and end of the text, as in a Mac text view, not of the line; with Shift, select.
        if ((e.key === "Home" || e.key === "End") && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          const t = e.currentTarget;
          const to = e.key === "Home" ? 0 : t.value.length;
          const from = t.selectionDirection === "backward" ? t.selectionEnd : t.selectionStart;
          if (e.shiftKey)
            t.setSelectionRange(
              Math.min(from, to),
              Math.max(from, to),
              to < from ? "backward" : "forward",
            );
          else t.setSelectionRange(to, to);
          t.scrollTop = to ? t.scrollHeight : 0;
        }
        if (e.key === "Enter" && (long ? e.metaKey : !e.shiftKey)) {
          e.preventDefault();
          onSubmit();
        }
      }}
      className={cn(bare ? "bg-transparent outline-none" : field, "resize-none p-1.5", className)}
    />
  );
}
