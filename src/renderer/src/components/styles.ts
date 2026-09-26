// Shared styling (ADR 0004): the tokens every screen uses, so a colour or a desktop convention changes in one place.

// ponytail: joins classes, no conflict resolution; add tailwind-merge (shadcn's cn) once callers override base classes.
export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')

export const muted = 'text-neutral-500'
// The lines between panes and around cards.
export const divider = 'border-neutral-200 dark:border-neutral-800'
// A row or toggle that can be the current one: filled while it is, a wash on hover while not.
export const selectable = (on: boolean) =>
  on ? 'bg-neutral-200 dark:bg-neutral-700' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
// The bar at the top of a pane or screen. It drags the window, so controls on it take noDrag.
export const titleBar = 'flex h-10 shrink-0 items-center [-webkit-app-region:drag]'
export const noDrag = '[-webkit-app-region:no-drag]'
