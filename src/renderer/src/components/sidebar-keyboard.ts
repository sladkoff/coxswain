import { mountWindow } from "./windowed-content";
import type { KeyboardEvent } from "react";
import { match } from "ts-pattern";

// Navigate primary rows only: review checkboxes and disclosure controls keep their own keyboard behavior.
export function sidebarKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return;
  if (!(event.target instanceof HTMLElement)) return;
  const current = event.target.closest<HTMLButtonElement>("button[data-sidebar-nav]");
  if (!current) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      "button[data-sidebar-nav], [data-window-placeholder]",
    ),
  ].filter(
    (button) =>
      !(button instanceof HTMLButtonElement && button.disabled) &&
      !button.closest("[inert]") &&
      button.checkVisibility({ checkVisibilityCSS: true }),
  );
  const index = buttons.indexOf(current);
  if (index < 0) return;
  if (event.key === " ") {
    const checkbox = current
      .closest("[data-sidebar-row]")
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox || checkbox.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) checkbox.click();
    return;
  }
  const next = match(event.key)
    .with("ArrowDown", () => Math.min(index + 1, buttons.length - 1))
    .with("ArrowUp", () => Math.max(index - 1, 0))
    .with("Home", () => 0)
    .with("End", () => buttons.length - 1)
    .otherwise(() => null);
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  let destination = buttons[next];
  if (destination.hasAttribute("data-window-placeholder")) {
    mountWindow(destination);
    const children = destination.querySelectorAll<HTMLElement>("button[data-sidebar-nav]");
    const button =
      next < index || event.key === "End" ? children[children.length - 1] : children[0];
    if (!button) return;
    destination = button;
  }
  destination.focus({ preventScroll: true });
  destination.scrollIntoView({ block: "nearest", inline: "nearest" });
  // Moving onto a folder/group only focuses it; arrows must not accidentally toggle it.
  if (next !== index && destination.dataset.sidebarNav === "open") destination.click();
}
