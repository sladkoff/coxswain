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
        if (e.key === "Escape") onCancel?.();
        if (e.key === "Enter" && (long ? e.metaKey : !e.shiftKey)) {
          e.preventDefault();
          onSubmit();
        }
      }}
      className={cn(bare ? "bg-transparent outline-none" : field, "resize-none p-1.5", className)}
    />
  );
}
