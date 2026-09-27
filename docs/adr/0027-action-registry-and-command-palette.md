# 27. The action registry and the command palette

Date: 2026-09-27

## Status

Accepted.

## Context

[UX](../UX.md) wants ⌘K everywhere, to switch to anything and to do anything (#10). What the user can do was spread
out: each native menu item sent an IPC event of its own (`open-quickly`, `toggle-navigator`, `navigate`,
`open-settings`), each with a listener in the preload and in `App.tsx`, and buttons called their handlers directly.
A palette listing actions needs them in one place, with names, shortcuts and whether they can run now. ADR 0004 still
wants native menus.

## Decision

1. **One registry of actions, in the renderer.** `App.tsx` builds the list each render: `Action` in
   `src/renderer/src/CommandPalette.tsx` has an id, a title, a shortcut to show, whether it's enabled, and what it
   runs. It lives where the state it needs lives, so each action sees the current state.
2. **Native menus stay, and run actions by id.** A menu item (and the ⌥⌘←/→ key hook) sends the one `action` IPC
   event with an id; the preload's `onAction` hands it to the registry, which runs it if enabled. Accelerators stay
   on the menu items, so the keys are the menu's. Buttons that match an action run it by id too.
3. **One palette, two modes.** ⌘K opens it with `>` typed: text after it finds actions. Without the `>` it finds
   files, which is Open Quickly (⌘⇧O). No second search box.
4. **Our own fuzzy match** (`src/renderer/src/fuzzy.ts`): a substring beats letters in order; in the file name, at a
   word's start and earlier are better. No dependency for ~30 lines.

## Alternatives considered

- **The registry in the main process, building the native menu from it.** One list for both, but most actions need
  renderer state (history, views, settings) to know whether they're enabled and what to do; mirroring that over IPC
  costs more than a menu item sending an id.
- **cmdk or a fuzzy library (fuse.js).** A dependency for a list and a scorer we write in a few lines; ADR 0004 already
  has us building our own controls until shadcn is set up.
- **A separate box for actions.** Two search boxes where VS Code and Zed users expect one with a `>` prefix.

## Consequences

- A new action is one entry in the list in `App.tsx`, and a menu item for it (if any) is `runAction("id")`.
- The native menu doesn't grey items out from the registry: only Back and Forward are greyed (via `setNavigation`);
  other menu items do nothing when their action is disabled.
- Actions exist only while the main screen's `App` has them; the palette opens only on the main screen.
