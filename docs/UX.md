# coxswain — UX

Direction for the main screen and navigation. Expected to change as we build; terms are defined in
[the glossary](context/coxswain.md). Open questions are listed at the end.

Diff change markers are 1 px wide. Collapsed unmodified-line separators have no filled background: muted labels sit between fine divider lines, with the existing gutter expand arrows.

## Layout

The app's Dock icon is an overhead glass rowing shell with three cyan/blue oar pairs on a midnight background.
The hull has fluid, softly tapered ends; the asymmetric paddle blades follow 45-degree axes. There is no orange
marker. The whole crew sits inside a continuous squircle with a light-catching perimeter, matching the visible
tile size of Mail and Finder. The paddle arrangement is centered vertically on the hull; rounded shaft ends overlap its sides slightly, leaving the boat’s center clear. A wider oar spread, stronger shafts and a fuller hull preserve the crew silhouette at small sizes.
The saved Icon Composer design supplies the geometry and glass materials for the static Electron exports
(ADR 0004); the window layout below is unchanged.

Canvas-first. The project picker and workspace tabs (L1) run across the top, with New workspace, the agent pane
toggle and Settings always in reach. Opening a workspace gives the diff or newest guide the primary area (L3).
The Navigator (L2) opens on the left at 336 points wide; chat (L4) is optional on the right and collapsed by default.
The main bar has a dedicated PR overview button. Submit Review floats at the main panel’s bottom-right, clear of both sidebars. One Settings dropdown holds display options and Settings. There is no inner canvas toolbar or bottom bar. Guide is the first/default Navigator tab, with threads nested below their sections in one scrolling list. The right sidebar holds Chat without a standalone header;
Submit Review floats at bottom-right.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ ●●● ▣ Project ▾  ( Workspace A │ Workspace B ) (+) (GitHub Preview Review ⚙ ▣) │
├────────────────┬───────────────────────────────────┬────────────────────────┤
│ Navigator (⌘B) │ Canvas                            │ Chat                   │
│Guide|Changes   │ Guide: text beside/above cards   │                        │
│ Files     ⋯    │                                   │                        │
│ Guide progress │ Files: file tabs                  │ Agent conversation     │
│                │        edge-to-edge whole file    │                        │
│ Nested threads │                                   │                        │
│ File + threads │ PR: description / checks / people │                        │
│                │                                   │                        │
│ History:Changes│                                   │                        │
└────────────────┴───────────────────────────────────┴────────────────────────┘
          ⌘K overlays the canvas; existing diagrams stay in place
```

The main workspace bar floats above the scrolling canvas. On macOS 26+ it uses native
Liquid Glass controls that sample the app's changes beneath them; the window itself is opaque. Other systems
use the web controls with in-page frosting. Reduce Transparency and high contrast use solid web controls.
Native controls stay visible and disabled while HTML dialogs or popovers are open (ADR 0042).
The canvas scrollport reaches the top of the window so changes pass beneath the workspace bar too. Initial
content padding and sticky headers clear the main bar: the toolbar height plus the same 24/40 px gutter used on the sides, both initially and when stuck. Navigation
and chat retain a 44 px top inset; the workspace bar uses native glass and controls across its full width.
Guide sections have 48 px between them; file cards have 32 px gaps. Explanation/card columns have 40 px between them on wide canvases.
Guide explanations use 15-point text with a 1.65 line height for slightly tighter reading. Guide sections place their heading, Reviewed control and explanation to the left of their file cards by default. The top Settings dropdown offers Section Descriptions → Beside Files / Above Files. Above Files stacks each section’s description over its full-width file cards and disables sticky description scrolling. The choice applies to all Guide sections for the current app session.
A muted, zero-padded section counter (01/05) sits below each authored section title, before its file count and Reviewed control.
The synthetic Not in the guide group is unnumbered.
The explanation stays sticky within its section, aligned with sticky card headers below the top bar; a long
explanation scrolls inside the space below the top bar, with 16 px right padding keeping overlay scrollbars off the text. The description becomes scrollable only while its explanation is stuck to the top. Its slim thumb appears only during scrolling and hides 700 ms after scrolling stops; the track stays transparent even on hover. The cards scroll beside it, then the next section
replaces both columns. There is no guide navigation sidebar or duplicate file overview.
At canvas widths below 960 px, sections stack their explanation above the cards and release the sticky text.
Sections without file cards use a centered column up to 800 px wide, with left-aligned text.
Guide text, file cards, sticky card headers and section text share the side-gutter spacing below the toolbar.
Every rendered Mermaid chart has a small muted expand icon in its top-right corner. It opens a large
preview, vertically centered on opening, with no toolbar: pinch on the trackpad to zoom around the pointer, and pan freely in either direction without scrollbar limits.
Supported Macs show a native Liquid Glass child panel sampling the app behind it; other systems and
Reduce Transparency/high contrast use a solid dialog. The preview clears the top bar by 12 px, uses a 16 px bottom inset and matching 24/40 px side gutters.
A small Close control or Escape dismisses the preview;
clicking away also closes it. The guide keeps its scroll position.

## Spacing

Shared desktop metrics keep related controls close and leave more space between groups. Values are app
defaults informed by Apple's layout guidance, rather than a universal Apple spacing specification.

| Area                                   | Spacing                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Related controls                       | 8–12 px gaps                                                                                              |
| Cards and inline comment content       | 16 px insets, 12 px corner radius                                                                         |
| Screen sections                        | 24 px gaps                                                                                                |
| Screens                                | 24 px insets, 32 px in wide windows                                                                       |
| Dialog header, search and action edges | 20 px aligned insets                                                                                      |
| Buttons / fields and list rows         | 28 / 32 px minimum height, growing with content                                                           |
| Review canvas                          | 24/40 px gutters, 16/32 px below-toolbar clearance, matching initial spacing; 32 px final content padding |

Guide sections, file cards and PR details share the review canvas clearances. Chat messages, thread
cards, attachments and composers use the same spacing scale. Settings controls and dialog actions wrap
when space is limited. Code lines and file-tree rows keep their compact reading density.

## Find

⌘F (Edit > Find… or the command palette) opens a Find bar under the last-used pane's header. Only one bar is
open at a time; canvas and chat remember separate queries for the window's lifetime. Enter / ⇧Enter or
⌘G / ⇧⌘G move forward and backward, wrapping at the ends. Escape or × closes Find and restores focus. Literal,
case-insensitive matching is the default, with an Aa toggle for Match Case. Matches are highlighted, the active
match more strongly, with its position and the total count beside the field.

- **Canvas:** searches all the files/file diffs in the selected range or view, in reading order, including
  files below the viewport. The bar says _Find in canvas_ and names the current match's file; with one file it
  names that file. File diffs include added and removed lines and shown context; split context counts once.
  Collapsed unchanged regions are excluded until expanded. Reviewed files hidden by the display setting are
  excluded. A whole file opened from Files or Open Quickly searches its full contents. View prose and diagrams
  are outside this initial code-search scope.
- **Agent pane:** searches the selected session's messages, code blocks, tool titles and comment/view cards.
  It excludes the unsent composer. A match in clipped card/tool text reveals the text; closing Find restores
  clipping. Streaming refreshes matches without scrolling the chat away from the selected result.

The bar shows _Searching…_ while off-screen file contents load, and reports unreadable files instead of implying
that a partial search is complete. Binary files have no searchable code. Next/Previous reveals the matching file
and line without changing the selected range, marking files Reviewed, or adding Back/Forward history entries.
Switching workspace, view, range or selected agent session clears that search's results. Scrolling and clicking
another file do not change the search scope.

Changes in list mode uses a 16-point left inset so top-level filenames have breathing room beside the sidebar edge.

## Background jobs

Comment-summary jobs continue without an Activity panel or toolbar item and report their result or error in the requesting thread. Guide generation uses its durable Chat session and reports progress in the Guide sidebar.

Settings starts with _Appearance_: a _System_ · _Light_ · _Dark_ segmented control and an independent _Soft Dark_ checkbox. The choice applies
immediately to the whole app and is kept across restarts; _System_ is the default. Soft Dark uses the
reference’s #1f2023 canvas, #28292c cards, muted dividers and #2a332f/#392d30 diff fills whenever the effective mode is dark, including when System follows a dark OS. Light mode ignores this palette preference without clearing it. Soft Dark is configured in Settings → Appearance alongside colour mode and Code Theme. Existing saved Soft Dark selections retain dark mode with the independent preference enabled.
A separate saved Code Theme selects Default (Pierre), One Dark (reference-like syntax), GitHub or Catppuccin.
Each theme provides light/dark variants; file-card surfaces still follow Appearance. A Python sample below
the picker previews hovered or keyboard-focused options without saving; leaving restores the saved choice. Both settings are also
available in the top Settings menu.

```text
Settings
  Appearance     [ System | Light | Dark ]  [✓] Soft Dark
  Code Theme     [ Default | One Dark | GitHub | Catppuccin ]
  GitHub account
  Guides         [ Agent ] [ Model ] [ Effort ]
  View prompts
  About
