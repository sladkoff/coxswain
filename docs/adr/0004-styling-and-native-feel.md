# 4. Styling and native feel

Date: 2026-09-23

## Status

Accepted

## Context

coxswain should feel native ([ADR 0002](0002-standalone-electron-app.md)). In Electron, the
contents of the window are a Chromium web page: the operating system's own controls, such as
buttons and inputs, are not available there. What Electron does offer is native menus, dialogs and
window features around the page, and system settings the page can read.

Well-regarded desktop apps built on web technology (Linear, VS Code, Slack, Notion) don't imitate
the operating system's controls. They have a consistent design of their own and follow desktop
conventions. Libraries that imitate macOS or Windows controls end up looking almost right, and
slightly wrong.

## Decision

- **Native where Electron offers it:** the app menu bar, right-click menus, file pickers, message
  boxes and notifications use Electron's native APIs, not HTML imitations.
- **Window frame:** a hidden title bar with the macOS window buttons kept in place
  (`titleBarStyle: 'hiddenInset'`), so the UI extends into the title bar.
- **Follow the system:** the system font (`system-ui`), light and dark mode from `nativeTheme` /
  `prefers-color-scheme`, the user's accent colour from `systemPreferences.getAccentColor()` as a
  CSS variable, and the reduced-motion and high-contrast settings.
- **Components: shadcn/ui with Tailwind.** shadcn/ui copies its components (built on Radix) into
  our repository, so we own and restyle them. Until it's set up, `src/renderer/src/components/`
  holds our own few controls, named and shaped like shadcn's so each can be swapped for its copy.
- **Desktop conventions**, applied throughout:
  - the default arrow cursor on buttons, not the pointing hand;
  - no text selection on buttons and toolbars, only on code and content;
  - no scrolling or bounce on the whole window, only in individual panels;
  - a denser layout than a website;
  - keyboard shortcuts for every command, shown in the menus;
  - no loading spinners for local work; show something immediately.
- **Code colours:** the Pierre libraries ([ADR 0003](0003-diff-view-and-file-tree.md)) use Shiki
  themes, which we pick to match coxswain's light and dark themes.

## Alternatives considered

- **React Aria Components** (Adobe). The strongest keyboard and accessibility behaviour, including
  desktop-style arrow-key navigation, type-ahead and selecting several items. Rejected as the
  default because shadcn/ui is more widely used and quicker to start with. We may use React Aria
  for individual components where shadcn/ui's keyboard behaviour falls short.
- **Libraries that imitate native controls** (macOS- or Windows-style React components). Rejected:
  they end up looking almost right, and slightly wrong, and would need to follow each operating
  system's design changes.
- **A fully custom design system from scratch.** Rejected: too much work before the product
  exists. shadcn/ui gives us components we own and can reshape.

## Consequences

- coxswain looks like its own app on every platform, not like a macOS or Windows app. Its native
  feel comes from menus, window chrome, system settings and desktop conventions.
- Native menus and dialogs live in Electron's main process, so the UI asks for them through the
  interface to the main process, like other native features. A web version needs HTML
  replacements for them.
- The desktop conventions above are easy to lose one component at a time. They belong in shared
  styles and in the components we copy from shadcn/ui, not in each screen.
