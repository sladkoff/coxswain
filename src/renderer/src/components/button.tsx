import type { ComponentProps } from "react";
import { cn, muted, selectable } from "./styles";

const variants = {
  default:
    "rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800",
  primary:
    "rounded-md bg-neutral-900 px-2.5 py-1 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300",
  // Icon buttons and quiet actions in bars and headers: no border, darkens on hover. Callers set the padding.
  ghost:
    "rounded hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
  link: "underline",
};

export function Button({
  variant = "default",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return <button {...props} className={cn(variants[variant], "disabled:opacity-50", className)} />;
}

// Buttons joined into one, like shadcn's ButtonGroup: e.g. an action and a chevron for its menu of alternatives.
export function ButtonGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="group"
      {...props}
      className={cn(
        "flex [&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
        className,
      )}
    />
  );
}

// Shows or hides something, or picks a mode: filled while on.
export function ToggleButton({
  on,
  className,
  ...props
}: ComponentProps<"button"> & { on: boolean }) {
  return (
    <button
      {...props}
      aria-pressed={on}
      className={cn(
        "rounded px-2 py-0.5 disabled:opacity-50",
        selectable(on),
        !on && muted,
        className,
      )}
    />
  );
}

// One of a few options side by side, like a native segmented control.
export function SegmentedControl<T extends string | boolean>(props: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-md bg-neutral-100 p-0.5 text-xs dark:bg-neutral-800">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value)}
          className={cn(
            "rounded px-2 py-0.5",
            o.value === props.value ? "bg-white shadow-sm dark:bg-neutral-600" : muted,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