```

Settings has _Guides_: the agent (_Claude Code_ · _Codex_), model and effort from the installed agent’s native model menu (open a workspace to discover choices). Choices persist per agent. Guide defaults start with Claude Code and Opus 5.5; explicit per-agent choices remain configurable. The Guide sidebar’s dots menu begins with _Update Guide_, which forces regeneration for the current range through the background job runner; progress remains in the sidebar. File summaries, speculative summary generation and their coverage UI have been removed.

## Before the main screen

At startup the app checks for `git`, the GitHub CLI (`gh`, signed in) and Claude Code (`claude`) on its PATH. If any
is missing, a full-window screen lists each problem with the command that fixes it, the PATH it looked on, and
_Check again_; nothing else shows until all are there. Then, with no project yet, the welcome screen.

## Levels

- **L1 — Current project and its workspaces**, a horizontal tab bar above the canvas and optional panes.
  It leaves room for the macOS window buttons at its left, inset 16 px and centered vertically in the 44 px bar. The file sidebar control starts at 96 px,
  leaving more room after the window controls. The project picker shows the project's name and opens
  the native menu to switch or add projects. On supported Macs, workspace selection is rendered by a native
  SwiftUI workspace-button strip, with native project, New workspace, chat and Settings controls. Hovering a tab reveals a native close X; closing hides the tab and preserves its workspace.
  The command palette reopens closed tabs. Closed tabs remain closed across app restarts; reopening persists too, without deleting the workspace.
  The leading native sidebar button (⌘B) shows or hides the file sidebar. The existing code-aware file tree
  retains its keyboard navigation, selection and scroll state; indentation is 8 px per directory level
  with tighter row/outer insets, and foreground, selection and git colors follow Code Theme while surfaces follow Appearance; the sidebar has an edge-to-edge surface and
  a draggable divider. Its section selector has no duplicate hide button.
  New workspace has its own circular group immediately after the tabs, before the GitHub/preview/review/settings/chat group.
  The GitHub mark opens the PR externally. Preview opens the single live environment directly, or a native environment menu
  when several are available. Both slots remain in place, disabled when unavailable, to keep the tabs steady.
  The agent pane has no duplicate hide toggle; the main bar controls its visibility.
  The PR overview has its own toolbar button. Submit Review floats at the main panel’s bottom-right with compact padding and the pending-thread count. The old Review menu is removed; closed workspaces reopen through the command palette. Range selection belongs to the Changes Commits/Turns pane. The adjacent
  Settings dropdown groups canvas display options and Settings. Appearance, Soft Dark and Code Theme live in Settings → Appearance. File sidebar layout options live only in its dots menu.
  macOS owns selection and focus feedback. The active workspace has a glass capsule in the shared strip;
  the project picker and right-side actions have matching 32 px capsules. Minimum widths keep controls
  legible; when workspaces overflow, the active one stays visible; the command palette can switch to any workspace.
  Control-Tab / Control-Shift-Tab cycle workspaces; Command-1–8 select by position, Command-9 selects the last. Command-W closes the current tab. HTML dialogs keep the native glass bars visible and disable their controls;
  dialog bounds clear the bars. Other systems and accessibility fallback modes use the compact HTML tabs described below.
  Workspace tabs share a compact rounded strip, shrinking to fit the available space. All tabs have equal widths that stay stable when selection changes. The selected workspace
  gets a raised pill; inactive tabs use quiet separators. When their minimum
  widths no longer fit, the strip scrolls horizontally without a visible scrollbar; the selected tab is
  brought into view. Each shows its PR title (number or branch while offline), PR number, PR/branch icon and agent
  status dot (amber: waiting on permission, pulsing blue: working, green: done). The branch and full title are in
  the tooltip. Left/Right and Home/End switch tabs from the keyboard. Right-click offers _Remove Workspace…_,
  with the existing confirmation: comments, reviewed files and sessions are deleted, the worktree stays on disk.
  There is no workspace sidebar. New workspace (+), the chat toggle and Settings stay visible after the tabs.
  The rest of the screen belongs to the current project. _Add Project…_ opens the _Open a project_ dialog with
  search, _Add Local Repository…_, _New Project…_, existing projects and GitHub repositories. Esc or a click
  outside closes it. Local projects work without GitHub (ADR 0040).

  _New Workspace_ opens the _New workspace_
  dialog over the window, the project under its title, with one search field. It finds the repository's open PRs (by
  title, number, author or branch), each with a PR icon (grey for a draft), its title, `#number · author · branch`,
  when it was updated, and _Has a workspace_ if it does; and its branches on GitHub without an open PR (the default one
  and those with a workspace marked), where picking one works on it as it is there. What's typed that isn't a branch
  gets a row _New branch `name`_, spaces made dashes (`some improvement` → `some-improvement`), with _from_ and the
  branch it starts from (the default one; a native menu picks another) and _Create_ (or Enter, when nothing was found);
  a name git won't take is refused under the field. Opening a
  PR whose branch has a workspace makes that workspace the PR's, and so does opening a branch workspace once GitHub
  has a PR for its branch. While the project is being cloned, its initial pulses.

- **L2 — Navigator**, on the left of the canvas, under its own bar, as wide as it. Hidden at first; the panel button
  at the canvas bar's left, _View > Toggle Navigator_ or ⌘B shows it, and the same button at its bar's left hides it
  (it comes back as it was). Its border can be dragged. A segmented control in its
  bar switches between _Guide_ (a numbered list of the current guide’s section titles), _Changes N_ (N the number of changed files), the changed files as a tree with their status and
  +/− lines, and _Files_, the whole file tree of the workspace, with folders that contain changes marked. The pane's
  bottom pane shows _Commits_ or _Turns_ (below), switched by a segmented control in its own bar; the chevron there
  collapses it to that bar, at the pane's bottom, and picking _Commits_ or _Turns_ expands it again.
  Selecting Guide opens the current guide (or newest available view), and clicking a title jumps to that section with clearance below the glass toolbar. Section picks and the sidebar tab are router locations, so Back/Forward restores them. Without a view, Guide says _No guide sections_.
  Drag the horizontal divider above its bar to resize it vertically; both lists keep at least 96 px. The divider
  also takes Up/Down keys (10 px, or 50 px with Shift). The height is shared by Commits and Turns and retained while
  collapsed or hidden; its height and pane widths persist across restarts. Both lists come from the worktree, so _Changes_ shows the PR's file diffs and local changes (e.g. an
  agent's) together, a file with local changes marked with an amber ● after its +/− lines, and reloads after each
  turn. Reviewed files follow the global _Hide Reviewed Files_ setting in the top bar. When every changed file is reviewed and hidden, Changes shows a centered, muted _All N files reviewed_ state.
  The small, muted ⋯ menu beside Changes/Files holds _Files as Tree_ or _Files as List_ (a flat list, each file's folder dimmed next to its +/−
  lines). A changed file with open threads (yours, and the agent's while its view shows) shows a speech bubble after its +/−
  lines (hovering says how many of each kind). Selecting a file in _Changes_ scrolls the canvas to its file diff; selecting one in _Files_ shows the whole
  file in the canvas, until the control goes back to _Changes_.

  _View > Command Palette…_ (⌘K) opens the command palette over the window, starting with `>`: typing after the `>`
  finds an action by name (fuzzy, best match first, its shortcut on the right), ↑/↓ pick, Enter runs it. Without the
  `>` it finds files: _File > Open Quickly…_ (⌘⇧O), or the magnifier left of the canvas bar's display options, opens it that way.
  Typing filters the worktree's files by path (fuzzy: a match in the file name, then elsewhere, then its letters in
  order), and Enter navigates to the file already displayed in Guide or Changes when available. Otherwise it opens the file in _Files_, with the file selected and its folders open. Esc or a click outside closes it. Actions it lists: Back and Forward, show or hide the Navigator and Commits,
  show the diff or a view, each New View, Unified or Split diffs, show or hide reviewed files, open a workspace, New
  Workspace, switch project, Add Project, Settings. Actions that can't run now (Back at the start) aren't listed.

  _View > Back_ (⌥⌘←) and _View > Forward_ (⌥⌘→), or the chevrons in the canvas bar, step through what the canvas
  showed (ADR 0025): each whole file opened (from _Files_, Open Quickly, Go to Definition or Find Usages), each file
  picked in _Changes_, each switch between _Changes_ and _Files_, each commit or view picked, and each workspace opened;
  Back into another workspace's step opens that workspace again. Picking a workspace tab restores its
  last canvas selection and scroll, with one loading state for an uncached destination. Reviewed files do not briefly
  appear before the review state loads. Each step comes back scrolled where it was left, the
  file diffs by the one at the top. The keys work wherever the focus is, the Navigator included; the menu items and
  chevrons are greyed out at either end.

  _Commits_ in the bottom half's bar lists, under the Navigator: _All Changes_, then
  _Uncommitted changes_ while the worktree has any (its files and lines added and removed; picking it shows only them,
  live, as the scope _Uncommitted_), then the PR's commits (and local ones on top, marked _not pushed_), newest first, each
  on two lines: its subject (and _merge_ for a merge commit), then its short sha, author (_+N_ for co-authors), how
  long ago, and its lines added and removed. Its tooltip has the whole message, the author's email and date,
  co-authors, who committed it if someone else, and how many files it changed. Picking a commit shows its commit diff
  on the canvas. _Turns_ shows, the same way, _All Changes_ and then the agent turns that changed the worktree, newest
  first: the turn's first message over the agent that ran it (_Claude Code_, _Codex_; _Agent_ for turns from before
  that was recorded), how long ago, and its lines added and removed. Picking one shows its turn diff (glossary); the
  _Diff_ tab's range then names the commit or _Turn: …_, with ✕ back to all changes. At the top of _Commits_, how many
  commits aren't pushed, with _Push_ (confirmed; never forced) or, for a branch workspace without a PR, _Open Pull
  Request…_ (confirmed: pushes, opens a draft PR into its base branch and shows it in the browser). A push that fails
  says why there.

  **Range.** The _Diff_ tab carries what the diff shows, always, a view showing or not, so the chips after it never
  move: the scope (glossary) _All_, _PR_ (_On GitHub_ for a branch without a PR), _Not Pushed_ or _Uncommitted_, or the
  commit or turn picked. Clicking it opens a native menu: _All Changes_, then the layers that add up to it, each with
  how much it has and greyed out when it has nothing: _In the PR (3 commits)_ (_On GitHub_), _Not Pushed (2 commits)_
  and _Uncommitted (4 files)_; then _Commit…_ and _Agent Turn…_, which show the commits or the turns. Picking a scope
  shows the diff. _PR_ and _Not Pushed_ are pinned like a commit; _Uncommitted_ is live.

