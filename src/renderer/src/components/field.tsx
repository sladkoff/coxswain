import type { ComponentProps } from "react";
import { cn } from "./styles";

const field =
  "rounded-md border border-neutral-300 bg-transparent outline-none focus:border-neutral-500 dark:border-neutral-700";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(field, "px-3 py-1.5", className)} />;
}

// Enter submits, Shift+Enter adds a line, Esc cancels.
export function TextArea({
  onSubmit,
  onCancel,
  className,
  ...props
}: Omit<ComponentProps<"textarea">, "onSubmit"> & { onSubmit: () => void; onCancel?: () => void }) {
  return (
    <textarea
      {...props}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel?.();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
      className={cn(field, "resize-none p-1.5", className)}
    />
  );
}