- **L3 — Canvas.** File diffs appear as separate rounded cards, with a border and their own background over a
  quieter canvas surface. The diff, guide-embedded files and whole-file canvas share the same card edge.
  The canvas content leaves 80 px above the first card and 96 px below the last, so overlay controls do not
  hide the first or final lines; cards have 24 px between them and 16 px side gutters
  (32 px in wide windows). File headers and Reviewed controls stay inside the cards; the shared header keeps its rounded top corners and border while sticking below the
  main toolbar, with code scrolling behind it. The header masks code above it within its own card; corner masks
  retain the rounded edge. Completed cards pass behind the glass toolbar. No animated clip follows scrolling.
  The header and code body draw one card outline; the outer clipping wrapper has no border of its own.
  Card outlines and header separators use a subtle 0.5 px hairline with a low-contrast neutral colour.
  Generated guide charts and diagrams use that same border and the cards' 12 px corner radius.
  Diagrams use 15 px system typography, neutral rounded nodes and quieter connectors with room
  between nodes and sequence messages. Charts use a coordinated colour palette and readable axes/legends.
  Flowcharts follow the supplied Codex reference: dashed rounded decision nodes and pill-shaped edge labels.
  Guide diagram cards have 24/32 px internal padding and a solid surface in both themes.
  Inline comment drafts and comment/agent thread cards share that outline too, with a raised gray surface, compact 12-point padding and 8-point gaps. Human entries keep a plain surface; agent replies, including streaming replies, use a slightly darker inset background with 16-point padding and an Agent label. Messages have 12-point gaps and no divider between speakers; the inset agent surface separates them. Composer fields and inset agent replies use the same 12-point radius as the cards. Composer fields have 8-point text insets and a visible outline and compact one-line minimum. Inline threads omit the redundant line header; the anchor remains accessible, with Resolve and a single ⋯ menu on the first human author row (or first entry for an agent-authored thread). The area around the message card matches the diff background. Threads grow with their content and use the main canvas scrollbar, without an internal scrolling region. The composer uses icon-labelled Agent/Comment choices and a circular up-arrow send control.
  Opaque corner cutouts hide diff colours at the rounded top; the bottom outline remains above the sticky header.
  Both use shared SVG arcs for smooth antialiased edges, with no gradient-stop approximation of the curve.
  Guide headings, prose and diagrams have more vertical space, with 15 px prose at a readable line height.
  The pane bars are 44 px high. These spaces separate review units while code lines retain their existing density.
  All file diffs of the workspace follow one another, to scroll through. The display options (sliders)
  in its bar open a native menu: _Unified_ or _Split_ file diffs and the Navigator's _Files as
  Tree_ or _Files as List_; off, reviewed file diffs are hidden, and
  when all are, the canvas shows a centered, muted _All N files reviewed_ message, matching the sidebar. A file diff's header uses the same muted label styling as a guide section for its _Reviewed_
  checkbox.

  **Go to Definition.** Holding ⌘ over a name or an import path in a file diff or a whole file underlines it;
  ⌘-click shows the file where it's defined on the canvas, scrolled to that line and with the line selected, and the
  Navigator on _Files_. The file's language server answers (ADR 0034), at the side clicked: the old side of a file diff
  asks about the base, so a result there opens that file as it was at the base. With several definitions (e.g.
  overloads), a native menu lists them (file, line and the line's code) to pick one. Right-clicking a name opens a
  native menu with _Go to Definition_ and _Find Usages_; _Find Usages_ lists every reference the language server
  finds in the same kind of menu (the first 30, then _N more_), and picking one shows it the same way. The menu shows
  even for one line, and says _No usages found_, _No definition found_ or, in a file no language server takes (so far only
  TypeScript, JavaScript and Python), _No language server for .go files_.

  **Threads.** The workspace's entries (glossary) go between the lines wherever their lines are, unchanged, in the
  range on screen, having moved with lines added above them. One outdated there (its own commit diff) says so after
  its lines. The header says _N outdated_ for the file's outdated threads that aren't, and a click shows them above
  the file diff with the code they were about (_Then_) and what stands there now (_Now_). Hovering a line shows a `+` in the gutter; clicking it (or dragging it over a range)
  opens a comment box: an accessible line label, ✕ at its top right to cancel (or Esc), an outlined text area, and at the bottom right
  a _Comment_ / _Agent_ toggle and a send button (Enter; Shift+Enter adds a line). The toggle is one global
  preference, kept across boxes and restarts. Sending starts a **thread** between the lines, and the toggle decides
  which kind for good: _Comment_ a **comment thread**, what the review says to the PR's author; _Agent_ an **agent
  thread**, for exploring or changing the code with the agent. The agent's explanations and findings start agent
  threads too. Replies have no mode switch: an agent thread sends replies to the agent, and a comment thread keeps replies as comments. With a PR, a box on _Comment_ (a new comment thread, or a reply in one) has
  a _Post to GitHub_ checkbox on its left, one global preference like the toggle: on, sending posts the comment to the
  PR at once as plain discussion, no review (on its lines, or in the PR's conversation); off, it waits for _Submit Review_. A post that fails leaves the comment here and
  says why in a sheet. Own comments show the signed-in author’s avatar and name (or _You_), and a relative timestamp, and the agent's
  answers _Agent_.

  In a comment thread, a comment is a note. In an agent thread, on _Comment_ it's a note for the agent, sent with the
  next question; on _Agent_ it's a question: a turn in the agent pane's agent session
  (ADR 0021), which shows it as a card (_Comment on `path:lines` sent to Agent_, the comment, and _View thread_,
  which scrolls the canvas to the thread). The agent is given what it hasn't seen of the thread: in the session its last
  question went to, the notes since; in any other (a new session since, or the other agent), the lines and the whole
  thread so far: the reply streams into the thread, with each tool used as one line, and is kept as an
  answer when the turn ends. A tool use auto mode would block stops the turn with a permission prompt in the thread:
  what the agent wants to run and the agent's options (_Yes_, _No_, sometimes _Always_); the turn carries on once one
  is picked, or ends with _Stop_. A question asked while the session's turn runs queues behind it: the thread says
  _Queued_ instead of _Working…_, and _Don't Send_ in place of _Stop_ takes it off the queue. A question taken off,
  there or with × in the agent pane, becomes a note again, so _Send to Agent_ can send it later. Stop on a thread
  stops only its own turn.

  The first human message’s author row has a ✓ to resolve the thread: the thread folds to its header (_Resolved_ and its first comment), is
  left out of _Submit Review_, and the ✓, green now, reopens it. Right of it, a ⋯ button with a native menu:
  _Delete Thread_ (after a confirmation; the user's comments posted from it are deleted on GitHub too; off, as
  _Delete Thread (others have replied)_, while others' comments are in it, since GitHub keeps those), _Open on
  GitHub_, and in an agent thread _Send to Agent_, which makes the thread's latest note a question, with the notes
  before it since the last question (the answer comes in the thread), and _Summarize as Comment_. That one has the
  summary model write the review comment the thread comes to: _Summarizing as a comment…_ under the thread, then the
  comment in a box to edit (or _Nothing in this thread is left for the PR's author._, with _Write One_ and _Dismiss_),
  under _A new comment on these lines, for the review_, with _Cancel_ and _Save_ (_Save and
  Post_ while _Post to GitHub_ is on); saving adds it as a comment thread on the same lines or passage.

  Each of the user's own comments has its own ⋯ at the right of its author row. The first human message’s menu also holds thread actions, including _Summarize as Comment_. _Edit_ is offered only in comment threads (in place; _Save Here and on GitHub_
  once posted), _Delete_ (after a confirmation; on GitHub too once posted), _Open on GitHub_. Deleting a thread's first
  comment takes the thread with it here, as on GitHub, which keeps the rest for its replies: the next read brings them
  back as a thread of their own, and the user's unposted notes stay as a thread on the same lines. Thread navigation lands on the commented line above the conversation, regardless of response length. Selecting a resolved thread expands its conversation for inspection without changing its resolved status. The collapsed thread summary can also expand it; reopening remains an explicit action. A failed edit,
  delete, resolve or summary says why under the thread.

  **Threads on a view's prose** ([ADR 0036](adr/0036-threads-on-view-prose.md)). Right-click on text selected in a
  view's prose (or on a paragraph, list or table, for all of it) and pick _Comment_: the same comment box opens after
  that block, with the passage quoted at its top and highlighted in the text. The thread stays there, the passage
  highlighted until it's resolved. If the agent rewrites the section, the thread goes outdated and moves to the top of
  the section. The threads list shows these threads under the view's title, each with its section (_§ 2_).

  **Guide and threads.** The left Navigator defaults to Guide. Its rows are left-aligned and show the section number and a semibold title, with file and added/deleted line totals only for sections with files; sections without files show muted No files subtext. Threads appear beneath their section, grouped under a single filename (or Section discussion), in the same scrolling list. Each thread uses two compact lines: a plain-text preview without markup, then status and one total reply count (human and agent follow-ups combined), without colored dots; line numbers are omitted. Section file/diff counts sit directly below the title without an extra gap; unmatched threads appear under Other threads. Guide sidebar sections have 8-point gaps with aligned title, file and avatar columns. Sections connect to file rows with subtle tree branches with slanted connectors, a softly curved last join and no extra gap between file rows. The vertical branch starts just below the section number. Thread rows use softly bordered 12-point pills beneath their file, with small gaps between pills. File rows sit directly on the sidebar background, with Pierre’s language/file-type icons, a filename and per-file added/deleted totals. A muted directory appears only to disambiguate duplicate filenames and truncates in the middle to preserve its ending; deleted filenames are struck through. Selecting a file expands its card even if reviewed, without changing its Reviewed mark or expanding other reviewed cards, and aligns its header below the toolbar. By default Guide lists all changed files, including reviewed files and files without threads. The header’s ⋯ menu offers Only Files with Threads, which respects the current thread filters. Hide Reviewed Files excludes reviewed files and their nested threads. Guide file rows have a right-aligned native Reviewed checkbox, aligned with the section checkbox column. Clicking the filename navigates; clicking the checkbox only changes review state. The menu also independently includes Agent Threads and Comments. An Authors submenu independently includes or excludes each thread author. Human authors are included by default, bot authors excluded using GitHub’s actor type (with bot-login suffix fallback); Show All Authors includes everyone. Explicit author choices override these defaults. Thread previews show the author’s avatar, with a person icon fallback. The header’s muted ⋯ menu has a Hide Resolved Threads checkbox: off (the default) includes open and resolved threads; on lists only open threads. Sections without matching threads simply have no thread rows; there is no No open threads message or show-resolved button in the list. Show Threads opens the left sidebar on Guide. Changes explicitly shows the raw diff, while Guide opens the current or newest guide. The right sidebar holds only Chat, starts directly below the glass toolbar without a standalone header, and keeps its width divider. Prompt attachments and review work open Chat; review sending errors appear in Guide.

  Review → _Submit Review N_ (N the open comment threads; on with open comment threads or a PR) opens a dialog, like GitHub's
  _Finish your review_. Agent threads aren't in it. The comment threads, compact: a checkbox, where it is and its first
  comment (a click closes the dialog and shows the thread), how many entries it has and what posting does with it
  (_comment on the lines_, _in the conversation_, _reply_, _resolve_ or _reopen_, _on GitHub already_), and under it
  each of its comments not on GitHub yet in a box to edit, which edits the comment. With none, it says _No open comment
  threads. Agent threads become one with Summarize as Comment._ At the bottom, with a PR, a summary for the review and
  _Comment_ · _Approve_ · _Request Changes_ (not on your own PR), then three buttons. _Copy as Prompt_ puts the picked
  threads on the clipboard as the message the agent would get (the bar says _Copied_). _Send to Agent_ sends them in
  one message to the agent pane's session: where each points, the code and its comments, asking the agent to make the
  changes and answer what's open; the chat shows it as a card (_Review sent to Agent · N threads_) and the bar says
  _Agent working on N threads_ until the turn ends. _Post to GitHub…_ (only with a PR) asks, then posts the picked
  threads' comments as written: those on the PR's diff in one review, the others as comments in the PR's
  conversation, led by a permalink GitHub shows as the highlighted code. If the user has a review in progress on
  GitHub, it asks again first: _You have a review in progress on this PR on GitHub_, with how many comments it has,
  and _Add and Submit_; nothing is posted without it. The dialog closes once posted. Every posted comment is linked:
  replies there show in its thread, edits and deletes go both ways, and threads on the diff resolve with GitHub's.

  **Threads from GitHub** ([ADR 0037](adr/0037-pull-request-sync-and-posting.md)). A PR's review threads show between
  the lines like any thread, their header saying _on GitHub_, each comment under its author (_@ana on GitHub_). Replies
  are the user's comments, posted as written; the user's own comments there, wherever written, are theirs to edit and
  delete, and _Open on GitHub_ is in the ⋯ menu. Resolving one goes to GitHub at once while _Post to GitHub_ is on, else with the next _Submit Review_; the ✓'s tooltip says which. A comment posted from
  here says _posted_.

  **The PR panel.** The PR's chip in the canvas bar (_#12_, a dot for its checks: green, red, amber running, grey)
  shows the PR in the canvas in place of the diff; any other pick leaves it. It is laid out like the PR's page on
  GitHub. At the top: the title, its state, who merges what into what, _Open on GitHub_. Under it two columns, the
  side one going under the main one in a narrow canvas. The main column, from the top: the description, a card with
  _Edit_ (⌘Enter or _Save to GitHub_). _Conversation_: comments, reviews' verdicts and summaries, and comments on whole
  files, oldest first, a card each. _Checks_: the head's failing and running
  ones, each with _Details_, the rest folded under _12 passed, 3 skipped_; a failing one has _Send to Agent_, which
  sends it with the end of its log to the agent pane's session (a card in the chat); under them _Ready for Review_ (a
  draft) or the merge state and _Merge…_ (a menu of the repository's merge methods, then a confirmation). Last, _Add
  a comment_: a box and _Comment on GitHub_. The side column: _Reviewers_ with where they are, _Assignees_ with
  _Assign yourself_, _Labels_. The Commits pane shows
  each pushed commit's checks as a dot before its sha.

  **Guide.** Each workspace has one Guide and a durable Guide Chat session, generated on opening and updated in place as changes move. Guide in the sidebar opens it; Changes shows the raw diff, and Files browses the worktree. The Guide dots menu’s Update Guide opens a dialog with optional focus/style instructions and Cancel / Update Guide. Instructions are remembered for that workspace and reused for automatic updates, taking precedence over the default focus, style and section structure while retaining complete file coverage; blank text restores the standard concise Guide. Existing content remains readable during generation, and progress appears in the Guide sidebar. There is no saved View list, New View action or saved prompt library.

  The view shows its sections in order, each with its heading, how many file
  diffs it embeds and a _Reviewed_ checkbox that marks them all (ticked once all are; unticking unmarks them all), then its markdown (ADR 0026): prose, tables, mermaid diagrams, and embedded file diffs, which work
  as in the diff (threads, _Reviewed_), reviewed cards are completely hidden when _Hide Reviewed Files_ is enabled, while section explanations remain visible. The global option lives only in the top Settings dropdown and applies to Changes, Guide and both sidebars across all workspaces and windows. Marking a file Reviewed scrolls the next unreviewed file into focus, skipping reviewed files; the last unreviewed file leaves the scroll position alone. Each section uses an explanation
  column beside its embedded file cards, without a separate file overview or navigation sidebar. Text remains
  sticky within the section; long explanations scroll below the top bar. Below 960 px of canvas width,
  the explanation stacks above the cards without sticky positioning. Prose-only sections span the canvas.
  Text is at most 72 characters wide; diagrams and tables use the explanation column's width, diagrams on cards.
  A diagram that doesn't parse shows its code and error. Files in no section appear last under _Not in the guide_.
  Muted file diffs and sections of only those are low-lighted; the heading says why. Explanations (labelled _Explanation_) and, with review,
  findings (labelled _Finding_) are threads between the lines, which can be replied to like any other. A view shows the changes as they were, local ones included (pinned to a snapshot, like a
  commit), and its _Reviewed_ ticks stay; once the worktree has moved on (new commits or edits), an amber bar says so. Picking a commit hides the view, and the other way round.

- **L4 — Agent pane**, right of the canvas; its border can be dragged. The speech-bubble button at its header's left
  hides it. The persistent speech-bubble button in the workspace tab bar toggles it, as does
  _Show or Hide the Agent Pane_ in the command palette. It defaults to collapsed; an explicit choice is kept
  across restarts. A turn that
  fails because the agent is signed out (an expired login) shows _Sign In to Claude Code_ (or _Codex_) under its error:
  it opens the agent's login in the browser, says _Finish signing in in your browser…_ meanwhile, and clears the error
  once signed in; the message can then be sent again. A chat with one of the
  workspace's agent sessions: the current one, the one last used (made, picked in the header or sent a message),
  also after a restart. Picking one makes it current, so comments from the canvas go to the session shown. The header starts with the session's
  title (_Session N_ before its first message) and a chevron, whose native menu lists them all with their dates, then
  the session's agent, muted. At its right, a pencil button starts another agent session on the agent picked last; the
  chevron next to it picks another (_Claude Code_, _Codex_), which the session keeps. The chat shows its turns, with
  each tool the agent used as one line, and comments and reviews sent from the canvas as cards.

  The composer is one box at the bottom: _Ask Codex…_ (Enter sends, Shift+Enter adds a line; Home and End go to the start and end of the text, as in every text box; `/` lists the session's slash commands above the box, ↑↓ to pick, Tab or Enter to complete, Esc to hide), and along its bottom
  an attachment button (paperclip) on the left, the agent picks (the model ✦ and the effort, each a button with a native menu of the agent's choices, kept per agent
  for all its sessions) and a round send button, greyed out while the box and attachments are empty. While a turn runs, _Working_ and a
  round stop button take its place, and the send button comes back beside them once something is typed or attached:
  sending then queues the message. Queued messages sit on top of the box, one line each (_Queued_, the message,
  _Send now_ and ×), and run as the next turns, in order, when the running one ends (also after Stop). _Send now_
  steers: the message goes into the running turn, which carries on with it. Comments and reviews sent from the canvas
  while a turn runs queue the same way; a comment has no _Send now_, since the running turn's reply is kept as its
  own thread's answer and the comment's would never reach its thread. Commands the agent left running in the background sit on top of the box, one line
  each with a spinner, what it does and × to stop it, until they end, and so do its subagents (_Agent_ and the
  subagent's task, without ×: the turn's stop button stops them); the agent's reply when one ends shows in the chat
  like a turn. A view prompt from _New View_ sits on top of the box as a card (_View_ and its
  title, then the first lines of the prompt, all of it on a click; × takes it off); the box then asks _What to focus on (optional)…_ and Send works
  with it empty. Sent, the chat shows it as a card with the note.
  Files can be picked with the native file dialog, dropped onto the composer, or pasted (including screenshots), also while a turn runs.
  Attachments sit above the text as removable previews: thumbnails for images, names for files. Up to ten files,
  20 MB total, with images up to 5 MB each. Small UTF-8 text files are included directly; other files reference their
  original local path (shown in the tooltip as _Local file reference_), which must remain available to the agent.
  Send works with attachments alone and with a view prompt. Unsupported images show an error before sending;
  preparation and send errors retain the draft. Sent previews return when the session is reopened.
  Unsent attachments follow their workspace for the window's lifetime, like the draft. When the agent wants a tool that auto mode would block, a permission prompt
  takes the place of _Working…_ in the chat: _Agent wants to:_, the command or file, and the agent's options as
  buttons (_Yes_, _Always_, _No_); the turn waits until one is picked.

Whole-code views (#31) work even when the workspace has no changes. The agent can trace a process with prose,
diagrams and source files pinned to the view's snapshot. Source-file headers have _Reviewed_ and support the same
line comments and explanations as diffs. A file's Reviewed mark is independent of its diff and survives into another
view only if its contents match. Reviewed source files hide completely when _Hide Reviewed Files_ is enabled, just like diffs. Collapsed cards show only their
header, with all four corners rounded; context placeholders and annotations leave no body strip. Section headers and the Threads section count the files and diffs in the view; the Navigator still represents the range's changes.
A prose-only view has no reviewable files. An empty view says _Nothing in this view yet_.

## Across all levels

- The borders of the agent pane and the Navigator can be dragged to resize them; the canvas takes the rest.
- **⌘K** is always available on the main screen, both to switch to anything (project, workspace, file; PRs not yet
  opened and agent sessions still to come) and to run any action.
- Projects, repositories and PRs must be quick to reach: L1 and ⌘K.
- Agent sessions must be quick to reach: L4's picker in the current workspace, and ⌘K for all of them.

## Open questions

1. **Inbox:** where do you find PRs that aren't workspaces yet (review requested, new comments on
   your PRs)? Probably an inbox; where it lives and what goes in it is to be decided.
2. **Views:** should a view embed only some lines of a file diff, not the whole of it? Should a section get its own
   _Reviewed_? Does the agent pane need to show that a view is being made? Should the agent see the view as drawn
   (a screenshot), not only whether its diagrams draw?
3. **The review as a whole:** a comment that isn't on lines goes in the PR panel's conversation; should it be a
   thread of its own, sendable to the agent? Should the PR's description be written by the agent?
4. **Agents in L4:** tabs, a list, or split panes, and how running and finished agent sessions look.
   Earlier agent sessions are reachable from the header's picker, one at a time.
5. **The local loop:** coxswain pushes and opens PRs, but doesn't commit; agents do, or the user in a terminal.
   Should it commit (with a message to write) too? Turn diffs pile up under _Turns_; should older ones fold away,
   and should the canvas say which turn a local change came from?
6. **The canvas:** what else it shows (the PR's history), and how the agent and the human switch
   between them. An annotation on lines is an entry (ADR 0023); the agent has tools to make views (ADR 0026), but not
   yet to navigate the app or read its context. Interactive views (Excalidraw and the like) are deferred.

## Continuity when navigating

- Opening and closing the command palette preserves the diagrams already drawn beneath it.
- A workspace remembers its selected agent session and unsent draft for the window's lifetime. Running turns,
  earlier messages, pending permissions and errors survive switching workspaces; the agent pane reattaches to the
  core's session state. A turn can finish while its pane is hidden.
- Picking a comment from the Threads section or a chat card selects its view or recorded range and temporarily reveals its reviewed file
  before scrolling to its thread, or stays where it is if the thread is on screen there. The Reviewed mark
  stays. An outdated thread opens above its file with its code then and now, rather than leaving navigation at a
  hidden annotation.

The Guide sidebar reserves a stable scrollbar gutter and 16 points of right padding so content and highlights stay clear of the scrollbar.

Guide section, file and thread rows share a 12-point corner radius and the same hover highlight palette. Thread metadata leads with the reply count, followed by Resolved (for example, `5 replies · Resolved`).

Guide thread metadata truncates within the card width, even in a narrow sidebar. Sidebar thread rows only navigate; resolve and reopen controls live in the main panel and use the same rounded check icon as reviewed file indicators.

A section’s Reviewed checkbox uses a neutral mixed-state minus when some of its files are reviewed; none reviewed is unchecked, and all reviewed is checked. Clicking the mixed state marks the remaining files reviewed.

Section titles are navigation actions with hover and keyboard focus feedback. A subtle highlight follows the section at the canvas reading position, rather than retaining the last clicked section; the sidebar scrolls smoothly just enough to keep the current file visible, falling back to its section title when that file is filtered out. The current file has priority over the section for scroll following; Reduce Motion uses immediate scrolling. Individual file rows also receive a subtle highlight based on the canvas reading position. Picking a section title or its first file uses the same section scroll anchor and toolbar clearance, including stacked layouts. Picking the file still reveals its diff when reviewed.

Guide sidebar hierarchy uses system-font section numbers aligned to the title’s first baseline, 13-point semibold section titles, regular-weight secondary file names, subdued aggregate counts, and quieter thread previews on lightly separated pill surfaces. Hover feedback and blue Reviewed checkboxes remain clear.

Sidebar section headings with files include a right-aligned Reviewed checkbox with unchecked, neutral mixed, and checked states. It marks/unmarks the section’s files without navigating, using the same review state as the main panel. Sections without files omit the control.

Section/file highlights are inset 1.5 points vertically, leaving a 3-point visual gap between adjacent highlights without changing row spacing or hit targets.

Unchecked Guide sidebar checkboxes use a quieter opacity, strengthening on hover or keyboard focus; checked and mixed review states retain full contrast.

Thread pills align flush with the left edge of their parent file highlight. Their 2-point wrapper insets retain a small visual separation from the file highlight.

Returning to Guide restores its saved scroll and highlighted file/section immediately; transient virtualizer and restoration corrections do not replace that saved highlight. A new guide waits for layout to settle before its first reading marker. Normal scrolling continues to update them immediately.

## Automatic guides

Opening a workspace sends a generation turn to its Guide Chat session unless a complete Guide already matches its merge-base/snapshot range. PR/worktree changes trigger a replacement. Guide turns use their saved sidebar session and configured model/effort, report progress in the Guide sidebar, and coalesce duplicate checks. A superseded run cannot replace a newer guide. The previous guide remains readable on opening too, even when its snapshot is stale, until a complete replacement is ready; Changes/Files are not interrupted by publication.

The Guide sidebar shows Generating guide… or Updating guide… above its list. Failures show their reason and Retry. Progress is indeterminate during the model run; the app does not invent a percentage. Plain guides use short thematic headings and one or two concise sentences alongside embedded diffs, without code snippets or a review report.

The left sidebar starts open at 336 points wide. Commits/Turns starts collapsed and is available only in Changes; Guide and Files use the full sidebar height. Reviewed files and resolved threads show by default, with Hide Reviewed Files and Hide Resolved Threads options. Human authors show by default; bots can be included individually or with Show All Authors.

Automatic guides use the dedicated Guides agent/model preferences and run directly from diff evidence.

In light appearance, Guide tree connectors use a stronger neutral line and section/file/thread hover surfaces use an 8% darkened canvas wash for clearer navigation feedback. Dark appearance retains its existing colors.

File labels expose their complete repository-relative path through standard title tooltips, including Guide names, disambiguating folders, and virtualized Changes/Files rows. Electron forwards these to the macOS tooltip system, which owns the delay and presentation. Tree labels are annotated before hover and refreshed when rows are expanded or recycled, so the first native tooltip query sees the correct original path. Guide filenames expose their full basename directly, while folder labels expose the full directory and the row exposes the full path.

Changes and Files share Guide’s row treatment: system-font filenames, Pierre language icons,
muted folder paths only for ambiguous basenames, subdued per-file added/deleted counts,
12-point hover corners, and right-aligned native Reviewed checkboxes for changed files.
Folder branches use the Guide’s thin stems, slanted joins and softly curved final join.
Review checkboxes act independently of file navigation. Full filename/path tooltips are
attached before hover, including Pierre’s truncated text fragments.

Reviewing a file or section collapses the affected cards, overriding any earlier sidebar
reveal. Selecting the file again or using its small header disclosure reopens it without
changing its review state. Header disclosure keeps the header at the same viewport height while
virtualized content settles, and yields immediately to user scrolling. Resolving a thread similarly collapses its conversation even if
previously revealed; selecting it again or using its header disclosure expands it while
keeping it resolved. These disclosure choices are transient presentation state.

In Changes list layout, long filenames truncate with an ellipsis on one line. Optional
folder hints shrink independently; diff totals and review checkboxes remain visible.

Guide and Changes use the code theme’s added/modified/deleted colors for file names and
language icons (renames use modified). Folder hints remain muted. Both navigators share
the same neutral hover/selection washes, 12-point corners and 3-point vertical highlight gap.
File rows share 12-point filenames, 11-point folder/count metadata, 14-point language icons
and 28-point row height.

In light mode, sidebar filenames, icons and addition/deletion counts use green #168c28
and red #cf3a42 sampled from the supplied Linear screenshot, with medium blue #356fba
for modifications. These are screenshot samples and a companion blue, not official tokens. Dark mode retains the selected
code theme’s status palette and its 80% color/20% label-gray blend.

Guide, Changes and Files share the SidebarFileLabel component and sidebar-row stylesheet.
Folder chains and filenames use transparent, native ellipsis labels rather than painted
truncation masks, so hover/selection remains one uninterrupted rounded surface. Pierre
retains tree virtualization, expansion and keyboard navigation.

Guide and Changes/Files also share sidebar-tree connector geometry: equal-length 12-point
slants and a curved final join with the same endpoint.

Tree indentation uses a uniform step and places each ancestor stem on its folder disclosure
arrow’s centerline; the shared slanted joins keep their existing endpoint geometry.

Changes diff totals separate additions and deletions with a nonbreaking space.

## Interaction performance

Switching Guide, Changes and Files reuses event-owned cached data. Visited Changes/Files trees retain expansion and sidebar scroll within the active workspace; switching workspaces releases their models. Each canvas surface has its own remembered scroll position. Cached restores run before paint and yield immediately to user scrolling, keyboard, pointer or touch input; lazy-layout retries cannot pull the reader back after manual input. Returning from Settings restores the canvas and reconnects its reading observer.

The full file list is enumerated with bulk git commands, including untracked files and excluding unstaged deletions, without a synchronous filesystem stat for every path on Electron’s main thread. Saved Guides read their immutable range immediately while the first GitHub/fetch check runs. Live Changes waits for the actual worktree check. Cached returns do not repeat local work just because a pane mounted.

Warm tab/workspace returns draw previously read cards immediately, without an estimated-height placeholder phase. Saved Guide destinations prepare their pinned data and initial cards before replacing the current canvas; rapid workspace picks use only the latest request. Uncached cards still load lazily and live Changes continues to use the checked worktree.

Large Files trees prepare their ordering off the UI thread, retaining Pierre’s natural folder/file ordering and keyboard behavior. Scroll offsets save immediately; anchor and reading-position measurements are coalesced to one pass per display frame, with pending work cancelled on navigation. Shared language icons mount once per window.

Guide/Changes tab switching retains each canvas’s rendered rows and measured heights within the active workspace, avoiding a header-only phase followed by expansion. Inactive canvases are invisible, inert and excluded from Find; anchors target the requested canvas. First visits wait briefly for visible code rendering while the previous surface remains visible, with a bounded fallback. Reviewed collapsed files display their header immediately.

Streaming agent threads contain Working/Queued/permission/error status inside the inset Agent response card, including before its first output. Prose-anchored comment and draft cards align with their text column without the code-diff card’s side margins or the former extra padding on unplaced threads.

Changes lists each file’s thread pills directly below its filename, using the same SidebarFileThreads component as Guide, including author avatars, reply counts, resolved state, review checkbox and diff totals. Its dots menu reuses Guide’s reviewed/resolved/type/author filter items, alongside Tree/List layout; filter choices are shared. File-bound Guide threads are also available in raw Changes, and selecting one stays in that diff. Prose-only section discussions stay in Guide. Tree rows omit folder suffixes; flat lists show a folder hint only for ambiguous names. Folder disclosures and labels align left at each tree depth regardless of label length. Pierre supplies Changes ordering, folder flattening, expansion and keyboard focus while shared React groups accommodate variable-height threads. The full repository Files tree remains virtualized.

Thread disclosure controls precede the author in expanded headers and the summary in collapsed headers; resolve and options stay on the right. File-card disclosures use the same 14-point chevron as the unchanged-lines controls, with a brighter chevron on hover and no background change. Paired context chevrons have extra vertical separation. All file and context disclosures share the measured center of the line-number column, including files with wider line numbers, with the header border inset compensated.

Page zoom (⌘+/⌘−, reset with ⌘0) scales review content. The native workspace tab bar keeps its 44-point window height and native control sizes, with constant traffic-light spacing and full-window width; sidebar and sticky-content clearances follow that fixed height.

Draft comment close controls sit eight points inside the textarea border, with reserved text padding, so their hover backgrounds stay within the outlined field.

Files uses an IDE-style canvas: a horizontally scrolling file-tab strip below the workspace bar and an edge-to-edge whole-file view, without review-card headers, borders, rounded corners or outer margins. Opening from the tree, Open Quickly or code navigation adds/selects a tab; revision tabs remain distinct. Tabs have language icons, full-path tooltips, close buttons and middle-click close. Arrow/Home/End keys navigate the tab strip. Closing the active tab selects a neighbor, and closing the last shows an empty editor. The last active file and open tabs survive pane/workspace switching within the window; Back/Forward includes these changes. File reads do not wait for Guide/diff review queries.

Opening an inline draft focuses its input without scrolling it into view: the selected code line stays in place while the draft adds space beneath it.

Changes defaults to three collapsible top-level change groups: Implementation, Tests and Generated, each with a visible file count. Tree mode nests the original folder hierarchy inside each group; list mode nests its flat file rows. Shared thread pills and review controls stay beneath/alongside their files. The dots menu’s _Group by Implementation, Tests and Generated_ checkbox disables/enables grouping independently of Tree/List and the thread/review filters. All three groups remain visible when some have zero matching files; an entirely empty result keeps the existing centered empty state. Group expansion survives pane switching. Grouping follows path conventions; generated artifacts win over test locations. Arrow keys navigate across group, folder and file rows, with Left/Right collapsing/expanding groups. This display choice lasts for the window session, like Tree/List.

Changes and Guide file clicks explicitly stay in their review pane. A retained, hidden Files tree never navigates in response to a review selection; revealing a file in the tree does not count as a user file-open action. Change-group headers show aggregate +/− line totals beside their file count, reflecting the visible filtered files.

The PR overview uses the same canvas/card surfaces and 12-point corners as review cards, with a generous title/branch header, subdued state badge, description and conversation cards, a checks/action card and a grouped people/labels card. Its responsive columns stack when narrow. Markdown images fit their available width; repository-relative images resolve at the PR head through the core, including private repository files, and GitHub blob image links resolve to raw images. Remote HTTPS badges/attachments can load; failures show a muted image label instead of a broken-image icon. Mermaid diagrams use the Guide’s shared renderer, theme, diagram card spacing and understated expand control, including the existing native preview interaction.

Development launches identify as coxswain in the macOS Dock. Inline Mermaid diagrams remain bounded in height and expand through their corner icon; source theme directives cannot override the app palette.

Shared modals center an elevated theme-aware surface with 20-point outer corners, a subdued blurred backdrop, 24-point content insets, clear title/description hierarchy and a separated action footer. Fields use 12-point corners and a subtle focus ring. Update Guide labels the multiline instructions and explains that they persist for automatic updates; Submit Review uses a wider surface with inset thread cards and separate summary/verdict/actions. Tab stays within the dialog; Escape dismisses it and focus returns to the previous control.

Submit Review always shows Comment, Approve and Request Changes. On the viewer’s own PR, Approve and Request Changes are disabled with an explanation; the choices remain visible so the dialog’s capabilities are clear. Other authors’ PRs allow verdict selection independently of draft thread count.

Opening PR overview preserves the Guide sidebar’s reading highlight and scroll position. Guide tracking and automatic sidebar reveal pause until the review canvas returns; delayed resize/scroll callbacks from its removed canvas are ignored.

Update Guide includes Model and Effort pickers with App default and Agent default choices. Changing the model resets effort to the agent default, and supported effort choices are discovered for that model. Model/effort overrides apply only to the requested update; an explicit agent change starts a replacement Guide session; focus/style instructions still persist. Settings → Guides stores model and effort defaults per agent. Model discovery uses a temporary session without changing Chat selections.

Model menus remain usable while model-specific effort choices load. Discovery results are reused for five minutes, and temporary-session teardown does not delay showing the choices.

Update Guide includes a Claude Code/Codex agent switch above Model and Effort, plus Use app default to reset overrides. Switching agents clears incompatible model/effort overrides and loads that agent’s saved Guide defaults; the choice applies only to the requested update.

Submit Review is anchored inside the main canvas panel, outside its scrolling content. Opening or resizing Chat moves the button with the panel edge; it never covers the right sidebar.

Guide option loading uses a small spinner in the picker’s reserved chevron slot, with an accessible busy/status label. It adds no row or height to Update Guide or Settings.

Implementation, Tests and Generated category headers in Changes have right-aligned unchecked/partial/reviewed controls, shared with Guide sections and file rows. Toggling one marks every changed file in its category, including filtered files, without changing expansion.

Native macOS window buttons recenter in the 44-point workspace bar after resize, restore, maximize, focus and renderer reload; corrections run after native layout and leave fullscreen placement to macOS.

Guide generation defaults to Claude Code/Opus 5.5 independently of retired summary preferences. New Claude review conversations select the adapter’s Opus 5.5 option by default. The default Guide prompt puts tests in a dedicated Tests section and generated artifacts in a dedicated Generated section at the end, using the same file classification as Changes.

Changes category/folder disclosures use a fixed 16-point slot in both states, keeping labels stationary. The chevron tip aligns with its child tree line using shared 20-point indentation and 16-point parent-axis metrics.

Changes category diff totals align to the same right edge as file diff totals, just before the review checkbox; the file count stays beside the category name.

Sidebar ⋯ menus contain only sidebar filters, grouping and Tree/List controls. The top Settings dropdown contains canvas display controls, Section Descriptions, Hide Reviewed Files and Update Guide. Hide Reviewed Files is shared by the sidebars and canvas; it has no sidebar control or empty-state toggle.

The bottom of the top Settings dropdown includes Auto-update from Remote for the current workspace, checked by default. It persists across restarts, follows force-pushes for clean workspaces, and switches off automatically on local edits, untracked files or unpushed commits. It stays off until explicitly re-enabled; enabling it with local work immediately switches it off again. Other workspaces are unaffected.

Hide Reviewed Files removes all reviewed cards, including the previously selected card when the option is enabled. Selecting a reviewed file in the sidebar temporarily reveals only that card while keeping the option enabled. Selecting another file or marking the revealed card Reviewed again clears the exception.

Changes canvas file cards follow the Changes sidebar’s Pierre ordering: folder-first natural filename traversal for Tree, and the same filename/disambiguation order for List. When categories are enabled, cards follow Implementation, Tests, Generated. Sidebar filtering and collapsed folders do not remove cards from the canvas; canvas visibility remains independent. Guide sections retain their authored ordering.

Changes tree folders have right-aligned Reviewed checkboxes, with a neutral mixed state for partially reviewed descendants. A folder checkbox marks or unmarks every changed descendant in its category, including filtered or collapsed children, without changing expansion. Clicking a partial checkbox marks the remaining files reviewed.

Changes omits Implementation, Tests or Generated category sections when they contain no files matching the sidebar filters.

Changes, Implementation/Tests/Generated and folder file counts show reviewed/changed when reviewed files are visible, and only the unreviewed count when they are hidden. Category file counts sit directly beside the category name with a 1 px downward optical alignment; fixed-width diff totals and the Reviewed checkbox remain aligned on the right. Added/deleted totals continue describing the visible files.

Submit Review omits the No open comment threads empty-state notice when Approve is selected; approving without comments is a normal review.

The Changes canvas all-reviewed empty state is centered horizontally and vertically in its available body, matching the sidebar’s text size, muted colour and spacing.

Guide sidebar auto-follow smoothly reveals the active file row, falling back to its section title when the file is filtered out. It scrolls only when that row is outside the sidebar viewport. A critically damped reveal accelerates gently and preserves velocity when the active target changes; the offset is never directly mapped to canvas scrolling. Repeated identical reading markers do not restart scrolling, and manual sidebar input cancels the current movement. Reduce Motion remains immediate.

Reading-marker updates change only highlight attributes when the marker changes; reading changes do not rerender the sidebar rows or canvas.

Guide reading markers update a per-window transient store subscribed to by the Guide sidebar alone. Advancing the marker does not rerender the app or retained canvas/file cards.

The Changes remaining count is readied from the live diff while Guide displays its pinned range. Loading review state is unknown, rather than temporarily counted as all files unreviewed, so switching to Changes never flashes the full count.

Workspace-tab PR icons use green for open PRs, a filled green checkbox when approved, purple when merged and orange for merge conflicts or failing CI. On open PRs, conflict/failure takes priority over approval. Closed PRs retain red; branch-only tabs retain their normal neutral icon. Native macOS tabs and web fallback tabs share the same colour rules.

Merge-conflicting workspace tabs use a filled orange square with an exclamation mark. Approved titles keep the normal text colour; only the status icon is green.

Bot identity is cached with mirrored review comments, so previously synced bots are excluded immediately on workspace open without waiting for live GitHub metadata. Older comments learn identity on their next successful sync. Explicitly showing a bot still includes it.

Update Guide in the top Settings dropdown is enabled whenever a workspace is open, including while viewing Changes, Files or the PR overview. It does not require the Guide to be displayed.

Changes tree folders show visibility-aware review counts beside their names, matching category counts and including filtered or collapsed descendants within the folder’s category. Counts retain the same muted style and 1 px optical alignment.

Changes tab, category and folder counts follow sidebar visibility: when reviewed files are shown, display reviewed/changed (for example 5/12); when hidden, display only unreviewed files (7). Counts use all changed descendants in scope, including collapsed or thread-filtered files.

Settings → Guides → Default Prompts provides multiline Guide and Review Comment editors, each with Save and Restore Default. Saved prompts apply across workspaces to future generation, including automatic Guide regeneration and agent-authored Guides. Workspace Guide instructions retain precedence. Existing Guides and comments remain unchanged until updated. Output-format requirements remain app-owned.

Settings uses two columns below the shared window header: an edge-to-edge left sidebar uses the app’s shared list rows and selection styling for Appearance, Accounts, Guides and About. The selected section fills the remaining right-hand width and scrolls independently. Appearance includes colour mode and Code Theme; Accounts contains GitHub; Guides contains agent/model/effort and Default Prompts. Content uses the shared cards, controls, spacing and muted text. Switching sections preserves unsaved prompt edits until Settings closes.

Settings opens as a closable Settings tab alongside workspace tabs in the normal top bar, retaining the project switcher and shared window controls. There is no separate Settings header or Done button in this tab. Selecting a workspace returns to its retained canvas; the Settings tab stays open with unsaved edits preserved. Closing it (including ⌘W while selected) returns to the workspace. ⌘, and Settings in the top dropdown open or select the single tab. Back/Forward include Settings via the router location. With no project, Settings remains accessible as a standalone screen.

Settings typography uses an 18-point semibold page title, 14-point semibold section headings, 13-point field labels and controls, and 12-point muted helper text with a bounded reading width. Prompt editors use 13-point text with 20-point line spacing; concise helper copy sits below labels rather than competing with section headings.

Settings forms stay left-aligned in the right pane and are capped at 80ch, so cards, descriptions and prompt inputs retain readable line lengths on wide windows while shrinking for smaller ones.

Settings groups controls with surface contrast rather than nested outlines: a canvas background, a subtly distinct navigation surface, raised borderless cards, and inset prompt fields with a single subtle edge and visible focus ring. Surfaces use the app’s existing light/dark palette tokens.

Settings navigation reuses the same 12-point sidebar row corners and hover/selection washes as Guide and Changes. Cards retain the shared 12-point radius; prompt fields use the dialog field radius and focus glow, and action buttons share the dialog button metrics and 8-point corners.

Guide regeneration preserves Reviewed marks per file when both old and new contents match the last reviewed state. Reordered sections, new snapshot IDs and unrelated base-branch changes leave marks intact. Existing marks from earlier app versions are matched against saved Guide/job ranges; only a changed file becomes unreviewed. Whole-file marks remain independent of diff marks.

Guide and Changes sidebar file rows show a small blue dot with the tooltip “Changed since last review” when a Guide update changes that file’s old or new contents, including newly added files. A persistent per-file baseline keeps the dot through later updates and app restarts. Reviewing the file (including section/folder review) acknowledges its current contents and clears the dot. Opening alone does not clear it; manually unchecking Reviewed does not create a new dot. First-time Guide generation and prose-only regeneration show no dots. Existing unreviewed changes with saved prior review marks get the same indicator.

Expanded diagrams support ⌘ + scroll wheel to zoom around the pointer in both native and fallback modals. Trackpad pinch / Ctrl-wheel keeps the same zoom behavior; ordinary scrolling pans the diagram.

Guide generation lives in a named Guide session in the right Chat sidebar, with normal streamed history, tool activity, permissions, queued messages and Stop. Manual Update Guide, automatic updates and retries reuse that session across restarts without opening Chat or switching away from the selected conversation. Guide progress offers View session, which explicitly opens/selects the session, and Retry. A complete validated replacement publishes at once; the previous Guide remains readable during the turn. New requests coalesce into a follow-up instead of interrupting an active conversation.

Settings → Appearance offers twelve code themes in a dropdown to the right of its preview showing the saved
selection immediately on load. Hover and keyboard focus preview without saving; dismissing
restores the saved theme. The menu stays beside the sample. Choosing a theme saves it for files, diffs and trees and
updates the sample below. Each theme has paired light and dark variants.

The Claude Code/Codex agent picker uses the same anchored dropdown as the code theme
picker, showing the saved selection and highlighting it in the menu. Settings and
Guide update options use the same control.

The top bar’s PR overview toggle is labeled “PR” in semibold and sits first in the action group,
to the left of GitHub and preview actions, in both native and standard chrome.

Code theme families always contain light and dark variants. Code views and the Settings
preview explicitly follow the resolved app appearance, including OS changes in System
mode; Soft Dark uses the dark variant. Changing appearance preserves the theme family.

Chat opens a session at its latest message once its history loads. Submitting messages, streaming answers and turn-status updates preserve the transcript scroll position, including when it was at the bottom; the reader scrolls to follow new content.

Display settings persist app-wide in SQLite across restarts: Unified/Split, Tree/List, Hide Reviewed Files, Section Descriptions, change grouping, sidebar thread/author filters, sidebar visibility and width, Chat width, and Commits/Turns selection, visibility and height. Existing appearance, code theme, agent/model/effort, Guide and review settings retain their saved behavior. Defaults apply until a preference is first changed.

Inline agent-thread follow-ups preserve the canvas scroll position when their question is saved, the turn starts, and answers stream or become saved replies. Thread annotation locations remain stable while their conversation contents update; canvas browser scroll anchoring is disabled to avoid following the growing conversation.

Picking a thread in the sidebar aligns that specific conversation below the toolbar and file header. Threads in the same file, including threads sharing a code line, have independent destinations. A selected Guide section does not also scroll when a thread is the navigation target.

Code links (⌘-click, Go to Definition and Find Usages) and file search (⌘K / Open Quickly) reuse the current Guide or Changes canvas when its target file is displayed there. Collapsed visible cards expand; files hidden by Hide Reviewed Files stay hidden and open in Files instead. A code link must match the displayed revision and side, including renamed old-side paths; another revision opens in Files. In-place declaration navigation selects its line, reveals unchanged diff context when needed, and remains in Back/Forward history. Explicit Files-tree and file-tab picks keep using Files.

Within code tokens, ⌘-hover and ⌘-click target the identifier under the pointer, not the first identifier in the syntax-highlighted span. Generic wrappers and their type arguments are separate links, including `FromDishka[SuggestSampleTestSetup]`; brackets, commas and whitespace are not links. The underline covers only the hovered identifier, and the context menu uses the same symbol.

Python import and reference links resolve local workspace package sources even before a virtual environment is installed; third-party dependency links require those sources to be installed. Clicking a sidebar file/Guide section keeps its destination anchored through later diff-height changes, until manual scrolling/input or another navigation takes over.

Toggling Hide Reviewed Files preserves the current file’s reading offset in Guide and Changes, including preference changes from another window and later diff-height corrections. If that file is being hidden, the nearest following visible file takes its place below the toolbar, falling back to the previous file. Guide prose keeps its section position. This does not add a history step or change review marks.

Test grouping recognizes test directories and language-specific filename conventions. Outside test directories, Python tests use `_spec.py` (or `_spec.pyi`); `sample_test.py`, `test_of_detail.py` and `suggest_sample_test_setup.py` stay in Implementation. Frontend `.test.ts` / `.spec.ts` and existing other-language test conventions remain supported. Guide generation uses the same classification.
