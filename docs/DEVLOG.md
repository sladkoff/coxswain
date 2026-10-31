# coxswain — devlog

Where the build stands and what we owe. Newest entry first. Terms are defined in
[the glossary](context/coxswain.md); decisions are in [the ADRs](adr/).

## 2026-10-31 — Keep domain source filenames out of Tests

- Test classification now requires a test directory or language-specific filename convention. Python uses `_spec.py` / `_spec.pyi` outside test directories, so `sample_test.py`, `test_of_detail.py` and `suggest_sample_test_setup.py` stay in Implementation. Frontend `.test.ts` / `.spec.ts` and other-language conventions remain supported.
- Shared classification fixes Changes grouping and future Guide generation. Regression coverage includes the reported path and other domain source names, while preserving existing test and generated conventions.

## 2026-10-31 — Hotfix v1.9.2

- Release includes stable Chat and inline-thread scrolling, precise sidebar thread destinations, file navigation that survives deferred diff loading, and reading-position preservation when filtering reviewed files.
- Code navigation distinguishes identifiers inside syntax tokens, reuses visible Guide/Changes files, and resolves Python workspace imports to their source. Display preferences and pane layout persist, with one global Hide Reviewed Files control. Domain source filenames containing `_test_` stay in Implementation.
- No database migration or dependency update. Release uses the existing macOS arm64/x64, Windows x64 and Linux x64 workflow.

## 2026-10-31 — Keep the reading position when filtering reviewed files

- Hide Reviewed Files captures the old canvas layout before React removes/inserts cards, then restores the surviving reading anchor before paint. Guide and Changes preserve the current file’s offset; hiding that file chooses the next visible card (or previous when last). Guide prose retains its section.
- The snapshot boundary also covers app-wide preference updates from another window. It cancels older navigation corrections before restoring the filter anchor, follows lazy diff resizes and yields to manual input. No router history change or storage change.
- A running-renderer fixture previously moved the reading card from -150 to -1350 pixels when hiding a reviewed card above it; it now remains at -150 on both Hide and Show. Unit coverage checks surviving/removed files, last-file fallback and Guide prose.

## 2026-10-31 — Resolve workspace imports and hold file navigation through loading

- Python language servers receive package roots from project manifests, including src layouts, so local namespace-package imports resolve without an installed virtual environment. The active project’s SuggestSampleTestSetup now resolves from both its import and argument to the source class, rather than its local import. Existing re-export coverage confirms the server reaches original definitions when imports resolve. External packages still need installed source.
- Anchored file/section navigation no longer stops after its first correct position. It follows subsequent virtualized-content resizes, with immediate cancellation on manual input or navigation. Numeric history restores keep their bounded retry behavior.
- Regressions reproduce unresolved workspace imports returning the import declaration and late diff-height changes shifting a clicked header by 1000 pixels. Both now pass. Package-root discovery uses Pyrefly initialization options, without modifying user repositories or adding dependencies.

## 2026-10-31 — Separate code links inside highlighted tokens

- Code navigation uses the identifier’s actual glyph bounds under the pointer, rather than the first word in a syntax token. Wrappers and arguments such as `FromDishka[SuggestSampleTestSetup]` now produce separate language-server positions, including when the highlighter combines them into one span.
- ⌘-hover underlines only that identifier and updates while moving inside the same token; punctuation has no link. Context-menu Definition/Usages share the selected symbol. DOM ranges preserve UTF-16 offsets and handle nested/wrapped token text.
- Reproduced both pointer locations resolving to FromDishka; the fixed running-renderer check resolves each name separately. Symbol tests cover bracketed generics, punctuation, import strings and Unicode offsets.

## 2026-10-31 — Follow source links within the current review

- Code links and file search prefer a target already displayed in Guide or Changes. Hidden reviewed files, absent paths and incompatible revisions still open in Files. Explicit file-tree/tab picks remain Files navigation.
- In-place code navigation expands a visible collapsed card, selects the correct old/new line, reveals unchanged context and reaches offscreen lines through Pierre’s public virtualizer position API. Router locations retain Back/Forward behavior; user input cancels delayed line reveal.
- Destination tests cover Guide/Changes, hidden/missing files, matching and mismatched revisions, renamed old-side paths and whole-file Guide embeds. Checked navigation to an offscreen declaration beyond the original diff hunk in the running viewer.

## 2026-10-31 — Navigate to the selected thread

- Sidebar thread navigation aligns the selected conversation rather than a neighbouring code element, so threads within one file have independent scroll destinations. Section navigation yields while a thread is selected instead of competing for its scroll position.
- Extracted thread scrolling into a shared renderer helper. Regression coverage switches between two conversations sharing a code anchor and back again; the previous alignment fails this check. Checked both thread destinations in the running virtualized file viewer.

## 2026-10-31 — Stable inline agent-thread follow-ups

- Follow-ups in file/Guide threads no longer rebuild Pierre annotations when only replies change. Rebuilding reset the virtualized canvas to the top. The canvas also disables browser scroll anchoring, which otherwise follows the growing reply and shifts the reader.
- Reproduced in the running Viewer: a saved follow-up moved scrollTop from 1650 to 0; stabilizing annotations alone still moved it to 2441 during streaming. Both fixes keep it at 1650 throughout question save, turn start and streaming. `scripts/check-thread-scroll.mjs` exercises this path in a running dev app with local debugging enabled.

## 2026-10-31 — Persistent display settings and one reviewed-file filter

- Hide Reviewed Files is one app-wide preference in the top Settings menu, shared by Guide, Changes and their sidebars. Removed sidebar and empty-state toggles and the duplicate command-palette action. Opening a thread temporarily reveals its file without changing the saved filter.
- Display options, sidebar filters (including authors), grouping, pane widths/visibility and Commits/Turns selection/height now persist in the existing SQLite settings table and notify other windows through core settings events. Existing appearance, agent, Guide and review preferences remain persisted by their owners. No schema migration.
- Paid off the display-option and pane-geometry restart shortcuts in App. Database-reopen coverage checks every newly saved preference and independent concurrent updates.

## 2026-10-31 — Stable Chat reading position

- Sending messages and receiving agent replies no longer force Chat to the bottom. Opening a loaded session still starts at its latest message; subsequent entries and turn-status changes leave the reader in place. Browser scroll anchoring is disabled for the transcript so composer/layout changes cannot anchor it to the bottom.
- Verified with synthetic conversation updates in the running development app: the previous bottom-follow effect moved the transcript 780 pixels on an appended answer. No core or storage changes.

## 2026-10-28 — Big PRs no longer crash the main process

- Opening a 1600-file PR ran the main process out of memory ("Failed to allocate memory" in `Buffer.concat`). Reviewed's fingerprints read every changed file at base and head with `git cat-file --batch`. Each worktree or GitHub change refetched those queries while the previous read still ran, because TanStack cancels the fetch but not the core call, and 1300 reads piled up at 7 GB. `readBlobs` now shares an in-flight read of the same files at the same commit.
- Tech debt: an event that arrives after a read finishes still reads every file again. Caching each file's digest per commit would avoid that.

## 2026-10-26 — Clickable workspace bar with no open tabs

- With every workspace tab closed or removed, the window took no clicks in its top bar. The empty canvas still drew its own placeholder title bar, an empty `-webkit-app-region: drag` strip that sat under the absolutely positioned workspace bar and, coming later in the DOM, overrode its buttons' `no-drag`. The placeholder is gone; the workspace bar is the only title bar there.

## 2026-10-26 — Automatic code theme variants

- Files, diffs and the Settings sample explicitly follow the resolved app appearance when selecting each code theme’s light/dark variant. System follows OS changes; Soft Dark uses the dark variant, preserving the selected family.
- The document color scheme also reflects the resolved appearance for shared tree colors and popovers. Coverage resolves both variants of all twelve bundled families and checks their declared light/dark type.

## 2026-10-26 — Calmer light-mode sidebar colors

- Matched light-mode green/red to the user’s Linear screenshot (#168c28/#cf3a42), with a similarly saturated medium blue (#356fba) for modifications, for filenames/icons and addition/deletion counts. Shared CSS tokens keep Guide, Changes, trees and diff summaries consistent. Dark-mode status colors retain their existing theme palette and blending.
- Source comparison and rationale are recorded in docs/research/sidebar-status-colors.md.

## 2026-10-26 — Readable light sidebar status colors

- Light-mode status colors use the Guide counter palette for consistent green/red alongside blue modifications. Dark-mode blending is unchanged.
- Guide, Changes and file tree labels/icons share the adjusted palette; small addition/deletion counts use darker light-mode colors in sidebars and file/commit summaries.

## 2026-10-26 — Compact PR overview button

- The top bar overview toggle now reads PR in semibold and sits left of GitHub and preview actions in native and standard chrome.

## 2026-10-26 — Consistent agent switch

- Claude Code/Codex selection uses the same anchored dropdown as code themes in Settings and Guide update options, preserving disabled states and the selected agent.

## 2026-10-26 — More code themes

- Added Ayu, Everforest, Gruvbox, Kanagawa, Night Owl, Rosé Pine, Solarized and Vitesse from Pierre/Shiki’s bundled open-source themes (https://shiki.style/themes). Each follows light/dark appearance across files, diffs and trees without a new dependency.
- Settings uses a dropdown to the right of the sample, showing the saved theme on load. A shared preview picker supports hover and keyboard previews without saving; dismissal restores the saved theme. The menu explicitly anchors to its trigger in the top layer so it stays beneath the dropdown instead of falling back to the window origin. A shared catalog keeps stored IDs, labels and theme pairs consistent; persistence coverage includes every choice.

## 2026-10-26 — Appearance controls in Settings only

- Removed Appearance, Soft Dark and Code Theme from the top dropdown; all remain in Settings → Appearance. The dropdown no longer reads those preferences just to open.

## 2026-10-26 — Independent Soft Dark palette

- Soft Dark is a separate checkbox from System/Light/Dark in Settings and the top dropdown. It applies only when the effective mode is dark, so System can follow the OS while retaining the softer dark palette. Light mode leaves the preference saved and inactive.
- Native controls keep the selected mode; renderer palette, diff styling and diagrams resolve against that mode and OS changes. Existing Soft Dark selections preserve Dark plus the enabled palette without a schema migration.
- Regression coverage checks legacy settings, independent persistence and effective palettes under both OS modes and explicit overrides.

## 2026-10-26 — Keep Chat visibility during Guide updates

- Manual Guide updates, automatic refreshes and retries no longer open Chat or change the selected conversation. Removed Guide orchestration’s focus/open capability and the Update Guide dialog’s local session reset. View session remains the explicit way to open the Guide conversation.
- Guide lifecycle regression verifies the saved closed Chat preference survives manual updates, automatic refresh and retries.

## 2026-10-26 — Cross-platform release packaging

- Enforce LF checkout for dependency patches with .gitattributes. Windows checkout had converted them to CRLF, causing pnpm 12 to reject the patch header as an invalid unquoted filename. The v1.8.0 build stopped before publication; v1.8.1 contains this packaging fix.
- A Git checkout regression simulates core.autocrlf=true and verifies patches stay LF with their original hash.
- Release packaging explicitly rebuilds the patched macOS bridge for both arm64 and x64 before producing downloads, rather than shipping the untouched upstream prebuild for the runner’s other architecture.

## 2026-10-26 — Release prepared versions

- Final release checks caught an older queued manual Guide request replaying after a newer one; per-workspace request ordering now discards superseded replays before preparation. Repeated session lifecycle regressions verify the latest override wins.
- CI/release builds now install Node 26 before pinned pnpm 12.3.4. A frozen-install preflight proved pnpm 10 rejects the current patched-dependency lockfile. CI now runs the test suite too.
- The release workflow skips an empty version-bump commit when main already contains the requested package version, while still tagging and building that version. This supports shipping the prepared 1.8.0 changes through the standard release workflow.

## 2026-10-26 — Durable Guide Chat sessions

- Guide generation now uses the normal right-sidebar Chat session transport, transcript, permissions, queue and Stop controls. A per-workspace binding persists across restarts; automatic updates continue the same conversation, while manual updates select it and open Chat. Guide generation no longer creates background jobs or disposable tool-free agents.
- The session reads repository evidence directly and uses publish_guide to submit a complete replacement. Coverage/request/snapshot checks protect atomic publication and reject stale requests. The old Guide remains readable while generating; interactive section rewrites are blocked during a requested update.
- Updates coalesce while a turn is active, preserving latest manual overrides; explicit agent changes bind a replacement conversation. One-turn model/effort choices restore previous session configuration. Progress links to the session and persisted failures support Retry.
- Deterministic integration coverage exercises same-session refresh/retry/reopen, custom prompts, explicit provider changes, coalescing, stale/partial publication protection and absence of background Guide jobs. Live dev-app validation regenerated #5767 through its visible Chat session and publish_guide using the saved workspace focus, with no new background job. Historical job rows remain readable.

## 2026-10-26 — Command-wheel diagram zoom

- ⌘ + scroll wheel zooms around the pointer in native and fallback diagram modals through the shared gesture handler. Ordinary wheel panning, pinch/Ctrl-wheel zoom and dragging remain covered by the same regression test.

## 2026-10-26 — Changed-since-review dots

- Guide and Changes file labels share a small accessible blue dot for updated/new files, with a Changed since last review tooltip. It remains until Reviewed acknowledges the current contents, including bulk review. Opening alone or further Guide regeneration does not clear it.
- Core-owned per-file baselines persist in SQLite settings, initialized from the preceding Guide and updated on Reviewed. Prose-only/unrelated base changes add no dots; manual unreview does not resurrect one. Existing stale reviewed fingerprints provide compatibility for updates predating this feature.
- Regression coverage checks persistence across a reopened database, repeated publication, file additions, review acknowledgements and manual unreview.

## 2026-10-26 — Preserve review across base updates

- Diff review fingerprints now identify each file’s old and new contents rather than the base commit ID. Guide regeneration, reordered sections and unrelated base updates preserve marks; changes to either side invalidate only that file. Whole-file review stays separate.
- Existing fingerprints remain readable using persisted Guide/job ranges, with old-side content verification before accepting a legacy mark. Explicit unreview clears compatible old marks too. No review rows or migrations are removed. Compatibility is conservative when a historical base is no longer available.
- A real-git regression covers old/new fingerprint formats, Guide replacement, base movement, per-file invalidation, unchecking, pinned history and whole-file independence. On a database copy, recovered 101 reviewed files for #5769 and 23 additional marks for #5767.

## 2026-10-26 — Remove Activity UI

- Removed the Activity panel and its native/fallback toolbar buttons, spinner, state and styles. The toolbar gives the freed width back to tabs. Background jobs, retries and persisted history remain; Guide progress stays in its sidebar and comment-summary errors no longer point to the removed panel.

## 2026-10-26 — Auto-update menu position

- Auto-update from Remote sits at the bottom of the Settings dropdown, separated from display and Guide controls.

## 2026-10-26 — Consistent Settings naming

- The tab, dropdown entry and close-tab labels all use Settings.

## 2026-10-26 — Settings text hierarchy

- Settings separates page titles (18), section headings (14), field labels/controls/editors (13), and supporting text (12). Section spacing is consistent, helper copy is shorter and width-limited, and prompt editors use a compact eight-row viewport with comfortable line spacing.
- Settings reuses Guide/Changes sidebar highlight styling and shares dialog input/button radii and focus treatment.
- Settings uses palette-based surface differences for navigation, canvas, borderless groups and inset prompt fields, removing nested card outlines while retaining clear input focus.
- Guides distinguishes Generation from Default Prompts; prompt field descriptions explain when each is used. Settings forms and inputs are left-aligned and capped at 80ch rather than stretching across the window.

## 2026-10-26 — App Settings tab

- App Settings opens beside workspace tabs using both the native and fallback top bars. It reuses the normal window chrome, with no extra Settings title bar or Done button. ⌘, selects one tab; its close action and ⌘W return to the retained workspace.
- Settings is represented in router history. Switching between workspace and Settings tabs preserves Settings drafts and workspace state, with Guide tracking paused while Settings is active. The standalone screen remains available before adding a project.

## 2026-10-26 — Grouped Settings sections

- Settings uses the shared list-row control, selection colours, pane divider and dense left-aligned navigation in an edge-to-edge sidebar. The right pane uses shared cards and controls.
- Appearance includes Code Theme; Accounts contains GitHub; Guides includes generation defaults and Default Prompts. Section switches still preserve unsaved prompt edits.

## 2026-10-26 — Settings section navigation

- Settings uses a left section list and a right content pane that fills the remaining width, with independent scrolling. Sections stay mounted when switching so unsaved prompt edits survive navigation within Settings.

## 2026-10-26 — Editable default prompts

- App Settings exposes Guide and Review Comment default writing prompts with explicit Save and Restore Default controls. Overrides persist across restarts in SQLite; restoration removes the override so future built-in changes remain available.
- Automatic/manual Guide generation and agent Guide tools use the same saved Guide default; thread-to-comment generation uses the saved Review Comment default. Workspace Guide instructions still take precedence, and output format stays app-owned.

## 2026-10-26 — Customized automatic Guides

- Workspace Guide instructions explicitly take precedence over default focus, style and section structure in both manual and automatic generation. Lower-priority changes retain file coverage with brief explanations.
- Regression coverage changes the worktree after saving custom instructions and verifies the automatic job receives them. Model output remains nondeterministic; this verifies prompt delivery and priority, not compliance by every model.

## 2026-10-26 — Visibility-aware review counts

- Changes tab, category and folder counts share one display rule: reviewed/changed when showing reviewed files, unreviewed only when hiding them. Unknown review data stays unknown, avoiding the loading count flash.
- Added coverage for shown/hidden, fully reviewed, unequal progress and loading states.

## 2026-10-26 — Folder remaining/total counts

- Changes tree folders show unreviewed/total descendant counts beside their names, using the same category-scoped children as the folder Reviewed checkbox, including filtered and collapsed children. Styling matches category counts.

## 2026-10-26 — Update Guide from any workspace tab

- The top Settings menu enables Update Guide whenever a workspace is open, including Changes, Files and PR overview. Viewing the Guide is no longer a prerequisite.

## 2026-10-26 — Persist bot identity for immediate filtering

- Added an append-only migration caching GitHub bot identity on mirrored review entries. Sync refreshes actor identity for roots and replies even when comment text has not changed; old rows remain unknown until synced.
- Guide and Changes author filtering use cached identities immediately, including suffixless bot logins, without waiting for live PR details. Explicit user inclusion still wins.
- Regression coverage checks persisted root/reply identities, metadata-only refresh idempotence and offline filtering of suffixless bots. Typecheck, all 91 tests, lint, formatting and build pass. Migrated a scratch copy (schema 18 → 19, preserving all 261 entries) and verified the running app caches greptile-apps/datadog-official as bots. The installed database remains at schema 18; the dev app currently runs against /tmp/coxswain-bot-cache-check.

## 2026-10-26 — Conflict status glyph and neutral tab titles

- Merge conflicts use a filled orange square with an exclamation mark in native and fallback workspace tabs. Reverted approval title colouring; approval remains a filled green checkbox.

## 2026-10-26 — Workspace PR status icon colours

- Workspace-tab PR icons are green when open, a filled green checkbox when approved, purple when merged and orange for merge conflicts or failing head-commit checks. Conflicts/CI failures override approval for open PRs; closed PRs retain red. Native and fallback tabs share one tested colour policy.
- The batched core PR-title read also returns approval, mergeability and head check-rollup state, using the existing GitHub refresh path.

## 2026-10-26 — Stable Changes remaining count

- Keep the live review marks subscribed while Guide reads its pinned range, so the Changes count is ready on tab switches. Unknown review state no longer falls back to a full unreviewed count; regression coverage checks loading, partial and fully reviewed counts.

## 2026-10-26 — Softer active-file reveal motion

- Active-file following uses elapsed-time critical damping with gentle acceleration and retained velocity when retargeting. Reading updates remain isolated from React row/canvas rendering; animation frames perform only a fractional scroll write, without layout reads.
- Regression coverage checks gentle starts, target changes without restarting, settling, manual cancellation, Reduce Motion and equal positions at 60/120 Hz.

## 2026-10-26 — Restore animated active-file following

- Removed continuous canvas-to-sidebar offset mapping, which jumped without the requested reveal animation. Auto-follow again smoothly reveals the active file row (section title fallback when filtered out), only when it is outside the sidebar viewport.
- Retained rendering isolation: reading-marker changes update highlights imperatively without rerendering the app, canvas or sidebar file/thread rows. Equal markers do not restart scrolling; manual sidebar input cancels it.
- Regression coverage verifies native smooth animation for off-screen rows, no movement for visible rows and immediate Reduce Motion behavior.

## 2026-10-26 — Continuous Guide-to-sidebar progress

- Replaced boundary-triggered sidebar reveals with a continuous mapping of canvas section progress into the corresponding sidebar section. No second animation trails the main scroll, and adjacent section mappings meet without jumps.
- Sidebar reading updates no longer rerender its full file/thread list. They update marker attributes only when section/file changes, and apply the progress offset directly. Manual sidebar scrolling is unaffected until the main canvas moves again.
- Regression coverage checks smooth intra-section progression, continuity at section boundaries and viewport clamping.

## 2026-10-26 — Native Guide follow scrolling

- Replaced the JavaScript animation-frame follower with Chromium’s native smooth scroller. New reading markers queue only the latest destination until scrollend, so an active native animation is never repeatedly restarted.
- Manual sidebar input freezes native motion and clears the queued destination; Reduce Motion remains immediate. Regression coverage checks native delegation, queued-target replacement, completion, cancellation, visible rows and detached destinations.

## 2026-10-26 — Isolate Guide reading updates

- A local Chromium trace of #5769 showed React tasks of roughly 33–46 ms near scroll events. Guide reading markers previously updated top-level App state, rerendering retained canvas content as the current section/file advanced.
- Reading position now lives in a per-window transient store subscribed to by the Guide sidebar alone. Equal markers keep the same snapshot and do not notify; the canvas no longer rerenders for reading-marker changes. Added subscriber/snapshot regression coverage.
- Replayed the same two UI scroll actions in #5769 before/after: three scroll events in each trace. Maximum FunctionCall duration within 150 ms of scroll events fell from 45.64 ms to 12.87 ms; callbacks over 16 ms fell from three to zero. This is a small automated sample, not a guarantee for all trackpad gestures. Typecheck, all 88 tests, lint, formatting and build pass.

## 2026-10-26 — Smooth Guide follow timing

- Guide sidebar easing uses elapsed frame time with retained subpixel position instead of frame-count interpolation and forced one-pixel steps. Animation pace is consistent across refresh rates and its final motion no longer stair-steps.
- Added a regression test comparing 60/120 Hz positions at the same elapsed time; it failed with the old animation and passes with elapsed-time easing.

## 2026-10-26 — Continuous Guide sidebar following

- Guide sidebar following retargets one animation instead of repeatedly restarting native smooth scroll when reading markers advance quickly, especially in short sections with reviewed cards hidden. Manual sidebar input cancels the animation, as do covering or unmounting Guide; Reduce Motion stays immediate.
- Regression coverage drives rapid marker updates through one animation, checks the final reading destination and verifies cancellation and reduced-motion behavior.

## 2026-10-26 — Center the reviewed canvas empty state

- The Changes canvas all-reviewed state matches the sidebar: vertically/horizontally centered muted text above the shared bordered Show Reviewed Files button. It fills the available body rather than occupying a top-left row inside the diff virtualizer.

## 2026-10-26 — Quiet approvals without comments

- Submit Review hides the No open comment threads notice when Approve is selected, so approvals without comments do not show the empty-state warning.

## 2026-10-26 — Count remaining review files

- Changes reports unreviewed files; category file counts show unreviewed/total files. Category counts sit directly beside the category name with a 1 px downward optical alignment, with fixed-width diff totals and the Reviewed checkbox aligned on the right.

## 2026-10-26 — Omit empty change categories

- Changes hides Implementation, Tests and Generated sections when they have no visible files, including categories emptied by sidebar filters.

## 2026-10-26 — Folder review controls

- Changes tree folder rows have the shared Reviewed checkbox with unchecked, partial and checked states. Toggling marks/unmarks all changed descendants in the folder’s category, including filtered and collapsed children, without toggling expansion.

## 2026-10-26 — Match Changes canvas and sidebar ordering

- Changes canvas uses Pierre’s file traversal, shared with the sidebar’s row identities, instead of Git’s path order. It follows Tree/List layout and Implementation/Tests/Generated grouping. Guide sections keep their authored order.
- Regression coverage compares every canvas path to the sidebar model in all four layout/grouping combinations, including natural filenames and duplicate basenames.

## 2026-10-26 — Reliable hide-reviewed canvas control

- Settings menu dismissal waits one event turn so its close callback cannot swallow a selected checkbox action. Regression coverage checks selection-before-dismissal ordering and dismissal without selection.
- Hide Reviewed Files clears the old selection exception. Explicit sidebar navigation temporarily reveals only the requested reviewed card without changing the hide setting; selecting another file or reviewing it again removes that exception.
- Typecheck, all 84 tests, lint, formatting and build pass. The updated Settings item is present in the running app; end-to-end interaction verification was interrupted by concurrent user interaction.

## 2026-10-26 — Per-workspace remote updates

- The top Settings dropdown has Auto-update from Remote, on by default and persisted independently for each workspace in SQLite settings. Clean checkouts follow force-pushes and remote rewinds without creating recovery branches.
- Local edits, untracked files and unpushed commits disable auto-update before fetching. The core watcher detects local work between remote checks, and the updater checks again for work made during a fetch. Cleaning up does not re-enable it automatically.
- Regression coverage uses real Git histories for force-pushes, remote rewinds, local commits, untracked edits, per-workspace isolation and edits/commits made during fetching. Typecheck, all 82 tests, lint, formatting and build pass; verified the option in the running app’s top Settings dropdown.

## 2026-10-26 — Restore native workspace close buttons

- Moved required dependency patches and build permissions from the retired package.json pnpm field into pnpm-workspace.yaml. Dependency restores with pnpm 12 now preserve the native hover close controls and the Claude adapter patch.
- Corrected cumulative new-file offsets in the native patch so the current package manager accepts it. Rebuilt the native bridge with hover actions enabled.

## 2026-10-26 — Scope menus to their surfaces

- Sidebar menus now contain only sidebar filters and file-list layout/grouping. Section Descriptions and Update Guide moved to the top Settings dropdown alongside a separate Hide Reviewed Files option. Sidebar reviewed-file filtering no longer changes the canvas.
- Typecheck, all 81 tests, lint, formatting and build pass. Verified the relocated controls in the development app’s Settings dropdown. Closed older development launchers and app processes, leaving the latest instance.

## 2026-10-26 — Guide description placement

- The top Settings dropdown switches section descriptions between Beside Files (default, responsive columns) and Above Files (stacked at every width). Above Files keeps descriptions in normal scrolling flow and gives file cards the canvas width. Like other display options, the choice resets on restart; persist display preferences together in SQLite.
- Verified Above Files in the running development app. Typecheck, all 81 tests, lint, formatting and build pass.

## 2026-10-26 — Safe window-close cleanup

- Window-button alignment retains its web contents reference before closure; cleanup no longer reads properties of a destroyed BrowserWindow, fixing the main-process “Object has been destroyed” exception on close.
- Regression test reproduces Electron's throwing property getter after destruction, verifies close succeeds and listeners are released, and passes alongside the existing layout lifecycle test. Dependencies restored: typecheck, all 81 tests, lint, formatting and build now pass. The installed app still needs repackaging to receive this fix.

## 2026-10-26 — Hide reviewed cards and advance review

- Hide Reviewed Files now removes complete file cards in both Changes and Guide; the Guide menu also updates the canvas. Guide explanations stay visible.
- Marking an individual file Reviewed scrolls the next unreviewed card below the toolbar, skipping reviewed cards. Explicit navigation can still reveal a reviewed file.
- Validation is incomplete: this checkout lacks dependency executables and package-manager dependency verification cannot reach the registry. Typecheck, lint, formatting, build and running-app checks remain pending.

## 2026-10-25 — Align category diff totals

- Implementation, Tests and Generated diff totals now align with file-row totals at the sidebar’s right edge, before the shared Reviewed checkbox. Category file counts stay beside the heading.

## 2026-10-25 — Stable Changes category disclosures

- Category and folder chevrons share a fixed 16-point slot and common glyph geometry in both states. Titles keep the same horizontal position when toggled, and chevron tips align with the tree-line axis. Tree indentation and connector offsets share explicit CSS metrics. Verified expanded/collapsed category positions and nested connectors in the running app.

## 2026-10-25 — Review defaults, category review controls and window chrome

- Claude Code/Opus 5.5 is the default for Guides and new Claude review conversations. Guide defaults no longer inherit retired summary preferences; explicit Guide settings remain supported. Set the running packaged app’s Guide model to Opus 5.5.
- Implementation, Tests and Generated headers use the same tri-state Reviewed checkbox as Guide sections and file rows. Category actions review/unreview every changed file in that category, including filtered files, without changing its expansion.
- The default Guide prompt ends implementation sections with a separate Tests section, then a separate Generated section, omitting empty groups. Automatic generation supplies group metadata from the shared Changes classifier. Used writing-for-agents for the prompt update and added prompt regression assertions.
- macOS traffic lights reapply their centered 44-point-bar inset after native window layout, resize/restore/maximize/focus and renderer reload. Coalesced callbacks skip fullscreen and release on close; lifecycle regression coverage checks these cases.
- Verified category bulk unreview, partial state and bulk review in an isolated database copy. Typecheck, lint and all 80 tests pass. Rebuilt 1.8.0 artifacts under dist/1.8.0 to leave the earlier running bundle intact.

## 2026-10-25 — Version 1.8.0 bundle

- Bumped the app version to 1.8.0 for a local macOS Apple Silicon bundle and DMG/ZIP artifacts. Packaging uses the existing unsigned release configuration; no release is published.

## 2026-10-25 — Stable Guide picker loading layout

- Moved model/effort loading into each picker’s reserved chevron slot as a small shared spinner. Removed the conditional loading row, so discovery does not grow or shrink Update Guide/Settings. Busy state remains accessible through the button and status label.

## 2026-10-25 — Anchor Submit Review to the main panel

- Moved the floating review action into the main canvas panel, outside scrolling content. Its right inset now follows the panel when Chat opens, closes or resizes, instead of covering the right sidebar. The native glass button and modal behavior remain shared. Verified placement with Chat open in the running app.

## 2026-10-25 — Guide agent override

- Update Guide now includes a Claude Code/Codex switch alongside model and effort, with a reset to App Settings. Switching agent clears incompatible overrides and reads that agent’s saved Guide defaults without changing settings or Chat.
- The typed one-update override carries the selected agent through the existing core event/job runner. Regression checks cover execution on the alternate agent, later jobs returning to the configured agent, and read-only lookup of per-agent defaults.
- Verified switching to Codex, loading its model/effort options and resetting to the app default in the running dialog, without starting generation. Format, typecheck, lint, build and all 79 tests pass.

## 2026-10-25 — Guide model and effort overrides

- Settings → Guides now remembers model and effort defaults per agent. Update Guide reuses shared native pickers for one-update overrides, with separate App default and Agent default choices. Model changes reset effort; effort choices are discovered for the selected model in a temporary session without changing Chat.
- Model discovery returns as soon as choices are ready instead of waiting for adapter session teardown. Results deduplicate/cache for five minutes, the model catalog stays usable while effort loads, and errors are retryable.
- Overrides travel through the typed core event and existing background job runner, survive queued manual requests and retries, and do not change automatic defaults. The one-shot agent applies model before effort and reports unsupported explicit effort rather than silently ignoring it. Added regression coverage for override isolation, explicit agent defaults, inherited app defaults and persisted effort per agent.
- Verified model/effort controls in App Settings and the native effort menu in Update Guide; selected and dismissed a one-update override without generating. Format, typecheck, lint, build and all 79 tests pass.

## 2026-10-25 — Keep sidebar position when opening PR overview

- Guide tracking stops while PR overview is open. Navigation disconnects its resize observer and cancels pending reading-marker timers; detached canvases cannot update the current section/file. The sidebar suspends automatic reveal during overview, preserving the current highlight and scroll position.

## 2026-10-25 — Visible review verdicts

- Submit Review always shows Comment, Approve and Request Changes for a PR, even without draft threads. On your own PR the latter two remain visible but disabled, with an explanation, rather than disappearing. Other authors’ PRs retain the existing verdict submission flow.

## 2026-10-25 — Shared modal styling

- Shared dialogs use an elevated theme-aware surface, softer backdrop, 20-point outer corners, clearer headings and muted descriptions. Fields use the shared 12-point card corners and a subtle focus ring. Keyboard focus stays inside the modal and returns on dismissal.
- Update Guide has a labeled instruction field, persistent-instruction hint and a separate footer with a primary update action; multiline input uses Command-Enter to submit. Submit Review gets a wider layout, inset thread cards, a dedicated summary/verdict area and a consistent action footer. Posting/confirmation behavior is unchanged.
- Checked both dialogs in the running app, including keyboard wrap and Escape dismissal, without submitting a review or regenerating the Guide. Format, typecheck, lint, build and all 79 tests pass.

## 2026-10-25 — Review navigation, group totals and PR overview styling

- Changes/Guide file picks explicitly target their review pane. The retained Files tree only receives its active selection and cannot open files while hidden; programmatic reveal does not invoke navigation, and Pierre callbacks read the latest handler. Verified Changes and Guide picks staying in their panes.
- Implementation/Tests/Generated headings show summed added/deleted lines beside their file counts. Verified grouped tree/list modes, collapsing groups and disabling grouping through the native menu.
- The PR overview uses the current canvas/card surfaces, 12-point corners, roomier spacing, subdued status pills and clearer description/conversation/checks/people hierarchy. It uses the same shared Prose/Mermaid renderer and expand interaction as Guide, including diagram card styling.
- Fixed blocked PR images: HTTPS image hosts are allowed by the image-only CSP; script/default policy stays unchanged. Repository-relative PR images use the existing core readFileAt at the PR head (including private repositories), GitHub blob URLs become raw-image URLs, and unavailable images show a quiet labeled fallback. All five distinct public Greptile badge paths found in PR #5834 returned HTTP 200 SVGs; PR #5827 includes a Mermaid diagram using the shared renderer. Added URL/path resolution regression tests.
- Visually checked the PR overview, loaded Greptile badges and Mermaid diagram in the running app. Source init/frontmatter themes cannot override the shared app palette, fixing pale text on pale boxes; added a regression test across light/dark/Soft Dark. Inline diagrams have a bounded height and retain the expand preview.
- Checkout launches use a cached, separately named macOS development bundle so the Dock identifies coxswain rather than Electron. The dependency runtime is left untouched; the copy is rebuilt when Electron or the bundle recipe changes.

## 2026-10-25 — Group Changes by implementation, tests and generated files

- Changes defaults to collapsible Implementation, Tests and Generated groups with file counts in both tree and list layouts. Each reuses the Pierre folder model and shared file/thread rows, under one scrollbar; keyboard navigation crosses group boundaries. Existing filters apply before grouping, and group expansion stays when returning to Changes.
- Added a native dots-menu checkbox to disable grouping independently of Tree/List. Like the existing layout preference, this is per-window state.
- Path conventions classify test directories/filenames and common generated directories/suffixes, snapshots and lockfiles; generated takes precedence. This is presentation over the core’s changed paths, with no file reads. Regression tests cover cross-language test conventions, generated test artifacts and ordinary source/docs/configuration.

## 2026-10-25 — Whole-file editor tabs and stable inline drafts

- Files now uses closable file tabs above an edge-to-edge Pierre file canvas, with no card header, border or outer margin. Tree, Open Quickly and code navigation share tab opening, preserving revision identity, neighbor selection after close and last-file restoration after Guide/Changes. Tabs use shared controls/language icons, native full-path tooltips, keyboard navigation and middle-click close. Router-owned tabs remain per-window; no new storage.
- Files has its own retained canvas surface, so it no longer replaces Changes geometry or renders a hidden Guide. File reads can start without waiting for Guide/diff/review queries. Added tests for duplicate/revision tabs, pane restoration and active/inactive/last-tab closure.
- Draft input focus uses preventScroll, keeping the chosen line in place as the annotation opens beneath it. Verified insertion on line 318 in Changes without moving that line; dismissed the empty test draft without posting.
- Checked opening two files, closing the active tab and returning through Guide in the running app.

## 2026-10-25 — Keep native workspace chrome stable during page zoom

- Inset the draft comment close control inside the textarea so its hover background cannot cover the rounded field border; text reserves room for the control.
- Native workspace controls retain their window-point sizes while ⌘+/⌘− zoom review content. Counter-zoomed DOM anchors keep the tabs, action groups and traffic-light clearance aligned; sidebar and canvas insets track the fixed native bar height. Thread navigation measures the actual bar clearance.
- Verified zoom out, zoom in and reset in the running app. No toolkit fork or additional persistence is needed.

## 2026-10-25 — Align review disclosure controls

- Paired context chevrons have more vertical separation without stretching their shapes; the file-header chevron compensates for its one-pixel border inset.
- File disclosures brighten only the chevron on hover, matching the unchanged-lines controls without a button background.
- Moved thread expand/collapse controls before the author or collapsed summary, keeping resolve/options on the right. File-header and unchanged-lines chevrons now share their 14-point size and line-number center; the gutter is measured from Pierre’s rendered number column.

## 2026-10-25 — Shared file/thread groups and filters in Changes

- Folder disclosure buttons explicitly align their contents left, so label length cannot shift the apparent tree indentation. Checked the nested Changes hierarchy in the running app.
- Extracted SidebarFileThreads for Guide and Changes: the same language icon, optional folder hint, diff totals, Reviewed checkbox and two-line avatar/thread pills. Changes nests thread pills below files, preserves raw-diff navigation, and includes file-anchored Guide threads with their replies; section-only discussions remain in Guide.
- Both dots menus use one native filter-item builder and one visibility policy for reviewed files, resolved threads, agent/comment kinds and authors, including bot defaults. Changes keeps Tree/List choices. Folder suffixes are suppressed in tree rows; ambiguous flat-list names retain them.
- Pierre’s public model supplies Changes hierarchy, ordering, flattened directories, folder expansion and keyboard focus; shared React groups render variable-height thread rows. Full Files trees retain their existing virtualized rendering and worker preparation. Debt: Changes groups currently render the model’s visible projection without windowing; measured group-height virtualization is the upgrade for very large diffs (ponytail in ChangesNavigator).
- Added shared thread-filter regression coverage. Existing review and navigation tests remain.

## 2026-10-25 — Keep Guide/Changes geometry across tab switches

- The primary Guide/Changes flicker came from recreating Pierre virtualizers and briefly drawing empty code bodies. Retain both measured/rendered canvases within the active workspace, with inactive surfaces invisible and inert while preserving layout size. First visits stage pending visible code rendering, bounded to 30 frames. Workspace changes release the two surfaces.
- Scoped section/file/thread anchors to the requested canvas and excluded invisible surfaces from Find, preventing duplicate-id navigation into a retained tab. Scroll capture from inactive surfaces is suppressed. Collapsed reviewed cards render headers immediately without triggering offscreen file reads. Added an anchor-scoping regression.
- Working/Queued/permission/error status now lives inside the inset Agent response card, even before the first output. Prose threads and drafts lose extra horizontal card margins; unplaced text threads lose their extra 24-point side padding. Code-line threads keep their existing inset.

## 2026-10-25 — Off-thread tree ordering and lighter scroll frames

- Files trees above 1,000 paths prepare Pierre’s own ordering in one renderer worker, then use its public presorted-input API. Preparation is query-cached by immutable source-path identity, without private serialization or custom sorting. Worker errors fall back to regular construction. An existing tree stays visible while changed paths prepare, avoiding a new background-refresh blank. A local synthetic 18,000-path check measured live-model construction at 46 ms ordinarily versus 8 ms with presorted input; preparation time is moved off the UI thread, not eliminated.
- Verified the large Files tree in the running app and added an equivalence test for ordering, flattening and visible rows after the worker data boundary.
- Scroll offsets save cheaply on every event; DOM anchor/reading measurements run at most once per frame and are cancelled across pane/screen navigation. Reused viewport measurements remove repeated layout reads. Guide sections no longer rebuild when only review visibility changes. The shared language-icon sprite mounts once per window instead of on each Guide return.

## 2026-10-25 — Remove warm-switch placeholder flashes

- Reopened stacked diff cards read cached sides on their first render rather than waiting for IntersectionObserver and briefly substituting an estimated-height placeholder. Query-owned immutable file contents keep stable Pierre highlight/diff cache keys across remounts; edits and filename/language changes get fresh identities through a weak cache.
- Workspace switches prepare a saved Guide’s range, entries, review marks and first cards before replacing the current canvas. This does not wait for the GitHub check, does not run model work, and skips live Changes/Files destinations. Latest-request guards prevent a slower earlier switch from winning after a newer selection or close. Existing query freshness and invalidation rules apply.
- Regression coverage checks highlight cache identity after edits/renames and preparation without a network/worktree wait or repeated reads. Large uncached files still load lazily.

## 2026-10-25 — Recorded interaction performance and navigation continuity

- Recorded startup, Guide/Changes/Files transitions, a second-workspace open and cached return using opt-in Electron Chromium traces, development React Profiler measures and core-call measures. Verified file-folder expansion across tab returns and Activity open/Escape dismissal in the running app.
- Event-owned local queries reuse cache until a core event; GitHub refresh also invalidates derived ranges after a possible fast-forward. Avoid rewriting tab-open preferences when selecting an already-open tab. Code-theme reads fell 8→1, comment-setting reads 6→1, changed-file reads 10→6 in comparable recordings; first file enumeration fell 146→118 ms. A final cold-start change reads the saved Guide’s immutable range before GitHub finishes: canvas readiness on the same workspace improved 3,161→146 ms in the recorded development runs. Live Changes still waits for the real worktree check. The first large Pierre tree model still costs a frame; this pass does not claim that eliminated.
- Replaced per-file synchronous existence checks with bulk git listing/deletion queries. Visited Changes/Files models stay mounted only within the current workspace. Reused visible-path filtering uses a Set and memoization.
- Canvas positions are kept per surface and restored before paint, including a canvas remounted after Settings. Restore retries cancel on user input and navigation, with regression tests; the Guide reading observer reconnects after Settings. Added cache-invalidation and untracked/deleted-file coverage.
- Local diagnostics: run dev with COXSWAIN_TRACE_PATH set to an absolute JSON path; SIGUSR2 saves the trace (PID in the adjacent .pid file). Packaged apps ignore it. Trace files remain local and are not checked in. Development performance marks/profiling are omitted from production rendering.

## 2026-10-25 — One Guide, updated in place

- Removed the duplicate File Sidebar submenu from toolbar Settings; its dots menu owns tree/list choices. The enabled GitHub logo uses explicit appearance-aware contrast instead of the native shape’s dim default fill.
- Submit Review is a floating bottom-right button, using native glass where available and the shared primary button elsewhere. It shows the pending count and yields to dialogs. PR overview has a dedicated toolbar button, and the old Review menu is removed. Closed workspaces reopen through the command palette; duplicate diff/range/Guide choices are removed. Commits/Turns in Changes owns range navigation. The external PR button uses the GitHub mark in both native and HTML toolbars.
- Each workspace exposes one Guide. Automatic and manual publication reuse its stored identity atomically; no new numbered Guide is created. Previous content remains readable until a successful replacement, and stale runs cannot overwrite a newer request.
- Update Guide opens a shared dialog with optional instructions. Core SQLite keeps them per workspace for future automatic updates; blank instructions restore the default. Removed the saved View list, New View/removal actions, and saved prompt library from Settings and IPC. Agent tools now use start_guide/read_guide against the same document.
- Existing latest Guide records are adopted. Legacy rows and historic entry anchors are retained without a destructive migration; internal storage types keep their existing names. Guide scroll restoration also follows replacement ranges under the same identity.

## 2026-10-25 — Matching Activity spinners and Changes list inset

- The native toolbar now draws the same thin 14-point, rounded 80% arc as the Activity list, at one rotation per second, through SwiftUI TimelineView. Replaces the system progress glyph while retaining the native toolbar button.
- Changes in list mode has a 16-point left inset; tree mode retains its connector geometry.

## 2026-10-25 — Quieter Activity indicator and nonmodal toolbar

- Activity uses the native mini spinner in a 14-point frame at muted opacity, keeping its visual weight alongside the toolbar symbols. The pinned native bridge applies SwiftUI’s mini control size to indeterminate progress.
- Opening Activity leaves the toolbar enabled, including the Activity button to close the list; modal dialogs still disable native controls.

## 2026-10-25 — Dedicated Activity toolbar control and card list

- Activity has its own native top-bar button, using an indeterminate SwiftUI progress indicator while any background job runs; the web toolbar mirrors it. Removed the duplicate review-menu action and reserved the added chrome width.
- Activity opens below the bar with the app’s 12-point corners, hairline card borders and surfaces, compact header actions, muted time/model details and running count. Running/failed rows retain progress and Stop; completed rows stay quiet. Close, Escape and outside clicks dismiss it.

## 2026-10-25 — Configurable Guides, without file summaries

- Settings has a dedicated Guides agent/model picker using installed-agent model discovery. Choices persist per agent, inherit existing model preferences initially, and are passed explicitly to the shared job runner. Tests cover persistence, per-agent recall, legacy defaults and the actual model used by guide jobs.
- The Guide dots menu starts with Update Guide. It requests forced regeneration through the existing core event/job flow, with progress in the sidebar and old content retained until publication.
- Removed speculative file-summary generation, cache reads/writes, settings, coverage UI and the file_summaries agent tool. Views list changed paths/status/counts and read diffs directly; list_changed_files retains pagination without model work. Guides consume diff evidence directly. Comment summaries and the shared job runner remain.
- Historical job rows and immutable migrations remain for compatibility; the unused cache table is no longer part of the active typed schema. No new migration or deletion of user history.

## 2026-10-25 — Shared sidebar labels and highlight rendering

- Changes diff totals keep a nonbreaking space between additions and deletions so Pierre’s separate text spans cannot collapse the gap; deletion-only counts have no leading spacer.
- Guide and Changes/Files now use the same React filename/path label component and row-highlight stylesheet. Transparent native ellipsis replaces Pierre’s painted truncation masks, including flattened directory chains, preventing rectangular gaps over rounded hover/selection surfaces.
- Pierre indentation uses one uniform step, with ancestor stems centered beneath their folder disclosure arrows instead of accumulating independent padding/gap offsets.
- Guide and Pierre indentation now share one connector stylesheet, including identical 12-point slants and the curved last-branch mask; the final join no longer extends farther than intermediate joins.
- Pierre still owns virtualization, folding, selection and keyboard navigation. Its existing mounted-row bridge exposes label hosts for React portals; native path tooltips, muted status colors, duplicate-name folder hints and review inputs remain. Debt: replace the bridge with supported row slots when Pierre exposes them.

## 2026-10-25 — Clear hull without overlapping shafts

- Trimmed each paddle’s vector shaft to end just 14 px inside the curved hull boundary, allowing a short glass overlap. The shaft tips have smooth rounded caps. The glass boat no longer shows three overlapping chevrons through its center; paddle shape, centered arrangement and native materials remain. The previous source is retained under `resources/icon-concepts/clean-hull/`.
- Regenerated production PNG/ICNS exports through Icon Composer. Verified 16–128 px previews and the packaged native About panel with scratch data. Typecheck, all 63 tests, lint, formatting and build pass.

## 2026-10-25 — Vertically centered paddles

- Moved the complete paddle arrangement down 72.847 px in the Composer canvas so its upper and lower silhouette bounds balance around the hull’s vertical center. The hull, paddle shapes, row spacing and materials are preserved. Regenerated PNG/ICNS exports and compared 16–128 px previews; the previous source is retained under `resources/icon-concepts/centered-paddles/`.

## 2026-10-25 — Clearer app icon at small sizes

- The glass crew has a 12% wider oar spread, thicker shafts and a slightly wider, shorter hull so its silhouette holds together at 16–32 px. Rounded asymmetric blades, 45-degree axes and the saved glass materials remain.
- Regenerated the production PNG and all ICNS sizes through Icon Composer. The tile footprint and Dock padding stay the same. Before/after previews and the previous editable source are retained in `resources/icon-concepts/small-size/`.
- Verified at 16, 24, 32, 48, 64 and 128 px and in the packaged native About panel using scratch data. Typecheck, all 63 tests, lint, formatting and build pass; the packaged ICNS matches the export.

## 2026-10-25 — Shared sidebar status colors and highlights

- Sidebar status colors blend 80% of the theme color with 20% label gray, softening filenames/icons consistently without reducing text opacity.
- Guide and Changes/Files share the selected code theme’s status palette for filenames and language icons: added, modified (including renames), and deleted. Optional folder hints remain muted.
- File rows share Guide’s 12-point filename size, smaller 11-point metadata, 14-point icons and 28-point height.
- Pierre rows now use Guide’s neutral hover/selection surfaces, 12-point corners and inset highlights with the same 3-point gap, preserving independent native review controls and keyboard navigation.

## 2026-10-25 — Consistent file navigation and review disclosure

- Flat Changes rows keep filenames in a single-line, shrinkable ellipsis label; duplicate-name folder hints shrink separately, preserving diff totals and review controls at narrow widths.
- Changes/Files retain Pierre folding and keyboard navigation while matching Guide’s language icons, filename hierarchy, optional middle-truncated duplicate-name folders, diff totals, rounded hover states, thin tree connectors and right-aligned native review checkboxes. Review controls do not navigate. Full-path titles also cover the tree’s actual truncated text fragments before hover.
- Reviewing files or whole sections closes their cards even after a previous sidebar reveal. A subsequent selection reopens them; small header disclosures expand/collapse independently of review state. Resolving threads overrides earlier reveals; selecting the same resolved thread again reopens its contents without changing resolution, with matching header disclosures. File-header disclosure preserves its viewport position through virtualized height changes and cancels on user scroll/input.
- Debt: Pierre currently accepts only text/icon row decorations. A small mounted-row bridge adds native review inputs and tooltip labels; replace with interactive row slots when supported upstream.

## 2026-10-25 — Native full-path tooltips

- File labels in Guide and Changes/Files expose the original full path through Electron’s standard native tooltip handling, with the system hover delay. Pierre’s shadow-tree rows receive titles before hover, refreshed on row creation/recycling, including flat lists; filename text has its own explicit title; status decorations retain their review/thread information after the path. No custom tooltip overlay or timer.

## 2026-10-25 — Light-mode sidebar contrast

- Guide tree stems, slanted connectors and curved final joins use a stronger neutral color in light appearance. Section, file and thread hover backgrounds also have more contrast. Shared Guide color tokens retain existing dark-mode colors and row geometry.

## 2026-10-24 — Automatic guides and sidebar continuity

- Opening/checking a workspace generates a concise guide through the existing background job engine; PR/worktree events refresh changed ranges. Matching complete guides are reused. Runs coalesce, newer ranges supersede older ones, and complete replacement views publish atomically while previous views remain available. Activity records the jobs; the Guide sidebar shows generating/updating status, failures and Retry. Uses the configured background agent/model. No database migration.
- Automatic guides run even if speculative file summaries are disabled; the existing Ahead preference continues to govern only those summaries.
- Guide instructions now ask for short thematic explanations beside code cards, without snippets, per-line narration or a review report. Automatic output is validated for exact file coverage before publication.
- Returning to Guide restores its last scroll position and reading highlight immediately, without transient highlight flicker. Background publication preserves the reading position and does not interrupt Changes or Files.
- Closed workspace tabs persist across restarts in per-workspace SQLite settings, with reopen and cross-window updates. No workspace deletion or migration.
- Left sidebar defaults open at 336 points; Commits/Turns defaults collapsed and only appears in Changes. Guide shows reviewed files and resolved threads by default, with Hide options. Human authors start visible and bots hidden using GitHub actor metadata; author-menu choices can include either.
- Tests cover generation/reuse/update, retained guides on failure, retry, stale-run suppression, output validation, author defaults and closed-tab persistence. Debt: automatic guide context is bounded to 1,800 diff lines, 160 per file, supplemented by cached summaries; a repository-reading job is the upgrade path for very large changes.

## 2026-10-24 — Guide navigation and nested threads

- Guide is now the first/default Navigator tab, ahead of Changes and Files. Left-aligned rows list numbered titles; file and added/deleted line totals appear only for sections with files. Threads nest beneath their section and group by filename in the same scrollable list. Compact two-line thread rows show clean text previews and status and one total reply count without line numbers or colored dots. Show Resolved Threads is a native checkbox that adds resolved threads alongside open ones, rather than switching between separate lists. Removed the obsolete thread-list empty message and show-resolved button now that threads are nested in Guide. Section totals sit closer to the heading. Selecting a resolved thread expands it without reopening, including prose threads, with unmatched threads under Other threads and the native filter menu in the tab header. Changes opens the raw diff. The right sidebar holds only Chat, without an extra Chat header. Picking a section scrolls to it below the glass toolbar; picking the tab opens the newest view when needed.
- Guide now defaults to all unreviewed changed files. Its options independently include reviewed files or restrict the list to files with matching threads, alongside resolved threads, agent threads and comments. File cards reuse Pierre’s language-specific file icons, filename, muted path and per-file diff totals, with deleted files struck through. Thread previews include author avatars with a person icon fallback. An Authors submenu filters thread authors independently and offers Show All Authors. These display choices last for the window, like other Navigator settings.
- Thread pills align with the file highlight’s left edge, removing their extra left inset; 2-point vertical wrapper padding keeps a small gap from the file highlight.
- Unchecked sidebar checkboxes are quieter, strengthening on hover/focus while checked and mixed states retain full contrast.
- Guide files and sections use right-aligned native Reviewed checkboxes in a shared column. File names navigate independently of review actions. Changes/Files review marks use the same blue.
- Selecting a file reveals its diff even when reviewed, keeping the Reviewed mark and other cards collapsed. File jumps retain toolbar clearance while lazy content settles.
- Thread jumps align the annotated line below the toolbar and sticky file header rather than centering a response. Guide file rows use plain text on the sidebar background, connected to sections with subtle tree branches with slanted connectors and compact file rows without extra gaps. The last branch has a soft curve aligned to the other connectors’ endpoint, and the vertical line reaches up to the section number. Thread rows use bordered 12-point pills instead of file pills; groups have 8-point separation and aligned title/file/avatar columns. Folder paths appear only for duplicate filenames, with middle truncation preserving their endings.
- Partially reviewed sections show a neutral native mixed-state minus in their Reviewed checkbox; none/all remain unchecked/checked.
- Sidebar threads now only navigate; resolve/reopen is available from the main panel, with the shared rounded check icon.
- Constrained thread metadata to the available card width so long author/status text truncates without overflowing.
- Guide section, file and thread rows share 12-point corners and consistent hover washes. Thread metadata puts the reply count before Resolved.
- Sidebar section headings with files include a right-aligned native Reviewed checkbox with unchecked/mixed/checked states, sharing the main panel’s section review action without navigating.
- Sections without files show muted No files subtext beneath the title.
- Sidebar section numbers use the system font, matching title size and line height and aligning on the first baseline.
- Guide sidebar hierarchy uses 13-point semibold section titles, regular secondary file names, subdued counts and quieter thread previews with softer pill surfaces and borders.
- Guide sidebar content has 16-point right padding and a stable scrollbar gutter, keeping rows and highlights away from the scrollbar.
- Section/file highlights paint 1.5 points inside their vertical bounds, adding a 3-point visual gap without changing layout or hit targets.
- View switches clear reading highlights before paint and defer their initial reading until scroll/resize corrections settle, preventing Changes-to-Guide highlight flicker. Normal scroll tracking remains immediate.
- Section and file highlights follow canvas scrolling rather than the last click, with a subtle wash. Sidebar following prioritizes the current file, falling back to its section, and uses smooth scrolling unless Reduce Motion is enabled. Reading position is transient and does not add router history.
- Section titles and their first file share the section scroll destination, preserving the explanation on stacked layouts and revealing a reviewed file when picked. Removed the immediate file scroll that competed with scroll restoration.
- Sidebar selection and section jumps live in the router, with Back/Forward and existing scroll restoration. Empty views show No guide sections.

## 2026-10-24 — Inline comments and sidebar menus

- Inline composers use a raised gray card, outlined text area, corner close control, icon-labelled mode choices and circular send control. Own entries show author metadata and relative time without an Agent comment badge. Threads use compact padding and reply fields with 12-point gaps between messages; agent replies have a slightly darker inset surface with 16-point padding and no left border, including while streaming. Removed the message divider and restored outlined composer fields with 8-point text insets. Composer fields and inset replies share the cards’ 12-point radius. Removed the redundant inline line label while retaining the accessible anchor. Resolve and thread actions now share the first human author row and its menu; Edit is limited to comment threads. Annotation backgrounds match the diff, and threads grow without internal scrollbars. The mode switch appears only for a new thread; replies follow its established kind.
- Changes/Files and Threads use small muted ellipsis menu buttons. Show Reviewed Files now lives in the file menu alongside tree/list layout; Threads keeps Open/Resolved and counts in its menu.
- Empty thread filters match the Changes empty state: centered muted status and a bordered button to show the other filter when it has threads; no button when there are no threads at all.
- Only when all changed files are reviewed and hidden, Changes shows a centered empty state with a muted, bordered Show Reviewed Files button. The state disappears when any files are visible, including reviewed files revealed by that button.

## 2026-10-24 — Threads and Chat sidebar tabs

- Replaced the stacked Chat/Threads split with full-height tabs, defaulting to Threads. The Open/Resolved filter
  is a native dropdown at the right of the shared tab header, instead of a second tab row.
  Removed the file-review summary row; thread navigation and resolve controls remain in Threads. Both tab contents stay mounted
  while switching to preserve drafts, session state and filters.
- Prompt attachments and review work sent to an agent open Chat; Show Threads selects Threads. Find follows
  the active tab. Removed the obsolete vertical Threads divider, height and collapsed state.
- File/Changes trees use 8-point nesting and smaller row insets to leave room for filenames. Their foreground,
  selection and git colors follow the selected code theme via Pierre’s theme resolver; appearance still owns surfaces.
- Shared segmented controls now support accessible tabs with roving focus and arrow/Home/End navigation.
- Debt: selected sidebar tab lasts for the window; persist it with pane geometry if session restoration needs it.

## 2026-10-24 — More breathing room in review content

- Guide section text uses a tighter 1.65 line height, down from 1.8, while retaining paragraph and section spacing. File-card Reviewed controls use the same muted label colors as section controls.

- Scrollable sticky section explanations have 16 points of right padding so overlay scrollbars stay clear of text.
  Their tracks stay transparent on hover; the thumb appears during scrolling and hides after 700 ms idle. CSS scroll-state
  queries enable internal scrolling only while the explanation is sticky, without changing its measured height.
- Increased canvas padding to 24 points (40 in wide windows), keeping the sticky top gap aligned with the sides.
- Guide sections have 48-point spacing; file cards have 32-point gaps, with 40 points between explanation and
  code columns on wide canvases. Diagram preview side insets follow the wider gutters.

## 2026-10-24 — Soft Dark appearance and code themes

- Added Soft Dark in Settings and the native Settings menu. Its sampled reference colors are #1f2023 for
  the canvas, #28292c for cards, and #2a332f/#392d30 for diff fills. Shared neutral tokens recolor panes,
  controls and dialogs; diagrams follow the palette and native controls stay in dark mode.
- Added an independent Code Theme choice: Default/Pierre, One Dark (reference), GitHub and Catppuccin, each
  with light/dark variants. Code colors update live without replacing the app surfaces.
- A Python sample below the code-theme picker previews hovered/focused options; only clicking saves a choice.
  The tiny preview uses an independent highlighter, while saved choices update the shared worker pool for diffs.
- Both settings persist in the existing SQLite settings table, emit settings events, and are covered by a
  reopen/independence regression test. No schema migration is needed.

## 2026-10-24 — Reviewed cards collapse completely

- Collapsed reviewed cards hide their entire body, including context spacing and annotations. Previously
  Pierre collapsed the code rows while the card body remained, leaving a narrow strip below the header.
- Collapsed headers own all four rounded corners and the single bottom border.

## 2026-10-24 — Guide section counters

- Authored guide sections show a muted, zero-padded position/total counter below their title, including
  text-only sections. The synthetic ungrouped-files section stays unnumbered; sticky explanations retain the counter.

## 2026-10-24 — Quieter diff markers and context

- Slimmed red/green change markers from 4 px to 1 px. Unmodified-line separators use centered muted labels between hairline dividers,
  without a filled background. Existing expand controls and measured row heights remain intact.

## 2026-10-24 — Consistent sticky top spacing

- Guide text, initial file cards, sticky card headers and sticky section explanations use the same
  16/32-point gap below the toolbar as the side gutters. Scrolling no longer pulls the cards closer to the toolbar than the guide's initial position.

## 2026-10-24 — Threads in the right sidebar

- Guide sections without files use a centered 800-point column. Guides have 24 points more initial top
  spacing while sticky header clearance stays consistent.

- GitHub and live preview links are direct top-bar controls. A single preview opens immediately; multiple
  environments use a native menu. Disabled slots preserve tab positions when these links are unavailable.

- Removed the bottom review bar. Threads now occupy a collapsible, vertically resizable section below chat,
  with Open/Resolved filters, per-file grouping, review progress, line totals, and the existing reveal/resolve actions.
- The Show Threads command opens the section; Review → Submit Review and the command palette retain review submission,
  copying and sending comments to an agent. Sending feedback appears in the sidebar.
- Removed Back, Forward, Open Quickly and Threads from the Review dropdown; shortcuts and command-palette actions remain.
- Reclaimed bottom canvas space and expanded diagram previews to a 16-point bottom inset.
- Debt: the Threads section's height and collapsed state reset on restart, matching the left history section.

## 2026-10-24 — Selected glass crew app icon

- The selected rounded crew concept is now the canonical `resources/coxswain.icon`: a fluid pale hull and
  three pairs of asymmetric glass oars at 45 degrees, without an orange marker. The previous shell design is
  retained in `resources/icon-concepts/shell-before-crew.icon` for reference.
- Native Composer exports replace the app's PNG and multi-resolution ICNS. Existing dev Dock and package
  wiring uses those files, and `pnpm icon` regenerates them from the selected document without changing it.
- Typecheck, all 58 tests, lint, formatting and build pass. The packaged ICNS matches the production export,
  and the new crew icon is verified in the native About panel using a scratch database.

## 2026-10-24 — Workspace bar grouping

- Workspace tabs have equal widths; switching the active tab no longer resizes them. Native separator slots
  stay reserved when hidden beside the active tab, keeping positions steady.

- New workspace has a separate circular glass group directly beside the tabs, before Review, Settings and chat.
- Added 16 points between the window controls and file sidebar button. Removed the agent pane's duplicate
  hide toggle; the main bar's right-sidebar control remains available.

## 2026-10-24 — Native tab close and stable glass bars

- Workspace tabs reveal native hover close buttons; Command-W closes the current tab without deleting its
  workspace, comments, or sessions. Review reopens closed tabs, and history navigation reopens its target.
- Chat uses the right-sidebar symbol. Removed the tab-switch icon and System Settings shortcut.
- New, Search and other overlays keep native glass bars visible and disable their controls instead of
  switching to web bars. The search popup stays between the bars.
- A pinned toolkit source patch adds native button hover actions; macOS installation now rebuilds it with
  Apple Command Line Tools. `pnpm native:glass` also rebuilds it manually.
- Debt: the closed-tab set lasts for the window; persist it in SQLite for session restoration.

## 2026-10-24 — Rounded glass paddle concept

- `resources/icon-concepts/glass-oars-rounded/rounded-crew.icon` keeps the 45-degree oar axes and no orange
  marker, with asymmetric hatchet blades based on the supplied rowing-oar reference. Broad, gently flattened
  rounded ends sweep into slimmer shafts through long curved shoulders. The hull has a gently fuller, curved
  midsection flowing into softly rounded bow and stern tips, without straight middle edges or pointed ends.
- Four long tangent-matched hull curves replace the smaller alternating bends, removing the middle's wobble
  while preserving its maximum width, length and rounded tips.
- The slimmer proportions retain the oars' length, spacing and 45-degree axes, with gently tapering blade edges.
- Shafts join along one side of each blade rather than its centre; mirrored asymmetric blade profiles keep
  the port and starboard pairs balanced while preserving their fluid contours.
- Native previews at 32, 64, 256 and 1024 px preserve the crew's simple silhouette while the blade/shaft
  distinction adds detail at larger sizes. Production artwork remains unchanged.

## 2026-10-24 — Abstract 45-degree crew concept

- `resources/icon-concepts/glass-oars-45/abstract-crew.icon` removes the orange marker and simplifies the
  overhead crew into a straight glass spine and three broad oar chevrons. All geometry uses axis-aligned
  edges or exact 45-degree diagonals; separate thin shafts and paddle ends are removed.
- Native Composer previews at 32, 64, 256 and 1024 px keep the three oar pairs distinct at small sizes.
  The concept retains restrained glass refraction and the same Dock padding. Production artwork is unchanged.

## 2026-10-24 — Photo-aligned glass oars concept

- `resources/icon-concepts/glass-oars/rowing-crew.icon` follows the supplied overhead rowing photo: three
  paired oars along a narrow shell, with an orange cox at the stern. The shared axis tilts slightly, and broad
  glass blades distinguish the oars from their shafts. Four native groups keep it within Composer's layer limit.
- Native macOS 27 previews are saved at 256 and 1024 px with normal Dock padding. This remains a separate
  concept; the user's saved app icon is unchanged.
- Native export, typecheck, lint, formatting and build pass. The full suite currently has one failure in the
  separate workspace-layout test (`tabWidth >= 96`); icon work does not change that layout code.

## 2026-10-24 — One toolbar and a desktop sidebar

- The inner canvas toolbar is removed. Its PR, deployments, diff/range, saved views, New View, Back/Forward,
  Open Quickly and Activity actions are in the main bar's native Review menu. Existing routes and callbacks
  are shared with command palette actions; no review controls are lost.
- One Settings dropdown groups System/Light/Dark, diff layout, file tree/list and Show Reviewed Files, with
  App Settings and a macOS System Settings shortcut. Appearance writes still use the core and emit changes.
- The leading sidebar button and ⌘B toggle the existing code-aware tree. Its edge-to-edge sidebar retains
  selection, folder state, scroll and width when collapsed (the tree stays mounted); its divider resizes it. The section selector has no duplicate hide
  button. The main bar's measured border-box width includes its padding, keeping right-side actions aligned.
- Sticky file headers and guide explanations now clear the single main bar at 56 px; content starts at 68 px.
  Expanded charts use the same 12 px gap below the main bar. No storage or dependency changes.

## 2026-10-24 — Stable native workspace chrome

- Workspace selection uses explicitly sized native SwiftUI buttons in a shared strip, with a glass capsule
  on the active workspace. This replaces the form-style segmented picker and its centered intrinsic sizing.
  The project picker and right-side Settings, chat, New workspace and All workspaces actions use matched
  32 px glass groups, 28 px targets and SF Symbols. Toolbar geometry updates on resize, never on scrolling.
- The full-width glass backdrop passes pointer events through; only the three control groups take clicks.
  The 6 px strips above/below them and the inter-group gaps remain window drag regions.
- When the minimum tab widths no longer fit, the selected workspace stays in the visible set; the native
  All workspaces menu exposes every full title. No controls are squeezed or clipped off the right edge.
- Native menu shortcuts switch workspaces: Control-Tab / Control-Shift-Tab, Command-1 through Command-8,
  and Command-9 for the last workspace. Removal remains an explicit confirmed action; this does not turn
  closing a visual tab into deleting a workspace. The controls are native SwiftUI composition, not Safari's
  own tab implementation. No storage or dependency changes.

## 2026-10-24 — Abstract glass navigation concepts

- Matched native Composer concepts in `resources/icon-concepts/glass-navigation/` replace the vessel with
  two interlocking glass chevrons. `with-orange.icon` adds a small amber bearing marker at the upper point;
  `without-orange.icon` keeps the same glass geometry and lighting without that marker.
- Both have 256 px comparison previews and 1024 px exports, rendered by Icon Composer 27 with normal Dock
  padding. Refraction is restrained to keep the contours clear. The active app icon and saved source are unchanged.

## 2026-10-24 — Layered glass vessel concept

- A separate editable concept in `resources/icon-concepts/glass-vessel/coxswain.icon` explores a broader
  opal deck above a teal hull and a floating blue water plane, with an amber cox. Native translucency and
  refraction let the planes show through one another, inspired by Icon Composer's own dimensional icon.
- Its four foreground groups use Composer's native midnight background. PNG and ICNS previews are rendered
  with Apple's macOS 27 effects and the same Dock padding as the production icon. The user's saved production
  document and active app exports are unchanged; concepts remain excluded from application bundles.

## 2026-10-24 — Native workspace selection and window-button alignment

- Supported Macs render workspace selection with a native SwiftUI segmented picker through the existing
  island bridge. macOS owns rendering, selection, focus and pressed feedback. A native actions menu keeps
  full workspace titles and removal available. Other systems and accessibility modes retain the HTML strip.
- Workspace controls share the review islands' occlusion handling so HTML dialogs remain above all controls.
  No storage or router changes; selection still uses the existing workspace navigation callback.
- The workspace bar floats above a full-height canvas scrollport, so changes pass behind its native glass.
  Project switching, New workspace, chat and Settings use native controls alongside workspace selection.
  Sticky headers and section text clear both bars at 112 px; initial content starts at 124 px. Side panes
  keep a 44 px top inset. No scroll listeners or per-frame layout updates are introduced.
- Native window buttons start at (16, 15) points, centering their 14-point height in the 44-point tab bar.
  Returning from full screen restores their position.

## 2026-10-24 — Compact workspace tabs

- Workspace tabs share a Safari-style rounded strip, filling the available width. Inactive tabs have subtle
  separators; the active workspace has a raised pill and twice the flexible width to show more of its title.
- Tabs shrink before overflowing, then scroll horizontally without a visible scrollbar. Selection remains
  in view; keyboard navigation, PR and agent status, tooltips and the workspace context menu are preserved.
  The project picker uses a matching capsule. No storage, navigation or dependency changes.

## 2026-10-24 — Expandable diagrams

- Generated Mermaid charts in guides and chat have a small muted expand icon in the top-right corner.
  A large preview starts vertically centered and has no toolbar: trackpad pinch zooms around the pointer; two-finger scrolling pans freely in any direction, without scrollbars. Both previews share the same gesture handler.
- Supported Macs use a native Liquid Glass child panel with transparent HTML above the material. It samples
  the app beneath it while the main window stays opaque. Accessibility settings and unsupported platforms
  retain a solid shared dialog. Escape, Close or clicking away dismisses the preview without losing guide scroll.
- Edge-label backing spans are transparent so their rectangular fills do not leak beyond rounded pills.
- The preview fills the space between the review bars, using their 12 px gaps and responsive side gutters.
- A fresh SVG gives the preview distinct IDs. The native panel is sandboxed, has no app preload or Node access,
  blocks navigation/new windows and uses a nonce-based CSP. No saved-data or dependency changes.

## 2026-10-24 — Explanations beside guide cards

### What works

- Each guide section places its heading, section Reviewed control and explanation beside its file cards.
  There is no duplicate file overview or guide navigation sidebar. Overall progress remains in the bottom bar.
- The explanation sticks within its section below the top review bar while the cards scroll beside it. Long
  explanations scroll within the available height. Below 960 px of canvas width, text stacks above the cards
  and releases sticky positioning. Opening side panes participates in that width calculation.
- Original prose part indices and ordering preserve quote anchors and inline threads. Prose-only sections
  keep a full-width layout with readable text measure; unassigned guide files keep their final section.

### Tech debt

- The old fixed-width guide-contents component and its scroll-position tracking are removed. No storage or
  agent-tool protocol changes; saved guides use the new presentation immediately.

## 2026-10-24 — Consistent desktop spacing

### What works

- Shared spacing and control metrics feed CSS and native review toolbars from one source. Buttons have
  28 px minimum targets, fields and list rows 32 px; content can grow. These are desktop app defaults,
  informed by Apple's grouping and alignment guidance, rather than mandated HIG measurements.
- Cards, settings, dialogs, command palette, Activity, commits/turns, chat, attachments and comment threads
  use consistent insets and gaps. Cards share the review cards' 12 px radius and quiet hairline.
- Screen sections have 24 px separation and responsive 24/32 px insets. Settings and action groups wrap.
  PR details now clear the floating bars, using the same review gutters and initial/final content padding.
- Review bars, guide contents and sticky file headers derive their clearances from shared metrics.
  Code and tree reading density is unchanged. No new dependencies or saved-data changes.

## 2026-10-24 — Vector app icon

### What works

- The rowing shell, cox marker and water are separate unmasked SVG layers on a shared 1024 px grid in
  `resources/coxswain.icon`. The saved Icon Composer document owns their ordering, placement, colours,
  opacity and native glass settings, including dark/tinted fills. It opens successfully in Icon Composer 27.
- `pnpm icon` now uses Apple's bundled `ictool` to render that saved design with macOS 27 effects. AppKit
  adds only the static Dock canvas's 100 px padding and resamples it for PNG and multi-resolution ICNS.
  macOS packaging explicitly uses the ICNS; the dev Dock uses the PNG. Source hashes are unchanged by export.
- The user's saved design, including the larger glass cox marker and darker water, is used as written.
  The earlier custom SVG effect renderer and template mask are removed; native rendering replaces them.
  Earlier raster concepts remain separate and are excluded from application bundles.
- Typecheck, the full test suite, lint, formatting and the production build pass. The macOS package and
  native About panel were checked with a scratch database. On this host, native export and the localhost
  checksum test require normal host access; pnpm also needs `--config.verify-deps-before-run=false` for the
  existing dependency configuration. No dependency or lockfile migration was made for icons.

### Tech debt

- Electron ships a static Default ICNS/PNG, so its Dock icon does not dynamically change appearance or
  lighting. The source document retains native material and appearance settings for future layered delivery.
- Regeneration needs macOS and Icon Composer 27 (or `ICON_COMPOSER_APP` for a custom app path).
  Checked-in exports keep normal builds and release runners independent of those tools.

## 2026-10-24 — App icon exploration

- A separate raster candidate in `resources/icon-concepts/rowing-macos27/` keeps the diagonal rowing shell
  and orange cox marker, exploring opal surfaces and glass highlights inspired by macOS 27. Its generation
  prompt and Apple reference links are saved alongside it. The production SVG and PNG are unchanged.
- `preview-v2.png` reduces broad glare and the thick glass rim, with a satin shell and coral marker.
  The installed native Notes icon supplied a visual reference for enclosure spacing and perimeter treatment;
  its artwork is not copied into the repository. The revision's built-in image generation prompt is retained.
- This is a visual preview, not a verified Apple template export. Native delivery still needs unmasked
  layers, appearance variants and validation in Icon Composer. No application code or packaging changed.

## 2026-10-24 — Diagram typography and colour

### What works

- Mermaid diagrams share a light/dark base theme with system typography, neutral nodes, rounded boxes,
  neutral connectors and more space between flow nodes and sequence messages. Flow nodes have no drop shadows.
- Flowcharts match the supplied Codex reference with dashed rounded decision boxes and pill-shaped edge labels.
  Presentation overrides use Mermaid's parsed node model; source, labels and connections remain unchanged.
- Pie and XY charts use a coordinated categorical palette, clearer labels and neutral axes. Guide charts sit on
  solid card surfaces with 24/32 px padding. Rendering and diagram validation use the same configuration.
- Flow, sequence, pie and XY examples render successfully in Electron in both themes.

### Tech debt

- No new dependencies or saved-data changes. Layout and legibility still depend on the agent's diagram structure.
- Decisions with escaped/nonstandard IDs retain their original shape; extend the presentation serializer when needed.

## 2026-10-24 — Guide contents card

### What works

- The guide's table of contents is a separate rounded card between the floating review bars, using the same
  hairline colour as file cards. Its top aligns with sticky file headers at 68 px; the bottom uses the same inset.
  Responsive 16/32 px gutters match the file cards, keeping the card's reading width as the gutters grow.
- The section list scrolls inside the card without compressing its rows, keeping its first and last items reachable.
- Generated guide charts and diagrams share the cards' 12 px radius and 0.5 px hairline colour, in both themes.
- Inline comment composers and saved comment/agent threads share the same outline, including threads on prose.

### Tech debt

- The contents card keeps its fixed width; the existing resizable-contents follow-up still applies.

## 2026-10-24 — Native glass overlays and stable file-card headers

### What works

- The top and bottom review bars float over the scrolling changes. On supported macOS they use native Liquid
  Glass and native controls; the window stays opaque. The first and last lines remain reachable through padding.
- Dialogs, the command palette, Activity and the thread list temporarily use web controls so native views yield
  to HTML. Reduced transparency, high contrast and unsupported platforms keep web controls. Native views dispose
  with the window. The toolkit and its native/Swift binaries are unpacked from ASAR.
- File cards have one shared rounded, bordered header outside Pierre's code renderer. The header stays below
  the review toolbar as code scrolls behind it, keeping Reviewed and the file identity in the card's top edge.
- Canvas spacing belongs to the content wrapper, not the scrollport: sticky headers sit 68 px below its top,
  without an extra 80 px from the initial content padding.
- Each sticky header masks the code above it within its own card; the card clips that mask at its edges.
  Rounded corner masks preserve the header edge. At the card's end it passes behind the native toolbar.
  No clipping animation, scroll listener or geometry measurement follows scrolling.
- The header owns its top border and the code body owns its side and bottom borders. The outer card has no
  border to show through masked space or double the bottom edge; the mask stops above the header's top stroke.
- Top corner masks paint an opaque cutout and their own border arc, preventing diff colours from bleeding
  through the rounded header. The code body's bottom outline sits above the sticky header at the card's end,
  so the bottom corner arcs remain visible as the card scrolls away.
- Card outlines, corner arcs and header separators share a 0.5 px hairline and a quieter neutral colour in both
  themes; masks use the same stroke width to keep the rounded edges aligned.
- Rounded cutouts and their hairlines use shared SVG arc geometry at both ends of a card. This replaces hard
  radial-gradient stops with vector antialiasing and keeps the corner geometry consistent with the 12 px radius.

### Tech debt

- Native and web review controls share actions but have separate rendering; keep their capabilities aligned.
  New HTML popovers need the shared glass-occlusion hook (Dialog already uses it).

## 2026-10-24 — Space around review content

### What works

- File diffs, guide-embedded files and whole-file views share rounded, bordered cards on a quieter canvas surface.
  Cards have 24 px between them and responsive side gutters; sticky headers, Reviewed and inline threads stay intact.
- Guide prose and headings have more space and a larger reading size. Pane bars and the table of contents have
  more room without changing code-line density.

### Tech debt

- No new shortcuts; the existing Pierre renderers and shared styling tokens supply the file cards.

## 2026-10-24 — Resizable Commits and Turns

### What works

- Drag the horizontal divider above the Commits/Turns bar to resize the bottom pane. The Navigator and bottom
  pane each keep 96 px; the bottom pane shrinks with the window. Arrow keys resize a focused divider too.
- Switching Commits/Turns, collapsing the pane, or hiding the Navigator keeps the chosen height for the window.

### Tech debt

- Paid off: the fixed equal split is gone. Height still resets on restart, like pane widths (`ponytail:` in App.tsx).

## 2026-10-24 — Workspace tabs and a primary canvas

### What works

- Workspaces are tabs across the top, next to the project picker, with horizontal overflow and keyboard navigation.
  Titles, PR state, agent status and the native removal menu stay available. Switching tabs restores the existing
  canvas location and scroll, and Back/Forward still crosses workspaces.
- The diff or guide takes the primary area. Chat opens on the right, with a persistent toggle in the tab bar,
  and defaults to collapsed. Explicit visibility choices remain saved. New View prompts reveal the composer.
- The optional Navigator stays on the left, with a narrower initial width; chat and Navigator can be resized.

### Tech debt

- Paid off: the workspace sidebar and its visibility state are gone. Pane widths still reset on restart.

## 2026-10-24 — Appearance setting

### What works

- Settings offers _System_, _Light_ and _Dark_. The choice is kept in SQLite and applied through Electron’s
  native theme before a window opens, and immediately when changed. Native controls, app styles, code colours
  and diagrams follow it. System remains the default.

### Tech debt

- No new shortcuts or migrations; uses the existing settings table and change events.

## 2026-10-07 — Navigator split

### What works

- The pane left of the canvas is split: the Navigator (_Changes_ · _Files_) on top, _Commits_ · _Turns_ below with
  its own bar. Its chevron collapses the bottom half to that bar, stuck to the pane's bottom; picking a tab, the
  range menu's _Commit…_ / _Agent Turn…_ or the palette's Commits and Turns actions expand it.
- The agent pane can be hidden (the speech bubble at its header's left, or the palette) and shown again from the bar
  at the window's left of the canvas side. Kept in the settings table (`agent-pane.open`), so it survives restarts.
- A turn that fails because the agent is signed out offers _Sign In to …_ under the error (`signIn` in
  `src/core/agents.ts`): Codex through the adapter's ACP `authenticate` (`chat-gpt`, browser), Claude Code with
  `claude auth login --claudeai`, after which its adapter restarts so sessions pick up the new login.

- A view's table of contents takes a click on a section's speech bubble: its one thread is scrolled to, or with
  several, the one picked from a native menu (`showPickMenu`). Threads on a section's prose count there too.
- The canvas bar shows a globe after the PR's chip when its head commit has live deployments (`deployments` in
  `PullRequestDetails`, read in the PR's query): one opens in the browser, several are picked from a native menu.
- Views can hold charts: mermaid's `pie` and `xychart` (bars, lines) in a palette of their own (`chartTheme` in
  `components/text.tsx`, light and dark); the view tools tell the agent to chart numbers it measured or read.
- The Navigator and a view's table of contents count only open threads; resolved ones are left out.

### Tech debt

- A signed-out turn is told by the error's data (`signedOut` in `src/core/session-state.ts`): ACP's authRequired,
  Claude Code's `errorKind: "authentication_failed"`, Codex's `codexErrorInfo` (`unauthorized` or HTTP 401). A
  Claude adapter with a turn running isn't restarted after signing in. Only the agent
  pane offers to sign in; a failed session start or a question's turn shows the plain error.
- Paid off (2026-10-24): the fixed equal split now has a resize handle. Height and collapsed state reset on restart,
  like pane widths.

## 2026-10-05 — Comment threads and agent threads; comments posted as written

### What works

- A thread is a comment thread or an agent thread, by its first entry, and stays one. A comment thread's reply box
  has no Agent toggle, and its ⋯ menu no _Send to Agent_.
- _Submit Review_ lists only the open comment threads and posts their comments as written: the first comment on the
  lines, the others replies. Conclusions are gone: no summary model at Submit Review, no work ahead on threads.
- A posted thread keeps its GitHub comment and thread ids, so the next read finds it: replies by others land in it,
  edits there are taken over, and editing or deleting the user's comments here does so on GitHub too.
- An agent thread's ⋯ menu has _Summarize as Comment_: a one-item job on the summary model, with a prompt rewritten
  around the reviewer's point (the agent's answers as background); the comment opens under the thread to edit, and
  saving adds a comment thread on the same lines or passage.

- The comment box has _Post to GitHub_ (with a PR, on _Comment_; remembered): ticked, a comment is posted as it's
  sent, as plain discussion with no review: GitHub's single comments and replies, or a comment in the PR's
  conversation off the diff (`postComment`); unticked, it waits for _Submit Review_. A failed post keeps the comment
  here and says why in a sheet.
- Reads of GitHub and posts, edits and deletes take turns per workspace (`oneAtATime`): a watcher check overlapping
  a post had copied the posted reply in beside its note.
- A thread deleted on GitHub, or whose first comment was, is deleted here at the next complete read (not while it
  holds an unposted note). The user's own comments on GitHub are mirrored as their notes, so Edit and Delete work on
  them, on GitHub too.
- Comments off the PR's diff show what they're about as a permalink to the lines (GitHub renders it as the
  highlighted code), else the code quoted. Posted at once, each is a comment in the PR's conversation that's recorded,
  so Edit and Delete reach it (`updateIssueComment`, `deleteIssueComment`), and later comments reply to it by link.
  Edits and deletions made on GitHub come back at the next read (`syncConversation`); a hidden marker tells the
  user's text from coxswain's header.
- Each of the user's comments has its own ⋯ (Edit, Delete, Open on GitHub); Delete Thread is off while others have
  replied. A thread gone from GitHub is dropped (`dropThread`), its unposted notes kept as a local thread. Review
  threads and conversation comments are read in full, page by page. Posting a new thread directly reads GitHub back at
  once, so it's linked before anything else goes to it. Posting directly with a review in progress on GitHub says so
  instead of failing. Summarize as Comment's Save follows Post to GitHub (_Save and Post_).
- Summarize as Comment writes for the PR's author, who never saw the thread: the agent's questions and offers to the
  reviewer stay out, a change the agent made is at most mentioned, and a thread with nothing left for the author says
  so (`NOTHING`) instead of inventing a comment.
- With _Post to GitHub_ on, ✓ resolves or reopens a thread on GitHub at once (`resolveThread`), else it waits for
  Submit Review; a failure says why under the thread and leaves it as it was.

### Tech debt

- Paid off: Submit Review no longer puts comments in the review's text, where nothing could link to them; they go as
  linked conversation comments. It no longer adds to a review in progress on GitHub without asking.
- `ponytail:` in `db.ts`: `thread_conclusions` is no longer used; dropped by the next migration that has to lock older
  releases out anyway.
- Paid off: conclusions ahead (a model run per changed thread, submitted or not) are gone.

## 2026-10-05 — Scrolling holds still while the agent answers (#38)

### What works

- **The agent pane follows a reply only while scrolled to its end.** Scrolling up to read while a turn streams stays
  put; sending a message or opening another session follows the end again.
- **A thread's answer no longer blinks out when the turn ends.** The reply streamed in was dropped as the turn ended,
  a frame before the answer entry was read, so for a frame the thread had no answer and everything under it on the
  canvas jumped up and back. The streamed reply now stays until the answer entry replaces it (or until the next turn).
  A turn that ends in an error or is stopped keeps its partial reply over the error.

### Tech debt

- A thread taller than `max-h-[60vh]` scrolls inside itself, and that scroll doesn't follow the reply streaming in.

## 2026-10-04 — Local repositories and new projects; GitHub optional

### What works

- **A project is a git repository, GitHub optional** ([ADR 0040](adr/0040-local-repositories-and-optional-github.md)).
  `projects` now has `name`, `path` (the user's own repository; null for coxswain's clone) and `github`
  (`owner/name`; null when it isn't on GitHub). The migration makes every existing project a clone on GitHub; its
  folders don't move.
- **Add Local Repository…** in _Open a project_ and the command palette: a native folder dialog. Any folder inside a
  repository adds the repository's top level; one that isn't in a repository, has no commits yet or is one of
  coxswain's own worktrees is refused with why. An `origin` on github.com makes it a GitHub project on the user's own
  checkout. Its worktrees are added to the user's repository and live in `~/coxswain/worktrees/local/<name>-<hash>/`;
  the user's checkout, index and branches aren't touched.
- **New Project…**: a native save dialog for a new, empty folder, which coxswain `git init`s (on the user's
  `init.defaultBranch`, else `main`) and gives an empty first commit. Plain folders can't be added.
- **Without GitHub**, a project's New workspace dialog lists its local and `origin/` branches, defaulting to the one
  the user's checkout is on; a branch starts from the user's local base branch. Opening a workspace doesn't ask GitHub
  for its PR. With no `origin`, nothing reads _not pushed_ and Push isn't offered; with one, Push goes there. Open
  Pull Request… is only for projects on GitHub. The scope reads _Pushed_ instead of _On GitHub_.
- **The user's own worktrees are left alone.** Opening a workspace moved any worktree holding its branch into
  `~/coxswain/worktrees/`, and ran `git worktree prune`; in a local repository both could reach the user's worktrees
  (moving their folder away, or dropping the registration of one on a drive not mounted). Now only worktrees under
  `~/coxswain` are moved, a branch checked out elsewhere is refused with where, and stale registrations are dropped
  one by one, only coxswain's (`pruneOurs` in `src/core/git.ts`).
- **`gh` is no longer required at startup**; where GitHub is used (the repository list, a PR) it says what's missing.
- Tests: `src/core/local-repositories.test.ts` (adding, refusing, a branch workspace on a repository without a remote,
  a new project, the user's worktrees neither moved nor pruned) and `gitHubOf` in `git.test.ts`. Checked in the running app on a scratch database: Add Local
  Repository… (refused for `/tmp`, then added), a branch workspace with a commit and uncommitted change, its Commits
  pane, New Project… and its refusal of a folder that exists; and a copy of the real database, whose GitHub projects
  open as before.

### Tech debt

- Only `origin` is read, for GitHub and for Push; a fork setup with GitHub as `upstream` isn't detected.
- Projects still can't be removed; a local repository's worktrees will need `git worktree remove` then.
- A branch checked out in the user's own checkout or worktrees can't be a workspace's; the error says where.
- GitLab and other hosts work as local repositories, with Push but no merge requests.

## 2026-10-04 — A new workspace shows sooner; slash commands

### What works

- **The first open of a workspace no longer waits for its PR.** The worktree's diff showed only once the first GitHub
  check had also read the PR and mirrored its review threads; `checkedWorktree` (`src/core/watch.ts`) now answers as
  soon as the check has the worktree open, and the PR panel and threads follow when the read is in.
- **The canvas says "Preparing the workspace…"** while the worktree is cloned, fetched and checked out, instead of
  "Loading…"; the Navigator already said so.
- **Slash commands in the composer.** Typing `/` lists the session's slash commands (its own, skills, custom prompts),
  as the agent sends them over ACP (`available_commands_update`, after a session opens or loads); kept in memory in the
  session's state. ↑↓ picks, Tab or Enter completes, Esc hides; the message goes as typed and the agent runs it. A new
  session, which has none until its first message opens it, lists the ones its agent last sent for any session; only
  right after launch, before any session of that agent has opened, is the list empty.
- **The README catches up**: views explained, threads with the agent, Submit Review's conclusions, GitHub both
  ways, turn diffs, and that the agents bring the user's own skills and commands. A new dark screenshot: a Review
  view of honojs/hono#5513 made by Claude Code in the app, its mermaid flowchart, a thread on the view's prose and an
  answered question in the agent pane.
- Tests: the existing ones pass; nothing new covers the early answer (a PR workspace needs GitHub faked). Not yet tried
  in the running app.

### Tech debt

- A new session's slash commands are its agent's last ones from any project, so another project's skill may show
  (`ponytail:` in `src/core/agents.ts`).
- Still slow on a new workspace: the clone is blobless, so `git worktree add` downloads every file of the tree; a
  branch workspace asks GitHub for its PR before it fetches.

## 2026-10-03 — Guides from skills

### What works

- **Skills for views** ([ADR 0039](adr/0039-skills-for-views.md)). `pr`, `code-review` and `writing-beats` from
  mattpocock/skills ship whole in `resources/skills/` (MIT, with the upstream commit in its README). The agent reads
  them with a new tool, `read_skill` (several in one call); each comes after a note (`src/core/skills.ts`) on which
  of its parts apply in coxswain and how they map to the view tools.
- **Guides are written as claims, with an overview that shows the change.** `start_view`'s guide instructions are
  rewritten as numbered steps: read `pr` and `writing-beats` (and `code-review` in a review); write the overview first
  (intent, the smallest visual of the change's shape, one-way or two-way door and blast radius); order sections by
  grounding; make section prose claims about the code rather than "check that …" instructions; add explanations only
  where the lines alone leave the reviewer guessing. Other views open the way `pr` opens a summary. The Review prompt
  and `add_explanation` and `add_finding` texts follow. "Above" in `start_view`'s result now says "below", where the
  file list is.
- `.claude/skills/writing-for-agents`, for whoever edits what coxswain tells its agents (not shipped).
- **HTML in GitHub's markdown shows as GitHub shows it.** A bot's `<details>`, links and comments were printed as
  tags in the PR panel and in mirrored threads. `Prose` now reads the HTML (`rehype-raw`) and keeps only what GitHub
  allows in a comment (`rehype-sanitize`, GitHub's own schema): `<details>` folds, links work, nothing else gets in.
  Two new dependencies.
- **A diff in prose is coloured**: a \`\`\`diff block without `path=` (the `pr` skill's shaped diff of a call tree or
  state) shows its + lines green and its - lines red, across the whole line when it scrolls. The `pr` note asks for
  sketch lines of about 60 characters, explained in the sentences around them rather than in trailing comments.
- **Threads read more easily**: a line between entries with room around it, who wrote each one as a label over it
  ("You → agent", "Agent", "@login on GitHub"), looser line spacing, the agent's live reply under one "Agent" label,
  and up to 60% of the window tall before it scrolls (was 384 px).
- Tests: every skill `read_skill` offers is served whole after its note (`skills.test.ts`). Tried in the running app on
  a copy of the database: a guide of this branch, made in a new Claude Code session in about two minutes, opened with
  a shaped diff of the architecture and a merge-danger call, its sections made of claims; it read one skill where it
  was told to read two, which is why `read_skill` now takes several. Not yet tried: a review with `code-review`, Codex.

## 2026-10-03 — Freshness: the core keeps the workspace on screen fresh

### What works

- **The core checks GitHub, not the UI** ([ADR 0030](adr/0030-workspace-watcher.md), revised). `watch.ts` checks the
  workspace on screen when it shows, every minute, on window focus, right after a push, a new PR, a posted review or a
  change in the PR panel, and on a push from anywhere on this machine: every 3 s it reads HEAD and the branch's
  `origin/` ref, and that ref moving without a check is a push (an agent's or a terminal's too), checked at once. A
  check fetches, fast-forwards, reads the PR and mirrors its threads, keeps what it found (the last good result
  offline, with a notice) and emits `github` when something changed. `openWorktree` and `readPullRequest` are now
  pure reads of that; the UI's 60 s and 120 s intervals and `openedBefore` query are gone. "Not pushed" marks, CI dots
  and the PR panel catch up within seconds of an agent pushing, instead of up to two minutes.
- **Window focus works.** TanStack listened only for the page being hidden, which a window behind another isn't, so
  GitHub reads were never refetched on coming back. Focus is now the window's (`focusManager`), and the main process's
  `focus` event rereads the worktree and checks GitHub.
- **Every core write emits** ([ADR 0017](adr/0017-data-fetching-with-tanstack-query.md),
  [ADR 0038](adr/0038-background-jobs-and-core-events.md)). Edit, resolve and delete an entry, remove a view, toggle
  Reviewed, open or remove a workspace or project, a workspace finding its PR, picking or starting an agent session,
  and settings (summary settings, prompts, agent picks, comment to agent) emit from the core function. New events:
  `reviewed`, `github`, and outside a workspace `projects`, `workspaces`, `settings`. The UI's hand-made
  invalidations and `changed(…)` calls are gone; `affects` in `queries.ts` is the one map of what goes stale. Thread
  conclusions now follow resolves, edits and deletes too.
- **The sidebar no longer flashes.** Adding or removing a workspace, or a branch workspace finding its PR, changed
  the PR titles query's key and dropped every row back to `#N` with an "Open" icon until GitHub answered; a failed
  refetch did the same. The rail now keeps the titles shown until the new ones are in, and keeps them when GitHub
  fails.
- **A stale view's notice stays in sight and offers _Update View_.** The notice sits above the view, outside its
  scroll, like _being written_'s. _Update View_ attaches a request to the agent pane's composer (`updateViewPrompt`):
  make the view again with the same title and range, of the code as it is now, keeping what still holds; it names
  the old range and `git diff <old head>` for what changed since. It's a new view, since a view stays pinned; the old
  one stays until removed.
- **A view's table of contents marks a section reviewed**: right-click a section for _Reviewed_ (native menu,
  checked when all its files are), the same as the section header's box.
- **Home and End in text boxes** go to the start and end of the text, not of the line, as in a Mac text view; with
  Shift they select (`TextArea`).
- Tests: the watcher tells a commit from an edit and checks GitHub on a push (`watch.test.ts`); a change makes stale
  what it affects, scoped and unscoped (`queries.test.ts`). Checked in the running app on a copy of the database: the
  rail's titles stay while switching workspaces, focus brings a `worktree` change, switching back shows the cached
  check at once.

### Tech debt

- After launch the sidebar shows PR numbers until GitHub answers: titles aren't stored
  ([ADR 0005](adr/0005-local-data-storage.md)).
- Uncommitted edits made during an agent turn show when the turn ends or on window focus, not as they happen
  (ADR 0030, deliberate: the diff would redraw every few seconds).
- One more GitHub read a minute while the window is in the background: the PR read used to pause then.
- Found while checking, not new: a merged PR whose branch was deleted on GitHub can't be opened (`couldn't find remote
ref`); the canvas says _Loading…_ for good.

## 2026-10-01 — The PR on GitHub: threads, PR panel, checks, posting (#3)

### What works

- **Review threads from GitHub show between the lines** (ADR 0037). Reading the PR (`getPullRequest`, one GraphQL
  query, polled every minute) mirrors its review threads into entries of kind `comment` (`syncThreads`), anchored at
  the lines and commit they were written on, so following, outdated, the threads list, _Hand off_ and the agent's
  prompts take them as they are. Prompts name GitHub's authors (`@ana on GitHub`). Edits, deletes, resolves and
  reopens on GitHub are taken over on the next read.
- **Submit Review**, the bottom bar's button (it was _Hand off_, a menu; the name in earlier entries below is the old
  one), opens a dialog like GitHub's _Finish your review_: the open threads, and with a PR those with something to
  post (replies to GitHub's, resolves), each with its **conclusion** (glossary), the one review comment that says
  where the thread ended up. The summary model writes them ahead, in a background job, once the threads have been still for 30 seconds and not while an agent is answering one, so the dialog opens at once; a thread not written yet says _Writing its conclusion…_
  (`draftReview`, `conclusionsPrompt`); a thread that is one comment of the user's is its own. The user picks threads
  and edits conclusions, then _Copy as Prompt_, _Send to Agent_ (the threads with their conclusions after them) or
  _Post to GitHub…_. The button is on with a PR even without open threads, for a review that is a verdict alone.
- **Post to GitHub** sends the picked conclusions as one review (GraphQL pending review, then submit) with a verdict
  and summary: on the lines if the PR's diff has them, as a reply on a thread from GitHub, else in the review's text
  with the code quoted (lines outside the diff, not pushed or changed since, a view's prose: these couldn't be posted
  before, or went as a comment on the file). A thread of the workspace's is resolved once posted and its comment
  comes back as a thread from GitHub; a reply's entries record the one comment that stands for them. The agent's
  answers are no longer posted as such.
- **Background jobs and core events** ([ADR 0038](adr/0038-background-jobs-and-core-events.md)). The job engine
  (batches, retries, limits, the stored history Activity shows) moved out of `summaries.ts` into `jobs.ts`, with a
  spec per kind: `files` (file summaries, as before) and `conclusions`. The core has one event bus (`events.ts`):
  the main process forwards its changes to the window in one place, instead of 19 `changed(…)` calls each naming a
  window, and `background.ts` is the one place that says which event starts which job, instead of `summariseAhead`
  called from six handlers. Adding an entry emits its own event. Activity shows both kinds; Settings' _Summarise_ is
  now _Work_: _Ahead_ · _Only when needed_, for both. Migration: `summary_jobs` becomes `jobs`, with `kind` and
  `items`.
- **The PR panel**, a canvas location (`pr`) opened by the PR's chip in the canvas bar: state, _Merge…_ (asks; the
  repository's merge methods), _Ready for Review_, checks, description edited in place, assign yourself, reviewers,
  labels, conversation and a comment box. It is laid out like the PR's page on GitHub: description and conversation
  as cards, then the checks with merging under them and the comment box, beside a side column of
  reviewers, assignees and labels (flex-wrap puts it underneath in a narrow canvas). Passed and skipped checks fold
  under a count (a native `<details>`), so only the failing and running ones take room.
- **Checks**: a dot on the PR chip and per commit in the Commits pane; a failing check's _Send to Agent_ sends it
  with the end of its GitHub Actions log to the agent pane's session (`[Check · name failed]`, a card in the chat).
- Migration: `entries` rebuilt for the `comment` kind, with `author`, `github_id`, `github_thread_id`, `github_url`,
  `github_resolved`. `TextArea` gets `long` (Enter adds a line, ⌘Enter submits).
- `COXSWAIN_USER_DATA` points a run at a database of its own. macOS ignores `$HOME` for userData, so a dev build
  otherwise migrates the installed coxswain's database.
- ADR 0035 tightened: `if … return` ladders and nested JSX conditionals count too, a match over a union ends with
  `.exhaustive()`, and outside enums are typed and matched with `.exhaustive(fallback)`. GitHub's check states, `who`
  and the PR panel's branches follow it.
- Tests: mirroring, re-reading, GitHub's edits, deletes and reopens, what's postable (in the diff, on the file, not
  pushed), hunk ranges and check states (`pull-requests.test.ts`). Checked in the running app on a scratch database:
  the PR chip, the panel, and a local note listed under _Post to GitHub_. Posting, threads from GitHub, checks and
  merging were not tried against GitHub.

### Tech debt

- `ponytail:` the first 100 threads, comments per thread, commits and checks (`core/github.ts`).
- `ponytail:` a thread deleted on GitHub stays here with its local replies (`syncThreads`).
- Conclusions are stored in `thread_conclusions` (a migration), by the fingerprint of the thread's entries, and so
  are the user's edits of them; a thread that changes is concluded again and its edit dropped. Every changed thread costs a summary model run, whether the review is
  submitted or not, unless work ahead is off. Resolving, editing or deleting an entry emits no core event yet
  (ADR 0038). An entry goes to the summary model cut to 2000 characters
  (`thread-context.ts`).
- GraphQL has no ETags, so each minute's poll counts against the rate limit.
- A posted entry edited here isn't updated on GitHub. A comment whose commit the clone lacks reads as outdated.
- Splitting a workspace's commits into a new branch workspace (several PRs from one piece of work) isn't built.

## 2026-10-01 — Threads on a view's prose (#28)

### What works

- **Comment on a view's prose.** Right-click selected text in a view (or a block, for all of it) → _Comment_: a note
  or question on that passage, shown after its block with the passage highlighted (CSS Custom Highlight API). Same
  thread box, _Comment_ / _Agent_ toggle, resolve, _Hand off_ and threads list (under the view's title, _§ N_) as on
  lines. The agent is told the view, section and quote, so it can answer or rewrite the section (ADR 0036).
- Migration: `entries.section`, `entries.quote_at`. A prose entry's revision is a hash of its section's markdown:
  outdated once `write_section` replaces the section, and then shown at the top of the section.
- `Prose` can render something after each top-level block (`blockEnd`, a rehype step marking `data-block`).
- `EntryThread` and `postEntry` (`Thread.tsx`) wire a thread to the core for both file diffs and prose; `Viewer` uses
  them.
- Checked in the running app: select, _Comment_, send, thread after the paragraph, listed under the view; section
  rewritten → outdated at the top.

### Tech debt

- `ProseThreads` walks the section's text after every render to place threads and highlights; cheap for a section,
  but memoise on the section and its threads if views get long.
- A quote spanning blocks shows after the last one, and its highlight covers any thread in between.

## 2026-10-01 — Outdated follows the code (#31); more in the commits pane

### What works

- **An entry goes outdated only when its own lines change.** It's followed from its revision with a line diff
  (`core/follow.ts`, Myers): lines added above move it, an edit next to it leaves it current. Judged once, against the
  live diff (the worktree; the merge base for removed lines), so a comment from _All_ no longer reads as outdated
  while a commit diff is on screen, and an agent's uncommitted edit shows at once.
- **Every anchored entry has a revision** (migration: `entries.revision`): its range's commit, or a snapshot of the
  worktree on the live diff, kept under `refs/coxswain/revisions/`. Those written on the live diff before have none
  and read as outdated.
- **Where it shows is per range**: between the lines of any range with its lines unchanged, at the lines they moved
  to. The threads list mutes the others and says where they were written (_in All_, _in abc1234_, _in a view_).
- An outdated thread opens above its file with its code _Then_ and _Now_; _Hand off_ sends it with what its lines
  read now and asks the agent to check it still applies. ADR 0015 is rewritten for all this.
- Entry storage and state moved from `review.ts` to `entries.ts`, which `node --test` can load, with a test over a
  real repository.

- **More in the commits pane.** Each commit shows its subject over its short sha, author (and co-authors), how long
  ago, and its lines added and removed; merges are marked. The tooltip has the whole message, the author's email and
  date, co-authors, who committed it if someone else (a rebase, GitHub's merge button) and how many files it changed.
  `listCommits` returns `LoggedCommit`s, parsed from `git log --shortstat` by `parseLog` (tested).

- Each agent turn records the session it ran in (migration: `turns.agent_session_id`), to audit later.
- **Agent turns have their own tab**, _Turns_, next to _Commits_, in the same rows: the turn's first message over the
  agent that ran it (from its session), how long ago, and its lines added and removed (`diffSize`, cached per pair of
  snapshots). Turns whose snapshots differ with nothing changed between them (the agent only committed earlier
  changes) are left out. The Diff tab's range menu offers _Commit…_ and _Agent Turn…_; there's a Show or Hide Agent Turns command.

- **Uncommitted changes in the Commits pane**, after _All Changes_ while the worktree has any: its files and lines
  added and removed, from `git diff HEAD` and the untracked files (`uncommitted`, summing the file list of HEAD → worktree). Picking it shows
  only them, live, as a new scope, _Uncommitted_ (HEAD → worktree), also in the range menu and the command palette.
- **Scopes are layers.** The range menu has _All Changes_, then the three layers that add up to it, each with its size
  and greyed out when empty: _In the PR_ / _On GitHub_ (merge base → GitHub's head), _Not Pushed_ (GitHub's head →
  HEAD, pinned) and _Uncommitted_ (HEAD → worktree). _Local_ (GitHub's head → worktree) is gone: it held the other two
  at once. Unpushed commits are marked _not pushed_, not _local_.
- **ts-pattern for branching** (ADR 0035): chained ternaries of three or more outcomes are `match`es now: the diff's
  range and what a new view covers (one match, `shownRange`, where two chains had drifted), a thread's state in the
  bottom bar, a workspace's PR icon, a queued message's text, a git status code, and the empty texts of the command
  palette, Activity and the find bar. AGENTS.md says so for new code.
- **The pane's bar in a narrow pane:** a segmented control's options cut their labels off rather than wrap onto a
  second line, and the hide button keeps the size of the canvas bar's show button (`ToggleButton`'s `icon`: `cn`
  doesn't merge classes, so its own padding beat the `p-1` passed in).
- **Coming back to the window rereads the worktree** (ADR 0030), so edits made in an editor or a terminal show in the
  diff, _Uncommitted changes_ and the comments' states. Pays off the debt that uncommitted edits outside an agent turn
  didn't refresh the diff; edits while coxswain has focus still wait for the next refresh.

### Tech debt

- `ponytail:` the line diff gives up past 2000 edits between two versions (`follow.ts`); files at commits are cached
  for the session, never evicted (`entries.ts`).
- A comment on removed lines in a commit diff, _Not Pushed_ or _Uncommitted_ can read as outdated at once (ADR 0015's
  consequences). A thread written in _Uncommitted_ opens in _All_: `threadLocation` only restores commits and views.
- Not yet checked in the running app.

## 2026-09-30 — Reviewed in views; threads: queued questions, follow-ups, resolving; current agent session

### What works

- **A new app icon:** a shell seen from above on dark water, the cox a red dot at the stern (`resources/icon.svg`),
  given depth with gradients, a glow on the water, the hull's shadow and a Dock shadow (stacked tiles, as AppKit draws
  SVG drop shadows at low resolution),
  inset to macOS's 824px tile on the 1024px canvas. `icon.png` is now rendered by `scripts/render-icon.swift`:
  `qlmanage`, used before, fills the background white, so the corners weren't transparent.
- **Images in the viewer.** A PNG, JPEG, GIF, WebP, AVIF, BMP or ICO file shows as the image, opened from the file
  tree or in a file diff (before and after side by side), instead of _Binary file, not shown_. The core sends it as a
  `data:` URL in `FileText.image`.
  - Tech debt: the whole image goes over IPC as base64 (`ponytail:` in `git.ts`); a custom protocol would stream it.
- **One search in _New workspace_.** The _Pull request_ / _Branch_ tabs are gone: one field finds open PRs and
  branches on GitHub (a branch with an open PR shows only as that PR), and offers the rest as a new branch, spaces
  made dashes. Enter creates it only when nothing was found, so it never swallows a PR search.
- A view section's header has a _Reviewed_ checkbox: ticking it marks every file and file diff the section embeds as
  reviewed, unticking unmarks them all. It's ticked once they all are.
- In a view, a reviewed file diff or file collapses to its header instead of hiding, so the prose leading into it
  still reads (#14). _Show Reviewed Files_ expands them; ticking one keeps its header where it was on screen. Sections
  no longer drop out of a view when all their files are reviewed.
- **Queued questions in threads.** A question asked while the session's turn runs shows _Queued_ in its thread, not
  _Working…_, and _Don't Send_ in place of _Stop_ (`review:queued`, `SessionStates.queue`'s `onQueued`).
  - A thread's Stop now stops its own question: off the queue if it waits there, or the turn answering it. Before, it
    stopped whatever the workspace's last session was running, often another thread's turn.
  - Taken off the queue (there or with × in the agent pane), a question becomes a note again (`TurnResult` `unsent`),
    so _Send to Agent_ can send it later. Before, it stayed a question with no answer and couldn't be sent again.
  - Queued comments have no _Send now_: steering one put its answer into the running turn's thread and left its own
    thread with none. The core refuses to steer them too.
- **Carrying on a thread with the agent (#11).** A reply has the _Comment_ / _Agent_ toggle too, on _Agent_ after
  the agent's answer, explanation or finding. A question records the session it went to (migration:
  `entries.agent_session_id`); a follow-up in another session (a new session since, or the other agent) sends the
  lines and the whole thread so far, not just the notes since the last question, which that session never saw. The
  prompt's thread context is in `core/thread-context.ts`, pure and tested.
  - Tech debt: questions asked before the migration have no session, so their first follow-up sends the whole thread
    once. `byAgent` is still copied in the renderer (`format.ts`, `ponytail:`), now shared by the bottom bar and
    threads.
- **Resolve from the bottom bar.** Each thread in the bar's list ends in a ✓ that resolves it, or reopens it under
  _Resolved_, as the thread's own ✓ does.
- **The current agent session is the one last used.** `agent_sessions.used_at` (migration) is set when a session is
  made, picked in the agent pane's header, or sent a message; `listAgentSessions` marks the latest `current`. The
  pane opens it, also after a restart (it used to open the newest), and questions and _Hand off_ go to it, so a
  comment goes to the session shown. Pays off the `ponytail:` in `Agents.tsx` that comments went to the latest
  session, not the one shown.

## 2026-09-29 — Queueing and steering in the agent pane

For G5 ([issue 24](https://github.com/sladkoff/coxswain/issues/24), ADR 0018 point 13).

### What works

- **Send while a turn runs.** The composer stays usable: typing, pasting and dropping files, the paperclip. Sending
  queues the message in the core's session projection (`SessionStates.queue`), shown on top of the composer; each
  runs as the next turn when the running one ends, with no gap for another turn to take. × takes one off.
- **Send now steers** through the adapters' `_session/steering`: the message joins the running turn instead of
  stopping it. Claude Code hands it back if the turn had just ended, and it goes first in the queue.
- Comments and reviews from the canvas queue too, instead of failing with "A turn is already running".
- The session picker and New session work while a turn runs; sending and the pending message belong to the session
  they went to, so another can be shown or started meanwhile.
- Attachments are checked and saved when a message is sent, so a bad one fails at once, not when its turn comes.
- **Agent status in the sidebar.** Each workspace row is two lines, its git icon above a dot for its agent status:
  amber while a permission waits, pulsing blue while a turn runs, green when a turn ended that the user hasn't looked
  at. The core derives it from the session projection (`listAgentStatuses`); opening or leaving a workspace clears
  _done_ (`seeAgentSessions`). The renderer refetches the statuses only when a session's status changes.

### Tech debt

- The queue carries on after Stop and after an error (`ponytail:` in `session-state.ts`); hand it back to the
  composer if that surprises.
- The queue lives in memory: quitting drops it, like a draft.
- A steered message is added to the chat where it was sent, not where the agent took it in.
- _Done_ lives in memory, so a restart forgets unseen finished turns.

## 2026-09-29 — Language servers for Go to Definition and Find Usages

For G3 ([issue 16](https://github.com/sladkoff/coxswain/issues/16), ADR 0034).

### What works

- **Go to Definition and Find Usages ask TypeScript's own server** (`lsp.ts`, `language-servers/typescript.ts`):
  `tsc --lsp --stdio` from TypeScript 7, started per checkout on the first click. Members resolve (`workspace.id`
  goes to `Workspace.id`), overloads list each, and usages are references, not words. The grep and its regexes are
  gone; a file no server takes says so in the menu.
- **Both sides of a file diff.** A token on the old side asks about the base, on the new side (or a whole file) about
  the head, or the worktree when there is none. A commit that isn't the worktree's snapshot gets a read-only checkout
  in `~/coxswain/checkouts/<owner>/<name>/<sha>/` (`checkoutAt` in `git.ts`) with the worktree's `node_modules`
  linked in. Results open at the same revision: a whole file can now show a commit (`fileAt` in the canvas location).
- **Pluggable:** a language is a `LanguageServer` file in `src/core/language-servers/` and a line in
  `languageServers`: its extensions and LSP language IDs, how to start it, and the dependency folders it reads.
- At most `lspLimits.servers` (4) run; the least recently used stops, and checkouts no server reads are removed. All
  stop on quit. `tsc` watches its files itself, so agent edits are seen.
- `typescript` is now a pinned dependency of the app; its native binary is unpacked from the asar.
- **Python** (`language-servers/python.ts`): pyrefly 1.3.2, fetched on first use from its GitHub release for the
  platform, checked against a pinned sha256 and kept in `~/coxswain/language-servers/` (`download.ts`, reusable for
  later native servers). A worktree's `.venv` or `venv` is linked into commit checkouts like `node_modules`.

### Tech debt

- A commit's checkout reads the worktree's dependencies, not its own; results in them (outside the checkout) are left
  out there (`ponytail:` in `lsp.ts`).
- ⌘ still underlines names in files no server takes; the menu then says there's none.
- No "indexing" state: the first click in a big repository waits for the server to load the project.
- A packaged build bundles only the host platform's `tsc`, like the agent SDKs; cross-platform builds need the other
  `@typescript/typescript-*` packages installed (ADR 0024).
- Python in a repository that needs its venv to import its own packages (a uv workspace) finds nothing across them
  until the venv exists; coxswain doesn't create it. Checked on cortea without one: an import resolves to itself.
- pyrefly's Linux builds are glibc only (`ponytail:` in `python.ts`); its Windows zip layout is assumed, not checked.
- Updating pyrefly is by hand: the version and six checksums in `python.ts`.
- A checkout made while another request prunes could be removed and made again (`ponytail:` in `lsp.ts`).
- Checked in the app over the IPC and by ⌘-click on both sides; _Find Usages_' native menu wasn't clicked through
  (its results were checked over the same IPC).

## 2026-09-29 — Find in the canvas and agent pane

For G3 and G5 ([issue 15](https://github.com/sladkoff/coxswain/issues/15), ADR 0033).

- ⌘F, ⌘G and ⇧⌘G run through the native Edit menu and action registry. The shared Find bar has a literal query,
  Match Case, result count, Previous/Next and Escape to close. Each pane remembers its query in memory.
- Canvas Find searches across the current range/view's file diffs and source embeds, including off-screen files;
  a whole-file canvas searches that file. Hidden reviewed files and collapsed unchanged regions are excluded.
  Cached reads use the existing core bridge with at most four viewers preparing at once. Navigating mounts the
  target viewer and uses Pierre's line positions to reveal an off-screen result. Shared split context counts once.
- Conversation Find searches the selected session's rendered messages and cards, reveals clipped matches and
  suspends auto-scroll during search. CSS Highlight ranges preserve user selections and React/Pierre nodes.
- Scope limits: no search across view prose/diagrams or other sessions; binary files are skipped. Unreadable files
  produce an explicit partial-search message. No persisted search state or new dependencies.
- Validation: initial scoped implementation passed typecheck and lint; matcher tests passed after fixing the
  deleted-file boundary. The first Electron harness attempts were blocked by stale fixture APIs. The scope was
  then broadened to all canvas diffs. Further automated/UI checks were stopped at the user's request; the user is
  testing the final implementation locally.

## 2026-09-29 — Agent attachments

For G3 and G5 ([issue 20](https://github.com/sladkoff/coxswain/issues/20)).

- The composer has a paperclip button with a native file picker, file drop, and image/file paste. Removable previews
  sit above the text; attachment-only messages and attachments alongside view prompts work. Drafts survive navigation
  and failed sends. Limits: ten files, 20 MB total, images up to 5 MB each.
- ACP prompts carry images, embedded UTF-8 text up to 1 MB (plain text fallback for agents without embedded context),
  and local file references for other files. The core retains ACP capabilities and rejects unsupported images.
- Original attachment previews live in SQLite, linked by a header in the agent-owned transcript (ADR 0032).
  Streamed chat entries carry references; image previews load once through IPC.
  Replay restores them without showing base64 links or duplicating embedded file contents. Removing a workspace
  cascades through its sessions and attachment records. The chat projection is extracted for replay tests.
- Validation: unit tests cover ACP content, limits, database reopen/cascade and replay. An isolated Electron run with
  a test ACP agent checked paste, drop, picker imports, removal, attachment-only sending, failed-send restoration,
  and preview restoration after a full restart. Typecheck, lint, format, tests and build pass.
- Limits: local file references require the original file to remain available and readable by the agent. Unsent
  attachments live for the window only. Failed prompts may leave an unreferenced attachment record until their
  session is removed; a future session cleanup can collect these (`ponytail:` in the save path).

## 2026-09-29 — General improvements

- Removing a workspace closes its open agent sessions (`closeWorkspaceSessions`, `session/close`), so their agent
  processes end instead of running on until the app quits against an MCP URL whose workspace is gone. Sessions of
  workspaces still in the sidebar stay open when the user looks elsewhere, so a turn keeps running.
- **Background tasks** (glossary, ADR 0018): a command the agent leaves running in the background, such as
  `sleep 60` or a dev server, is listed on top of the composer until it ends, with × to stop it.
- The agent's reply when a background task ends now shows: that turn, which the agent starts on its own, reached no
  run and was dropped, so a "ping me in a minute" never came back.
- Running subagents are listed with the background tasks (_Agent_ and its name), from start to end, for Claude Code
  and Codex alike: both adapters implement ACP's draft subagent sessions, now advertised (ADR 0018). A subagent's start
  becomes its `Agent …` line in the chat, live and in a reopened session; Codex's _Start subagent_ / _Complete
  subagent_ lines are gone. Its permission requests reach the pane's prompt. `claude-agent-acp` is patched so its
  replay keeps the subagent (`patches/`; drop it once upstream fixes it). No × for a subagent: no adapter offers it.
- Codex's background tasks use the same updates as Claude Code's, for commands in a background terminal; Codex mostly
  runs commands in the foreground, so a "ping me in 10 seconds" shows no bar there.
- The agent's messages in one turn are separate entries again, split on ACP's `messageId`: its reply before a
  subagent finished and the one after ran together without a space.
- The message Claude Code sends itself when a background task ends (`<task-notification>…`), which a session's
  history replays as the user's, shows as one line with its summary instead of the raw XML.
- Tools called in parallel get their titles: a title that arrived after the next tool had started was dropped, so the
  line stayed the tool's kind (_Terminal_).
- **Rebuild and Reload** (View menu, ⇧⌘R), under `pnpm start` only, to work on coxswain in coxswain: it runs
  `pnpm build` and, when only the UI changed, reloads the window while the agents keep working in the main process. A
  new main process or preload relaunches the app, and asks first while a turn or file summary runs, since the
  relaunch stops it; sessions resume after. A failed build leaves the running app as it was and shows the error.
  `ponytail:` the agent's own turns and background tasks between turns don't count as working.
- Tech debt: `ponytail:` the `async_task_*` and `subagent_*` updates are handled on the incoming stream before the ACP
  SDK sees them, since it checks each `session/update` against its schema and drops them; hand them to the SDK once it
  has them. A patched adapter (`patches/`), to drop on its next release that fixes the replay. A turn the agent starts on its own shows no _Working_ and has no Stop.

## 2026-09-28 — View prompts

For G3 ([issue 2](https://github.com/sladkoff/coxswain/issues/2)): understanding a huge agent-written PR well enough
to ask its author the right questions.

- **View prompts** (glossary, ADR 0031): _New View_ lists built-in prompts, sharper than before, plus a new
  _Questions for the author_, then the user's own, kept in a new `prompts` table and added or deleted in Settings
  (_View prompts_). _New Prompt…_ in the menu opens Settings at a new prompt; ⌘K lists every prompt as a New View action.
- A picked prompt is attached to the composer as a card instead of filling it with prose; what the user types goes
  with it as the focus. The message is `[View · title]`, the note, `---`, the prompt; the chat shows it as a card and
  the pane's instructions tell the agent how to read it.
- Tech debt: `ponytail:` saved prompts can't be edited in place, only deleted and added again. `agents.ts` can't be
  loaded by `node --test` (extensionless imports), so the `[View · …]` parsing has no test.

## 2026-09-28 — Views being written

For G3: while the agent writes a view, it grows section by section and looked done at every step.

- **_Being written_** (glossary, ADR 0023): a view from a tool's change to it until the workspace's turn ends, done,
  stopped or failed. No `finish_view` tool; the turn's end is the signal. In memory in `src/core/views.ts`
  (`turnEnded`, called from `runTurn`), and `View.writing` for the UI.
- A line above the view, outside its scroll, says it's still being written, with a spinner; so does its chip. A
  guide's files in no section yet show under _Not yet in the guide_.
- Tech debt: `ponytail:` any turn of the workspace ending finishes all its views, since the tools don't know the
  session; key by session if two turns at once in a workspace become common. The line stays up while the agent
  works on in the same turn after its last section.

**Going to a thread** (the Threads list, _View thread_): a thread already on the canvas, such as a note written in the
view shown, is scrolled to in place instead of opening the range it was written in. The scroll now finds threads
further away: the file diffs' Virtualizer draws only the lines near the viewport, and keeps a thread's element
without a box until its lines are drawn, so `scrollToThread` goes to the file, pages down it until the thread has a
box, and keeps it in place until it holds. Picking the same thread again scrolls again. Checked by clicking every
thread in a guide and a diff from the top and bottom of the canvas, twice. `ponytail:` a screen per step, about a
second per thousand lines of a long file.

**Thread counts** in the Navigator and a view's table of contents count every thread on a file, the agent's
explanations and findings too (they only show with their view); hovering says how many of each. The table of
contents shows a muted speech bubble and the number instead of a blue ✎; the Navigator shows only the bubble. Its row
decorations are text or one icon, not both, so `ponytail:` the bubble is CSS matched to a text part by its colour. It's
a served SVG, not a `data:` URL, which the CSP's `img-src` blocks. The Navigator's decoration (lines, ✓, ●,
bubble) now keeps its width and a long name is cut short instead; before, a long name hid it.

## 2026-09-28 — Muted files instead of files left out

For G3, from a guide asked to pass over "generated files and tests and files containing just convention fixes": the
agent left those files out, so they showed under _Not in the guide_, because the instructions said files left out
show there and the only low-light word, `generated`, meant tool-made files.

- **_Muted_ replaces _Generated_** (glossary): a file the reader can pass over, for whatever reason. Fences say
  `muted`; `generated` still reads the same, so older views are unchanged. The field is `muted` in the core and UI.
  A muted section no longer says "Generated ·": its heading says why.
- **Guides never leave a file out:** tool-made files and those the user doesn't care about go in muted sections at the
  end, one line per section and no sentence per file. _Not in the guide_ stays for files missed by accident.
- **Other views** don't embed files just to mute them; muting is for an embed there for context.
- `pnpm typecheck`, `pnpm test` (16), `pnpm lint`, `pnpm format`, `pnpm build` pass. Not checked with a real run yet.

## 2026-09-28 — start_view first, and named commits

For G3, from a guide on #5311 with Claude Code (Opus 5.5): 4 min 20 s, 209 s in the model (28.8k tokens written),
30 s in tools (coxswain's calls 0.0–0.3 s; the rest Claude Code's Bash, 2–4 s a call).

- It spent its first 43 s working out the range with git (the branch merges `main`), then sent `head: "HEAD"`, which
  was refused. `start_view` now says to call it first, since it works out the range itself, and `base`/`head` take
  HEAD, branches, tags and `~`/`^` as well as hashes. Names git could read as an option or a range are refused.
- Tests: names resolve; `--output=x`, `HEAD..main` and names with spaces don't. `pnpm typecheck`, `pnpm test` (16),
  `pnpm lint`, `pnpm format`, `pnpm build` pass.

## 2026-09-28 — No auto-review for coxswain's tools, and batched writes

For G3 ([ADR 0023](adr/0023-guides-made-by-the-agent-pane.md)), from the third guide on #5311: 4 min 30 s, 94 s in
tools of which ~65 s were 28 coxswain calls at ~2.3 s each, while coxswain answers in ~0.07 s.

- Codex's log (`~/.codex/logs_2.sqlite`) shows why: each MCP call went to its Guardian auto-review (`reason=Policy`),
  a model turn of its own. Codex (`requires_mcp_tool_approval`, 0.155) reviews a call unless the tool is
  `readOnlyHint`, or both `destructiveHint: false` and `openWorldHint: false`. coxswain's tools now say what they do:
  `list_views` and `file_summaries` read only; `start_view`, `write_section`, `add_explanation` and `add_finding`
  write only coxswain's views and entries; `remove_section` stays destructive, so it's still reviewed.
- **Batches:** `write_section` takes `sections` (in order; one that doesn't fit stops, the ones before it are kept
  and said), `add_explanation` takes `explanations` and `add_finding` `findings` (each one that doesn't fit is
  reported, the rest added). The guide instructions ask for them.
- Tests: batches, a bad item in each, the annotations. `pnpm typecheck`, `pnpm test` (16), `pnpm lint`, `pnpm
format`, `pnpm build` pass. Not measured yet on #5311.

## 2026-09-28 — Tool results Codex keeps whole, and faster section writes

For G3 ([ADR 0029](adr/0029-file-summaries-and-activity.md)), from the second guide on #5311: 4 min 37 s, 10 steps,
191 s in the model, 79 s in tools, 743k input tokens (the first: 17 steps and 477 s in the model before it was half
done).

- **Codex cuts tool results of more than ~10k tokens in the middle**: `start_view` (16.4k) lost 40% of the file list
  and summaries, and four more results were cut. The file list now comes by folder (a long path once) and in parts of
  at most 20,000 characters: `start_view` lists what fits, puts the instructions first, and says `file_summaries
from: N` for the rest; `file_summaries` takes `from`. #5311 is three parts.
- **`write_section` no longer lists the range's changed files each time** (15–31 s per batch of six sections on
  #5311): a pinned range's changed files and files at its head are read once and kept.
- A job whose last write fails (the database closed) logs it instead of an unhandled rejection.
- Tests: paging lists every file once. `pnpm typecheck`, `pnpm test` (16), `pnpm lint`, `pnpm format`, `pnpm build`
  pass.
- `ponytail:` the changed-files cache keeps every range asked about while the app runs; an LRU if it grows.

## 2026-09-28 — Guides read fewer diffs

For G3 ([ADR 0029](adr/0029-file-summaries-and-activity.md)), from a guide on #5311 that still took ~10 minutes.

- Its Codex transcript: summaries were there and used to plan, but the instructions also said to read a diff before
  writing about a file, and a guide writes about every file. 17 steps, 477 s in the model against 49 s in tools,
  1.44 M input tokens for 8.7k written: each 25–40k-character diff read is re-read by every later step.
- **The guide instructions now** write each file's sentence from its summary and read diffs only where a summary
  doesn't do (none or unclear, the heart of the change, lines explained or judged), and write several sections per
  step. `file_summaries` says it's for summaries still being written; `start_view` lists the rest.
- **Summaries are shorter:** one sentence of at most 25 words (stored up to 300 characters). The key carries the
  prompt's version, so the old, longer ones are written again once.
- Not measured yet: the same guide with these changes.

## 2026-09-28 — Views of a commit, a turn or a scope

For G3 ([ADR 0023](adr/0023-guides-made-by-the-agent-pane.md)).

- **`start_view` takes a range:** `base` and `head` commits (short hashes resolved), or `head: "worktree"` for the
  snapshot, the default. A view pinned to commits isn't stale when the worktree moves on (`views.worktree`, migration
  7), so it opens as the newest view too.
- **New View knows what the diff shows:** with a commit, an agent turn, _PR_/_Pushed_ or _Local_ picked, the New View
  menu names it and the message starts "For commit 1c8d547 (…) only (start_view with base … and head …)"; the pane's
  instructions say to pass that on. The view's summaries follow, since `start_view` summarises its own range: a
  commit's few files, cached for next time.
- Tests: `views.test.ts` (a commit view's range, an unknown commit), `canvas-state.test.ts` (a commit view isn't
  stale). `pnpm typecheck`, `pnpm test` (16), `pnpm lint`, `pnpm format` and `pnpm build` pass.

## 2026-09-28 — Watching the workspace for commits

For G3 and G5 ([ADR 0030](adr/0030-workspace-watcher.md)).

- **The workspace on screen is watched:** every 3 s the core reads its HEAD. A commit, pull or reset, in coxswain or
  a terminal, refreshes the diff and commits within seconds and is summarised ahead.
- **GitHub is checked every 2 minutes** while a workspace shows (the worktree query's refetch interval), in the
  background too.
- **Activity's _This workspace_ line:** how many of its committed file diffs have a summary at HEAD.
- A sync state badge in the canvas bar (↓ behind, ↑ not pushed, ● uncommitted, or ✓) was built and taken out again:
  it added little over the Commits pane.
- Tests: `watch.test.ts` (a commit is a move, an edit isn't). `pnpm typecheck`, `pnpm test` (16), `pnpm lint`,
  `pnpm format` and `pnpm build` pass.
- `ponytail:` one workspace watched at a time, by polling git; file system events as a hint if many workspaces make
  it slow. Uncommitted edits outside an agent turn still don't refresh the diff.

## 2026-09-28 — File summaries and Activity

Issue #36, for G3 ([ADR 0029](adr/0029-file-summaries-and-activity.md), [UX](UX.md) Activity).

- **File summaries are back, for the agent.** A small model (Settings > _File summaries_: Claude Code or Codex, and a
  model; Haiku by default, matched by family to Claude Code's model IDs) sums up each changed file. They're stored in
  `file_summaries` (migration 5) by file diff fingerprint, so a changed file diff is summarised again and an unchanged
  one never is. Lockfiles, deletions, pure renames and binary files are summarised by coxswain without a model call.
- **Summary jobs** run ahead when a workspace's worktree is opened or checked again and after each agent turn (merge
  base → HEAD, committed changes only), and for each view `start_view` starts (its snapshot, uncommitted changes
  included). Batches as the old pipeline had them, at most 6 one-shot runs at once (`askOnce`: no tools, own system
  prompt, no thinking, session closed after), JSON answers checked in the core, two retries with backoff, files left
  out asked for one by one. A failure retrying can't fix (no such model, agent missing) stops the job after one run,
  and summarising ahead then waits for the settings to change.
- **The agent gets them:** `start_view` lists each file with its summary (or _being written_ / _no summary_), the new
  `file_summaries` tool fetches them and can wait, and the guide instructions say to plan from them and read a diff
  before writing about a file.
- **Activity** at the canvas bar's right: turns while a job runs, a red dot after a failure, and a list of jobs with
  progress (red when failed), reuse, model, runs, range, files in flight, the last error and Stop. Jobs are stored in
  `summary_jobs` (migration 6), so they show after a restart; one running when the app quit is marked stopped at the
  next start. The main process logs each finished job.
- **Paid off:** `write_section` and `remove_section` no longer lose sections written at once; they change a view one
  at a time.
- Tests: `summaries.test.ts` runs jobs against a real repository with a fake summary agent (retries, files left out,
  reuse, the view tools, sections written at once, a fatal failure, stored and interrupted jobs). `pnpm typecheck`, `pnpm test` (15 tests),
  `pnpm lint`, `pnpm format` and `pnpm build` pass. Seen in the running dev app on #5311: Activity showed the jobs and
  their errors, which caught `haiku` not matching Claude Code's `claude-haiku-4-5`; the family match that fixes it
  hasn't been seen running yet.
- `ponytail:` batch sizes and parallelism are fixed, from #5311; lockfiles are recognised by name only; summaries of
  file diffs no range has any more are never pruned; the last 500 jobs are kept.
- Not measured yet: how much faster a guide to #5311 gets. Worth timing once summaries have run ahead.

## 2026-09-28 — Workspace and session continuity

Issue #29, for G3 and G5 (ADRs 0017, 0018, 0025, 0026).

- Markdown renderers have stable component identities. Opening ⌘K and unrelated canvas renders no longer remount
  Mermaid diagrams, replace them with a loading placeholder or collapse their height.
- The router selects workspace and canvas together. Sidebar switches remember the last location and scroll;
  Back/Forward use their own entries. The default view, its range, entries and Reviewed state resolve before the
  canvas appears. Scroll retries and thread waits are cancelled when navigation supersedes them.
- Agent state lives in the core: history, streamed entries, running status, pending permission and errors. First
  history reads are deduplicated before a turn starts, and active reads do not replay ACP. Versioned snapshots feed
  the query cache even while panes are absent; stale IPC responses cannot replace newer streamed state. Selected
  session, drafts and pending session creation survive pane unmounts in window-lifetime presentation state.
- Bottom-bar and chat-card navigation reveals reviewed files and their sections, selects the entry's view/range,
  waits for the thread to mount and opens outdated threads. Reviewed marks are preserved.
- Regression tests cover replay races, detached sessions, permissions, completion, stale IPC reads and canvas
  selection. `scripts/test-flickering.cjs` checks the built renderer in an isolated Electron window with fixture
  data: diagram identity under ⌘K, warm/cold workspace switching, Back/Forward, live sessions, permissions and
  hidden/outdated comments, restored scroll, drafts and session creation while hidden. No real agent or GitHub
  account is used by that UI test. `pnpm typecheck`, `pnpm test` (13 tests), `pnpm lint`, `pnpm format` and
  `pnpm build` pass; the Electron checks pass too.
- ponytail: session projections remain in memory until app exit; idle eviction can bound memory if needed.
- ponytail: coalesced session notifications carry full snapshots; versioned entry deltas can reduce IPC copying
  if long transcripts make it expensive.

## 2026-09-28 — Top and bottom bars, and a sidebar with titles

UX, for G3 and G5 ([UX](UX.md) L2, L3).

- The left pane has its own bar, as wide as it: a panel button to hide it and _Changes N_ · _Files_ · _Commits_. That
  replaces the canvas bar's _Files_ and _Commits_ buttons and the Navigator's _Diffs_/_Files_ toggle, which is now
  _Changes_/_Files_. ⌘B hides and shows the pane as it was; while it's hidden, the panel button sits at the canvas
  bar's left.
- The canvas bar holds only what the canvas shows. The _Diff_ tab carries its range (_All ▾_, _PR ▾_, _Local ▾_, or the
  commit or turn picked, with ✕), shown whether a view shows or not, so the view chips no longer move. Its native menu
  picks a scope or _Commit or Agent Turn…_ (the commits pane).
- One display options menu (sliders icon, was the cog): Unified/Split, Show Reviewed Files and _Files as Tree_/_As
  List_. The Navigator's own cog and its "N of M reviewed" line are gone; the bottom bar counts reviewed files.
- Checked in the built app, on a copy of the database: pane hidden with a guide showing, _Changes_, _Files_, a commit
  picked from _Commits_ and cleared with ✕. The two native menus weren't opened in that check.
- The bottom bar: the review at a glance on the left (a thread toggle with _● N waiting_, _8/29 reviewed_ with its
  progress bar, the lines), and one _Hand off N_ button on the right. Its native menu has _Send to Agent_, _Copy as
  Prompt_ and _Send to GitHub as a Review…_ (greyed out, not built). The thread list gets a header with _Open_ ·
  _Resolved_ and groups threads by file, each with a status dot. Checked in the built app with a reply added to an
  explanation (the count came up as 1); the native menu itself wasn't opened in the check.
- The workspace sidebar (L1) is about 230 px wide: the project by name and owner, then a row per workspace with its
  PR's title, `#number · branch`, and an open/draft/merged/closed or branch icon; the pill marking the current one is
  gone (its row is filled). Titles and states come from GitHub in one GraphQL request for the workspaces' PR numbers
  (`listPullRequestTitles`), nothing stored; a number that isn't a PR is skipped. Checked in the built app.
- The sidebar hides entirely with a panel button in its bar; the agent pane's header then makes room for the window
  buttons and shows the button to bring it back (also _Show or Hide the Sidebar_ in the command palette).
  ponytail: open or hidden resets on restart, like the pane widths; store it once there's a settings table.
- The agent pane: the header's session title sits at the left (it kept 32 px of padding from the old narrow sidebar),
  bold with a chevron, the agent muted after it, and New Session is a pencil icon with its agent chevron. The composer
  is one rounded box: _Ask Codex…_, the model and effort as small icon buttons with chevrons, and a round send button
  that becomes a stop button (with _Working_) while a turn runs. Checked in the built app idle and with text typed; the
  running state wasn't started in the check.
- Open a project and New workspace are dialogs over the window instead of full-window screens (a shared `Dialog`:
  title, subtitle, ✕; Esc or a click outside closes), each with a search field across it. Rows got initials, a lock
  for private repositories, PR icons, `#number · author · branch`, relative dates (_3 days ago_) and _Current_ / _Has a
  workspace_ badges. Checked both in the built app.
- New workspace has two tabs, _Pull request_ and _Branch_. The branch tab drops the browser's datalist: its one field
  filters the GitHub branches as a list (pick one to work on it) and offers _New branch `name`_ from a base picked in
  the native menu.
- Views read more easily: each section starts below a line with a larger heading and `N files · N reviewed`; embedded
  file diffs are cards (rounded, bordered, a little apart; `overflow: clip` so their sticky headers still stick); prose
  sits close above the diff it leads into and apart from the one before it; text is capped at 72ch while diagrams and
  tables take the column's width, a diagram on a light card. Diagram labels no longer inherit the prose's
  break-anywhere, which could wrap a label inside its fixed box and cut it off (seen on an ER diagram; not re-checked
  with one, the guide at hand had flowcharts). The plain diff keeps its flush list.
- ponytail: the bar counts what Hand off takes with the same rule as the review prompt in `core/review.ts`, copied,
  since the renderer imports no core code. Move it to a shared pure module if a third place needs it.
- Still open: a guide's table of contents stays its own column; making it the pane's first tab (_Sections_) would
  save a column.

## 2026-09-28 — Views of existing code without a diff

Issue #31, for G3 and G5 (ADRs 0014, 0023, 0026).

- Views can start on a clean branch and explain existing code with prose and diagrams. The agent's instructions
  describe source-file embeds: `file path=…` fences show the whole file at the view's snapshot, including unchanged
  files. Diff embeds still require a change; guides use diffs for their changed files.
- Embedded source files use Pierre's file viewer, with inline comments, explanations and findings. Paths are checked
  against the pinned git tree; directories and submodules cannot be embedded as files. Every path is embedded once.
- Whole files have separate Reviewed fingerprints, based on their contents, independent of the diff or merge base.
  Existing diff marks are preserved. File headers, section counts, the table of contents and the bottom bar agree;
  the bottom bar counts the view's embeds. Show Reviewed Files and section navigation work for source files too.
- Reviewed for commit and scope diffs now follows the displayed range, as view review state already did.
- Regression tests cover empty diffs, mixed embeds, invalid paths and diagrams, annotations, guide coverage,
  snapshot reads and independent review state across edits and base changes. Checked in the built app with a
  disposable clean repository: source file, diagram, explanation, Reviewed hiding, progress and section navigation;
  then mixed source/diff embeds, independent checkboxes and the all-reviewed message.
- Source embeds show whole files; selecting a line range for an embed remains deferred. No schema migration needed.

## 2026-09-28 — Branch workspaces, local changes and turn diffs

The local development loop (#3, ADR 0028), for G5.

### What works

- **A workspace without a PR.** The new workspace screen starts one on a branch: a new one made from a base branch (the
  default unless another is picked), or one already on GitHub. Its diff is against where it forked. The sidebar shows
  the branch's last name part. _Open Pull Request…_ (Commits pane, ⌘K) pushes it and opens a draft PR into the base
  branch in the browser; the workspace is the PR's from then on, in the same worktree. A PR opened elsewhere for the
  branch is picked up when the workspace opens, and opening that PR from the new workspace screen reuses it.
- **Local changes told apart** (UX open question 5, now gone): _All_ · _PR_ · _Local_ next to _Diff_; the Navigator
  marks files with local changes (●); the Commits pane marks commits not pushed and has _Push_ (never forced).
- **Snapshots.** The worktree as a commit, uncommitted and untracked files included, without touching its index
  (`src/core/snapshot.ts`). New views are pinned to one, so they include local changes, and go stale when the worktree
  changes rather than only when the PR moves.
- **Turn diffs.** Every agent turn is snapshotted before and after; a turn that changed something is listed under
  _Agent turns_ in the Commits pane and shows like a commit diff.
- The `workspaces` table is rebuilt (nullable `pr_number`, `branch`, `base_branch`) with foreign keys off while
  migrating, checked after; `turns` is new. `src/core/workspaces.test.ts` covers the rebuild keeping children, branch
  names and snapshots.
- Checked in the app: a branch workspace with a local commit, an untracked file and an agent turn; the scopes; the
  turn's diff; a view with the untracked file going stale on an edit; a PR workspace's scopes. _Push_ and _Open Pull
  Request…_ weren't run against GitHub.

### Tech debt

- `ponytail:` snapshot refs (`refs/coxswain/snapshots/`) are never pruned.
- `ponytail:` a branch's slashes become `+` in its worktree's folder name, so `a/b` and `a+b` collide.
- `ponytail:` the branches offered for a new workspace are as of the clone and the fetches since.
- `ponytail:` two turns running at once in one workspace each get both's changes.
- The base branch is picked from a native menu of every branch on GitHub; long for big repositories.
- coxswain doesn't commit; the agent or the user does (UX open question 5).

## 2026-09-27 — README for the first release

### What works

- **The README lists the features since it was written** (#24): views with diagrams and embedded file diffs, _Copy as
  prompt_, Back and Forward, and the command palette.

## 2026-09-27 — Install script

### What works

- **`curl … install.sh | sh`** installs the latest release on macOS (`.zip` into `/Applications`) or Linux (AppImage
  into `~/.local/bin`), or a given version. Release files are now named `coxswain-<version>-<os>-<arch>`, so the
  script can build the URL.

### Tech debt

- The repo is private, so the curl line only works once it's public.
- No Windows script and no Linux arm64 release build.

## 2026-09-27 — Send all, at once; Copy as prompt

### What works

- **Send all to agent shows at once** in the agent pane. The refetch of the transcript that tells the pane about a new
  session used to reload the session mid-turn and replace the message just streamed in; `readTranscript` now returns
  null while a turn runs in the session, and the pane keeps what streamed. Questions sent from threads had the same
  race.
- **Copy as prompt** next to it in the bottom bar puts the same message (without its _[Review · N threads]_ header) on
  the clipboard, to paste into another agent.

### Tech debt

- The pane still doesn't show _working_ for a turn it didn't start, and a session made by _Send all_ misses the
  message itself until the turn ends (it streams before the pane knows the session).

## 2026-09-27 — Agent session titles

### What works

- **Agent sessions have titles** (#14): the session picker names each session by its title instead of _Session N_.
  Claude Code's adapter generates one after the first turn and sends it as a `session_info_update`; the core stores
  it in `agent_sessions.title` (a new migration) and tells the UI. Until then, and for Codex, which names a session
  only when the user does, the title is the first message's first line, without a comment's or review's header.
- View titles were already the agent's (`start_view`'s `title`); unchanged.

### Tech debt

- Sessions started before this keep _Session N_ until their next message.
- A title can't be renamed in coxswain.

## 2026-09-27 — Command palette and action registry

### What works

- **Command palette** (#10, ADR 0027): ⌘K (_View > Command Palette…_) opens a search box with `>` typed; the text
  after it finds an action by fuzzy match and Enter runs it. Without `>` it's Open Quickly (⌘⇧O), now ranked: a match
  in the file name first, then word starts, then letters in order.
- **Action registry**: every action (Back, Forward, show or hide Files and Commits, show the diff or a view, each New
  View, Unified or Split diffs, show or hide reviewed files, open a workspace, New Workspace, switch project, Add
  Project, Settings, Open Quickly) is one entry in `App.tsx` with a title, shortcut and whether it can run now. Native
  menu items send one `action` IPC event with the id, replacing four one-off events; the canvas bar's Back, Forward
  and magnifier run actions by id.
- `pnpm test` runs `node --test` over `src/**/*.test.ts`; the first is the fuzzy matcher's.

### Tech debt

- Native menu items aren't greyed out from the registry (only Back and Forward are); a disabled action's menu item
  does nothing.
- The palette doesn't list PRs not yet opened as workspaces, or agent sessions ([UX](UX.md) wants both).
- Files are still capped at the first 50 matches.

## 2026-09-27 — Managing views

### What works

- **Older views can be changed** (#20): `write_section`, `add_explanation` and `add_finding` take `view`, the id
  `start_view` returns, and write to the latest view without it. `list_views` lists the views with their ids and
  section headings, and `remove_section` removes a section.
- **Views can be removed:** right-click a view's chip → _Remove View…_, confirmed, deletes it with its explanations
  and findings. Removing the newest no longer shows the one before it as if it were new.
- Checked with a throwaway script against an in-memory database: `list_views`, `remove_section` on an older view and
  on the latest, unknown ids and section numbers, and the cascade to entries.

### Tech debt

- Paid off: the tools wrote only to the latest view and views couldn't be removed.
- Two sessions keep their views apart only if the agent passes `view`; nothing ties a view to its session.

## 2026-09-27 — Views: markdown, diagrams and embedded file diffs

### What works

- **Views** (#1, ADR 0026): the agent makes views of the PR with coxswain's tools, not only guides. A view is a title
  and sections of markdown: prose, tables, ` ```mermaid ` diagrams, and ` ```diff path=… ` fences that embed a file
  diff as in the diff, with threads, explanations, findings and _Reviewed_. The core parses sections; the UI renders
  them.
- **Guides are views** that go through every changed file; files no section embeds show under _Not in the guide_.
  Existing guides were migrated into sections (their explanations, findings and replies kept). Other views show
  only what they embed.
- **Tools:** `start_view` (title, guide) and `write_section` (append, or replace section N) replace `start_guide` and
  `add_group`. `start_view`'s result teaches the syntax and how to write a guide or another view.
- **The canvas bar** names each view's chip by its title (_Guide_, _Data flow_, _Guide 2_ for a repeat). _New View_'s
  menu adds _data model_, _data flow_ and a message of your own. The table of contents lists sections, with counts only
  for sections that embed file diffs.
- **Mermaid diagrams anywhere markdown shows**, chat and threads included: loaded on the first diagram, in the system
  theme and redrawn when it changes; a diagram that doesn't draw shows its code and the error.
- **The agent's diagrams are checked:** `write_section` has the window draw each one first and refuses the section with
  mermaid's error if one doesn't draw, so the agent fixes it. Checked by calling the tool over the MCP server: a
  broken flowchart came back with the parse error, a good ER diagram was added.
- Explanations are labelled _Explanation_, not _Guide_, since any view can have them.
- Checked in the built app driven with Playwright's `_electron`, on a copy of a real database: a migrated guide
  (sections, table of contents, a low-lighted generated section, an explanation between the lines) and a data flow
  view (a flowchart, a table, an embedded file diff, a broken diagram's error).

### Tech debt

- The agent learns whether its diagrams draw, not how they look; with no window open they aren't checked.
- An embed is a whole file diff; embedding only some of its lines isn't built.
- Reviewed file diffs are hidden in every view as in a guide, which can hide the one file diff a data model view is
  about; _Show Reviewed Files_ brings it back.
- Mermaid is about 1.2 MB of the renderer bundle, in its own chunk.
- The bottom bar and the Navigator count the whole range while a view that embeds only some of it shows (UX open
  question 2).

## 2026-09-27 — Diff and numbered guides in the canvas bar

### What works

- **_Diff_ chip** left of the guide chip in the canvas bar: shows the diff without a guide, and is on while none
  shows. It replaces the Guide menu's _No Guide_.
- **A chip per guide**, numbered in the order made (_Guide 1_, _Guide 2_, …), to switch between them; the guide's
  date, head and staleness are in its tooltip. The Guide menu is gone.
- **_New View_ chip** (dashed, a layers-plus icon) after it: its menu has _New View (guide)_ and _New View
  (review)_, which fill the agent pane's composer as before. Meant to offer other kinds of view later.

## 2026-09-27 — Back and forward on the canvas

### What works

- **_View > Back_ (⌥⌘←) and _Forward_ (⌥⌘→), and chevrons in the canvas bar** step through the canvas's history
  (#8, ADR 0025): whole files opened any way, files picked in _Diffs_, the _Diffs_/_Files_ toggle, commits and guides
  picked, and workspaces opened. Back into another workspace's step opens it again. Greyed out at either end.
- **The canvas's state is the location** (`CanvasSearch` in `router.ts`): TanStack Router with memory history, one
  route. A change to what the canvas shows is a `navigate()`, so it's a step without anything else to wire.
- **Each step keeps its scroll.** A whole file by offset; the file diffs by the one at the top and how far into it,
  since those above it may have been read (and grown) since. The file diffs stay mounted, hidden, under a whole file.
  The restore is applied again until it holds: after a jump, Pierre's Virtualizer applies the fix-up it worked out
  for the old place. Its own `scrollTo` does the same (tried).
- **The keys work with the Navigator focused:** the main process takes them in `before-input-event`, before the file
  tree (which uses ⌥⌘←/→ itself) can.
- Checked in the built app driven with Playwright's `_electron`: diffs picks, the _Files_ toggle and whole files,
  back and forward across them with a tree row focused, the chevrons, the menu items greying out, and after a resize.

### Tech debt

- The scroll restore gives up after 2 s, e.g. a huge file still loading, and leaves it as far as it got. It finds
  file diffs by their DOM id and works against the Virtualizer's own fix-ups; a Pierre update can break it quietly.
- Showing a thread is a step only when it changes what the canvas shows (it drops a whole file or commit); the scroll
  to it, and a jump from a guide's table of contents to a group, aren't steps.
- Settings, Projects and New Workspace are still `screen` state, outside the history.
- Back across workspaces hasn't been tried with two workspaces open; only one was in the test data.

## 2026-09-27 — CI and releases

### What works

- **CI** (`.github/workflows/ci.yml`): typecheck, lint, format check and build on every push to `main` and every PR.
- **Releases from a button** (ADR 0024): Actions → _Release_ → _Run workflow_ with `0.2.0` bumps `package.json` on
  `main`, tags `v0.2.0`, builds macOS (arm64, x64), Windows x64 and Linux x64 with electron-builder and creates the
  GitHub release with generated notes; `0.2.0-rc.1` makes a pre-release. `pnpm dist` builds
  for the machine you're on into `dist/`.
- **Settings shows the version and commit** (_About_: `coxswain 0.1.0 · 05c8448`), set at build time.
- **A packaged app finds `gh`, `claude` and `codex`** when started from the Dock: it takes the login shell's `PATH`.
  Checked with the macOS arm64 package opened with `open`: the startup check passed and Codex's adapter started
  from inside the asar.
- The packaged app has its icon in the bundle and says _coxswain_ in the menu bar.

### Tech debt

- **Unsigned builds**: macOS needs right-click → Open (or `xattr -cr`) on first launch; Windows shows SmartScreen.
- **Windows can't find the agents yet**: `onPath` in `agents.ts` looks for `claude` and `codex` without `.exe`, and
  the native menu has no Settings entry outside macOS. Only the macOS build has been run.
- No auto-update.

## 2026-09-27 — README, license and contributing

### What works

- **The repository has a front page:** `README.md` with a screenshot (`docs/screenshot.png`, an agent review of
  honojs/hono#5201), the features, requirements and getting started; `LICENSE` (MIT) and `CONTRIBUTING.md` (issues
  first, AI-assisted PRs welcome).

## 2026-09-27 — Codex, and model and effort in the composer

### What works

- **Codex runs in the agent pane** (`@agentclientprotocol/codex-acp` 1.13.1, the user's own `codex` on `PATH`), in
  its _Approve for me_ mode, with coxswain's tools and the pane's instructions (ADR 0018, 10).
- **_New session_ is a split button** (`ButtonGroup`, shaped like shadcn's): the button starts a session on the agent picked last, its
  chevron's native menu on another, Claude Code or Codex. The one picked last is also what questions, reviews and
  guides start a session on when the workspace has none. The session keeps its agent; the
  picker names it.
- **Agent picks under the composer** (`listAgentPicks`, `setAgentPick`): the model and the effort, each a native menu
  of what the agent offers (ACP session config options), stored per agent in `settings`. Every turn of the agent's
  sessions, the pane's own, questions, reviews and guides, runs on them.
- Claude Code's _Default (recommended)_ model shows as the model it resolves to, e.g. _Opus 5.5 (default)_, named
  from the model ID the adapter sends (`modelName`, a `ponytail:` guess from the ID's shape).

### Tech debt

- The choices are the agent's latest session's. Before the agent has one, listing them opens a session in the
  worktree and closes it again (a few seconds for Claude Code). Choices are kept while the app runs; a model the agent
  adds shows after a restart.
- **Effort levels follow the model late** (`ponytail:` in `listAgentPicks`): a model picked before its first turn
  shows the old model's levels until the turn, and a stored level the model hasn't is skipped.
- Codex isn't in the startup check: a missing `codex` shows as the first turn's error.

## 2026-09-27 — Go to Definition and Find Usages

### What works

- **⌘-click a name to see where it's defined** (`findDefinitions` in `git.ts`, token callbacks in `Viewer.tsx`): in a
  file diff or a whole file, ⌘ over a token underlines it; ⌘-click shows the defining file on the canvas at that
  line, with the Navigator on _Files_. Several matches open a native menu to pick from. A relative import
  path (`"./queries"`) opens its file, trying the usual extensions and `index` files.
- **Right-click a name for _Go to Definition_ or _Find Usages_** (a native menu, `menus:token`). _Find Usages_
  (`findUsages` in `git.ts`) lists every worktree line with the name as a whole word in the same native picker as
  several definitions: the first 30, then _N more_.
- **One way to show a whole file** (`openFile` in `App.tsx`): selecting in _Files_, Open Quickly, Go to Definition and
  Find Usages all show it on the canvas with the Navigator on _Files_ and the file revealed. Fixed on the way: the
  tree's second mount effect under StrictMode reset its paths and folded the reveal away when switching to _Files_,
  and a jump within _Files_ to another file scrolled the file drawn before.
- **Find Usages always shows its menu**, even for one line (often the one clicked), and both menus say _No usages
  found_ / _No definition found_ instead of doing nothing.

### Tech debt

- Definitions are found by name with `git grep -w` and one regex for many languages, so a common name lists every
  definition of it, and methods written over several lines, C functions and destructured names aren't found. A
  language server in the core (ADR 0003) is the upgrade.
- Only the worktree is searched; a name clicked on the old side of a file diff finds its definition as it is now.
- No way back to where you clicked.
- Usages are found by name too: the same word in comments, strings and unrelated code counts. The picker is a native
  menu capped at 30; a results pane (like a search sidebar) if long lists need browsing.

## 2026-09-27 — Open Quickly

### What works

- **⌘⇧O opens any file of the workspace** (_File > Open Quickly…_ or the magnifier in the canvas bar, `OpenQuickly.tsx`): a search box over the window
  filters the worktree's files by path; Enter shows the file in the canvas and the Navigator on _Files_.
- **_Files_ follows the canvas:** the file shown there is selected in the tree, its folders opened and the row
  scrolled into view, also after the tree reloads.

### Tech debt

- Matches are unranked, the first 50 in tree order. Rank by match quality if long repositories make it noisy.

## 2026-09-27 — Agent replies stream token by token

### What works

- **The agent's text streams as it's written**, in the agent pane and in a thread, and a tool's line shows as soon as
  the tool starts. The core sends a chat entry again on every update under the same `id`; the UI replaces the entry it
  grew from (`upsert` in `ChatEntry.tsx`). A question's answer entry is still saved whole when the turn ends.
- **A message sent in the agent pane shows at once**, with the composer cleared, before the core has started the
  session's adapter (seconds for a new session). The core no longer echoes the pane's own message back to it.
- **The agent knows it's in coxswain.** Agent pane sessions append a short context to Claude Code's system prompt
  (`paneContext` in `agents.ts`, ADR 0023): a PR review app, what the comment headers mean, what the coxswain tools
  are for.

### Tech debt

- Each streamed chunk is one IPC message and a re-render of the entry's Markdown. Fine at chat speed; batch per
  animation frame if long replies stutter.

## 2026-09-27 — Shared components

### What works

- **Controls come from one place.** `src/renderer/src/components/`: `Button` (default, primary, ghost, link),
  `ToggleButton`, `SegmentedControl`, `Input`, `TextArea` (Enter submits, Esc cancels), `Screen`, `Card`,
  `ProblemCard`, `ListRow`, `Centered`, `ProgressBar`, `Splitter`, `Prose`, `ErrorText`, `ProblemMessage` and the
  icons, with the shared tokens (`muted`, `divider`, `selectable`, `titleBar`, `cn`) in `styles.ts`. `ui.tsx` is gone;
  its counting helpers are in `format.ts`.
- **Bespoke parts have their own components:** `WorkspaceRail`, `CanvasBar`, `StatusBar`, `GuideGroupHeader` and
  `GuideFileNote` out of `App.tsx`; `ThreadBox`, `DraftBox` and the composer in `Thread.tsx` out of `Viewer.tsx`; chat
  entries, `PermissionPrompt` and `TurnStatus` (shared by the agent pane and threads) in `ChatEntry.tsx` out of
  `Agents.tsx`.
- Small visual changes from unifying: the thread composer's Comment/Agent toggle is now the same segmented control as
  Diffs/Files; the guide's contents progress bar is green like the status bar's; ghost buttons all wash on hover.
  A thread's reply count now says "replies", not "replys".
- **Lint and format:** `pnpm lint` (oxlint, default rules, clean) and `pnpm format` (oxfmt, default settings). The
  whole repo, docs included, was formatted once.
- **The project icon is a menu.** Clicking L1's project icon pops a native menu of the projects, the current one
  checked; picking one switches to it, and _Add Project…_ opens the Projects screen.
- **Threads no longer widen the file diff.** A resolved thread's one-line header set the code column's width, so a
  narrow canvas (e.g. with the guide's contents shown) cut threads off on the right. Thread boxes now use
  `contain: inline-size`.
- **The UI says _Agent_, not _Claude_ or _Claude Code_**: the agent pane's empty state and composer, the review and
  comment cards, and the permission prompt.
- **No carets** on the status bar's thread toggle. The agent pane's session picker is a button (_Session N_) with a
  native menu of the sessions and their dates, in place of a `<select>`.
- **Remove a workspace**: right-click its icon in L1, _Remove Workspace…_, confirm. Its entries, reviewed files and
  agent sessions are deleted (the schema's cascade); the worktree stays, and adding the PR again adopts it.
- **One confirmation dialog** for destructive actions, native (`window.coxswain.confirm`, `dialogs:confirm`). Removing
  a workspace and deleting a thread both use it.
- **Startup check** (`core/setup.ts`): `git`, `gh` signed in and `claude` on PATH, all local so it passes offline.
  Anything missing shows the Setup screen full window, with the fix for each and the PATH looked on.

### Tech debt

- `cn` joins classes without resolving conflicts (`ponytail:` in `styles.ts`); add tailwind-merge with shadcn.
- The startup check doesn't check that `claude` is signed in (`ponytail:` in `setup.ts`); its first turn says so.

## 2026-09-27 — Cleanup: no timeline, docs as they stand

### What works

- **The timeline is gone.** The Overview wasn't reachable since the tabs went, but opening a worktree still recorded
  each PR head as a phase and spent a Claude call summarising it. Removed: `core/timeline.ts`, `Overview.tsx`,
  GitHub's PR activity (`getPullRequestActivity`), `isAncestor` and `readFileDiff` in `git.ts`, the `timeline:` and
  summary model IPC, Settings' _Change summaries_, and the `timeline` change kind. Opening a worktree now only opens it.
- **Migrations are squashed** into one that makes today's schema. A database made before is refused with a message
  saying to move it away; migration numbers in the entries below refer to the old chain.
- **Worktrees are named by PR number** (`worktrees/<owner>/<name>/pr-<number>/`), not the workspace's row ID, which
  a fresh database hands out again: a reset opened PR #1 as workspace 1 while the clone's worktree for its branch
  sat at `…/2`, and git refused (_already used by worktree_). Opening a worktree now moves one that already holds the
  branch into place, local changes and all, after pruning registrations whose folder is gone.
- **One-shot runs are gone** from `core/agents.ts`: the answer tool, and the `answer`, `tools`, `instructions`,
  `thinking`, `persist`, `model` and `mode` options. Every run is an agent pane turn, in auto mode on Claude Code's
  default model. The MCP server stays for the guide tools. `runAgentTurn` is now `runTurn`.
- Exports used only in their own file are no longer exported. Stale comments naming the Diff tab or deleted ADRs
  are fixed.
- **The docs say what holds now.** ADRs no longer keep history ([ADR 0001](adr/0001-record-architecture-decisions.md),
  AGENTS.md): 0007, 0009, 0010, 0011, 0012, 0019, 0020 and 0022 are deleted, their numbers left as gaps. 0005,
  0008, 0013, 0015, 0018, 0021 and 0023 are rewritten without what they superseded; 0014 is now _Reviewed belongs
  to a file diff's contents_. The done tickets are deleted, and tickets are deleted when done from now on. UX.md
  describes the agent-first layout (L1 project column, L2 Navigator, L3 canvas, L4 agent pane); the glossary lost
  _Viewer_, _Overview_, _Diff tab_, _Timeline_, _Phase_, _Change summary_, _Event_ and _Context_.

### Tech debt

- Older devlog entries below still describe what they built then, including what's now gone.

## 2026-09-27 — Guides made by the agent pane

### What works

- **Guides are agentic** ([ADR 0023](adr/0023-guides-made-by-the-agent-pane.md)). The agent pane's sessions get
  coxswain's MCP tools (`start_guide`, `add_group`, `add_explanation`, `add_finding`) from the local server that served
  the answer tool, at a path per workspace, allowed without asking. "Make me a guide" in the agent pane works; so do
  _Make a Guide_ and _Make a Guide with Review_ in the canvas bar's new _Guide_ menu, which put the message in
  the agent pane's composer for the user to edit and send (not sent right away, as ADR 0023 says). How to guide is in `start_guide`'s result.
- **Guides show in _Changes_:** groups in reading order with title, description and file notes, _Not in the guide_,
  generated groups last. Explanations and findings are entries (new kinds) with a `guide_id`, shown as threads only
  with their guide; a reply is a note. _Send all to agent_ leaves out the ones nobody replied to.
- **Pinned and kept:** a guide shows its range (merge base → PR head then), like a commit; stale once the PR moves
  on. Every guide stays in the _Guide_ menu. The newest shows when it appears, and on opening if not stale.
- **The old pipeline is gone:** file summaries, grouping and describing calls, the guide prompt and model, `Guide.tsx`
  and the progress plumbing. Migration 20 drops `guides` and `file_summaries` (and their data), makes a new `guides`
  table and rebuilds `entries`. The summary model moved to Settings > _Change summaries_; `ask` lives in `timeline.ts`.
- **The guide's table of contents is back** (`GuideToc.tsx`, from the old Guide tab): left of the canvas while a
  guide shows, with viewed counts per group and in all, `✎` counts, the group being read marked, and click to jump.
  `countItems` no longer makes an empty count for explanations and findings (`✎ 0`).
- **No tabs row over the canvas:** it only ever held _Changes_. The canvas's bar is now the top strip (and drags the
  window); a tabs row comes back with a second thing to show.
- **Commits is a pane, not a menu:** _Commits_ in the canvas's bar opens a list on the left, in the Navigator's
  place (one or the other), and a click picks the commit. `listCommits` replaces the `menus:commits` popup.
- **Comment/Agent toggle** replaces the comment box's _Send to agent_ checkbox, left of the send button. It's one
  global preference in `settings` (`comment.to-agent`); a reply is always a note, so reply boxes have no toggle (_Send all to agent_ sends threads afterwards).
- **Thread ⋯ menu** replaces the thread's ✕: _Edit_ (the first comment, the user's own; `editEntry`), _Delete_,
  _Send to Agent_ (`sendThread`: the latest note becomes a question and is asked like one, answer in the thread).
  `askQuestion` and `sendThread` share `ask` in the core and `asking` in the main process.
- **Resolved threads:** a ✓ left of the ⋯ menu resolves and reopens. Migration 21 adds `entries.resolved_at`, set on
  the thread's first entry (`resolveThread`). A resolved thread folds to one line, is counted and labelled in the
  bottom bar's list, and is left out of _Send all to agent_.
- **_Viewed_ is now _Reviewed_** (glossary): labels, `src/core/reviewed.ts`, `listReviewed`/`setReviewed`,
  `showReviewed`, the `reviewed:` IPC channels. Migration 22 renames `viewed_files` to `reviewed_files`. Accepted
  ADRs and older devlog entries keep the old word.
- Tried on PR #1 of the test project: the agent called every tool, and the guide, two explanations and five findings
  showed on the canvas while it worked.

### Tech debt

- The tools add to the workspace's latest guide, so two sessions making guides at once mix.
- A guide request goes to the latest agent session, like comments, not the one the picker shows.
- The Navigator keeps tree order under a guide; only the canvas and its table of contents are in reading order.
- `ponytail:` the table of contents has a fixed width; make it resizable like the Navigator if titles get cut.

## 2026-09-26 — Agent-first layout, first rough pass

### What works

- **No more tabs.** The _Overview_, _Guide_ and _Diff_ tabs are gone. Opening a PR shows the **agent pane**
  (the old L4 chat) on the left, always visible and resizable, and the **canvas** on the right (glossary). For
  now the canvas has one tab, _Changes_ (the file diffs), in a tabs row above a bar with _Files_, _Commits_ and the cog.
- **The canvas's bottom bar** sums up the review: threads (outdated, waiting on the agent), +/− lines, and files
  viewed with a progress bar. Its thread count opens a list of every thread; clicking one scrolls to it.
  _Send all to agent_ sends every thread in one message to the agent pane's session (`sendReview`), known in the
  transcript by a `[Review · N threads]` header like a comment's, and shown as a card. _Show Viewed Files_ now hides viewed file diffs on the canvas too, not only in the
  Navigator; when all are viewed it says so, with _Show them_.
- _View > Toggle Agents_ (⌥⌘B) is gone, since the agent pane is always shown.
- The agent pane's header no longer says _Claude Code_. A session picker there (_Session N · date_) shows any of the
  workspace's agent sessions, not only the latest; _New session_ next to it.
- **Comments are threads.** The comment box on lines is a send button (Enter), a _Send to agent_ checkbox and ✕ to
  cancel. Every comment starts a thread with a reply box of the same shape, so a note can be answered too. Ticked, a
  comment is a question and the agent's answer lands in the thread; unticked, a note. No schema change: `parent_id`
  already threads entries, it just wasn't used for notes. A question asked in a thread is given the thread's notes
  since its last question (and the anchor, if the thread began as a note), since the agent session never saw them.
  Note boxes and question threads are now one `ThreadBox`. The old _Send to agent_ on a note (a chip in the agent
  pane's message box, once only) is gone with its plumbing (`noteIds`, `formatAsk`'s notes); reply with the box
  ticked instead. `entries.sent_at` is no longer written or read.
- **Comments go to the agent pane** ([ADR 0021](adr/0021-comments-go-to-the-agent-pane.md)): a question is a turn
  in the workspace's current agent session, not a hidden per-round one. The agent chat shows it as a card (_Comment
  on `a.ts:3` sent to Claude_, the comment, _View thread_, which scrolls the canvas to the thread); the reply streams
  to both and is kept as the thread's answer. The card comes from a header line in the prompt, read back from the
  transcript (`withComment` in `core/agents.ts`).
- **No more review rounds** (ADR 0022): entries belong to their workspace. Rounds,
  wrap up, action items, hand-off and _Copy as prompt_ are gone from the core, IPC and UI (`Round.tsx` deleted; round
  events left the timeline and action items the change summaries). Migration 19 rebuilds `entries` with
  `workspace_id` and `agent_sessions` without `review_round_id`, and drops `action_items` and `review_rounds`; ran
  on the real database with its 17 entries kept. `ask`'s `instructions` parameter went with wrap up.

### Tech debt

- `ponytail:` the comment card is parsed from the prompt's header line; store sent comments by turn if it gets in the way.
- `ponytail:` _View thread_ stops at the file for an outdated thread, which isn't between the lines.
- The agent pane shows no _Working…_ during a comment's turn, and a comment fails if the pane's own turn is running.
- `ponytail:` every entry a workspace ever had is listed; nothing archives old ones.

## 2026-09-26 — The Overview's timeline

### What works

- **The Overview is a timeline** (ADR 0020): the PR's title, author and GitHub link,
  then its phases, newest first, each with its events, newest first too. Terms (_timeline_, _phase_, _change summary_, _event_,
  _context_) are in the glossary; the layout is in UX.md.
- **Phases** (`phases` table, migration 18): every PR head `openWorktree` reads is passed to `recordHead`, which adds
  a phase when the head is new. `base` is the previous head if the new one builds on it (`isAncestor`), else the
  merge base; the kind (_PR created_, _N new commits_, _Rebased_) is derived from it.
- **Change summaries** are made in the background right after a phase is recorded: one run on the guide's summary
  model with the phase's diff (cut like a guide's), its commits, the PR's description, earlier phases' intents and,
  for a push, the action items and GitHub reviews and comments since the previous phase. Stored as prose
  (`phases.summary`, migration 19, which drops the first try's separate `intent` and `why` columns); the prompt asks
  for the intent and the why. _Regenerate_ (or _Summarise_) makes one again.
- **`getTimeline`** puts it together on each read: phases with files, +/− lines and commits counted by git
  (`listCommits` now takes a head); every round's notes and questions (answers folded) and wrap-ups; GitHub's issue
  timeline (`getPullRequestActivity`, which replaces `getPullRequestOverview`): comments, reviews with their review
  comment count, merged, closed, reopened, ready or draft, force-pushed. Events go in the phase seen at or before
  them; a review in the phase of its commit.
- The core sends `timeline` when a phase is recorded or a summary starts or ends; entries changing also refetch it.
- Not checked in the running app yet: the user is testing it.

### Tech debt

- `ponytail:` `getTimeline` asks GitHub (the PR and up to 10 pages of its timeline) on every read, and entries
  changing reads it again. Cache the activity if the rate limit shows.
- `ponytail:` the summary's diff sizes are the guide's, copied; share them if they become settings.
- Phases are only seen while coxswain is open, so pushes made while it's closed are one phase, and the first phase
  covers everything up to the first head seen. A phase after a rebase summarises the whole PR again.
- A failed summary isn't tried again on its own until the app restarts.
- Agent sessions and hand-offs aren't on the timeline: hand-offs aren't recorded yet.
- The context (the timeline as text for agents) isn't built.

## 2026-09-26 — Every round readable, resolved when its items are done

### What works

- **Every review round is reachable** (ADR 0019,
  ticket 0001). `listRounds` replaces `getRound`: every round, oldest
  first, with its stream and action items. The Round bar steps through them with ‹ ›, the latest shown first and a
  new round showing itself. _Show round_ opens the selected round's action items and then its stream, each question
  with its follow-ups and answers. #5311's round 3, wrapped up with no action items, can be read again.
- **Done and resolved**: an action item has a _done_ checkbox (`action_items.done_at`, migration 17). A round is
  resolved once wrapped up with every item done, derived in `listRounds`, not stored. The bar says _wrapped up, N of
  M done_ or _resolved_.
- **Copy as prompt** puts the round's open action items and its stream on the clipboard (`formatHandOff`, now
  exported, written by the main process). Done items are left out of every hand-off, L4's too.
- **Wrap up takes a round id**, so an earlier round can be wrapped up again.
- _**Post to PR**_ is a disabled placeholder on the bar.

### Tech debt

- `ponytail:` `listRounds` reads every entry of a workspace on each change to entries; page it if rounds pile up.
- `ponytail:` _Post to PR_ does nothing yet.
- Wrapping up again loses which items were done.

## 2026-09-26 — Every agent run over ACP

### What works

- **Every agent run is an ACP session** ([ADR 0018](adr/0018-agents-over-acp.md),
  ticket 0004). `src/core/agents.ts` is the only place that starts an agent:
  `run(agent, options, handlers)` for a turn, `newSession` for an agent session stored before its first message,
  `history` for its transcript, `cancel` to stop a turn. L4's agent sessions, a round's questions, the three guide steps
  (`ask` in `guides.ts`) and wrap-up all call it; `runClaude`, the `claude -p` spawns, `transcriptPath`,
  `readTranscript`'s file reading and `stopGuides` are gone.
- **One adapter process** (`@agentclientprotocol/claude-agent-acp` 0.81.2, run by Electron as Node, with
  `@agentclientprotocol/sdk` 1.5.0), started on first use with `CLAUDE_CODE_EXECUTABLE` set to the `claude` on `PATH`.
  An adapter that exits is started again by the next run, which resumes its session there (checked). Quitting stops it,
  which ends every run.
- **Options are data**: the Claude record maps `tools: 'none'` to `tools: []` and `strictMcpConfig`, `instructions` to
  `systemPrompt`, `thinking: false` to `{ type: 'disabled' }`, `persist: false` to `persistSession: false`, and `mode`
  to the `auto` or `default` permission mode (`session/set_mode`). The model is set with `session/set_config_option`
  after `session/new`: the adapter prefers the user's settings over a `_meta` model. Without one, the agent's _default_
  option. Aliases (`haiku`) match an option
  by value, description or name. One-shot runs close their session after (`session/close`); otherwise their Claude
  Code processes stay.
- **Answer tool**: a localhost HTTP MCP server on a free port, a random path per run, one `answer` tool with the run's
  schema, allowed through `allowedTools`. Arguments are checked against the schema (`mismatch`); a misfit goes back to
  the agent as a tool error. The first fit ends the turn (`session/cancel`) and resolves the run.
- **Permission prompts** in L4 and in a question's thread (`PermissionPrompt` in `Agents.tsx`), with the options the
  agent sends; the pick goes back through `answerPermission`. L4 runs in auto mode, so only what the classifier would
  block asks; questions run in default mode with every tool, so edits and most commands ask. One-shot runs reject every
  request. A stopped turn or a closed window cancels a waiting prompt.
- **Chat entries from ACP updates**: streamed text is held until the next tool or the turn's end, so it arrives
  whole as before; a tool's line takes its title from the update that carries the input (`Bash git status`); a
  subagent's updates are left out. `ChatEntry` and the IPC shape are unchanged.
- The agent picks the session ID (`session/new`). Sessions made before load by their stored ID: #5311's 273-entry hand-off
  session replays in L4.
- Checked in a second instance on a copy of the database: L4 shows the old session's history; a new session runs a
  turn with a Bash call; a question gets its answer in its own session; guides and wrap-up run. In a scratch run
  against the adapter: 16 one-shot runs at once in 4.4 s, a permission request reaches the handler and its rejection
  reaches the agent, a session resumes after the adapter restarts. Not checked in the window: the permission prompt
  itself (the classifier in the session that drove the app wouldn't let it provoke one).
- **Guide timing on #5311** (279 files), same model (Opus 5.5) and summary cache, old `claude -p` → ACP: all summaries
  reused 62 s → 61 s (grouped 24 → 27 s, described 38 → 34 s); 56 files to summarise 89 s → 77 s.

### Tech debt

- **A model in the user's settings is ignored** (`ponytail:` in `openSession`): a run without a model gets the agent's
  own _default_ (Opus 5.5 here). Left to itself the adapter resolves the settings model differently from Claude Code:
  `"opus[1m]"` became Opus 4.8, which made a guide 216 s. The 1M-context variant isn't offered by the adapter.
- **An agent session never sent a message can't be resumed after a restart** (`ponytail:` on `startAgentSession`):
  its first message fails. Only happens if the first turn fails before it's sent.
- **The answer schema check is hand-written** (`ponytail:` on `mismatch`) for the keywords our schemas use.
- The adapter logs every session's phases to the main process's stderr, and the SDK warns once per answer run that
  `allowedTools` shadows `canUseTool`. Noise, not errors.
- Codex (`@zed-industries/codex-acp`) is a second agent record, not added yet.
- Paid off: "Blocked tools can't be approved" (the `ponytail:` on `runTurn`), and depending on Claude Code's
  stream-json and transcript formats.

## 2026-09-25 — Data fetching with TanStack Query

### What works

- **Every read from the core is a TanStack Query query** ([ADR 0017](adr/0017-data-fetching-with-tanstack-query.md),
  ticket 0003). `queries.ts` holds the one `QueryClient` and
  `core(name, ...args)`, which turns a preload call into query options keyed `[name, ...args]`, so the keys live in
  one place. Switching back to a workspace or tab shows the cached data at once and refreshes behind it.
- **The core says what changed.** The main process sends `changed` (`{ workspaceId, what }`) when an ask's notes are
  marked sent, when an agent turn ends (`worktree`, `transcript`), when a question gets its answer (`entries`) and when
  a guide run ends (`guide`). `changed()` in `queries.ts` maps each `what` to the queries it makes stale. UI writes (a
  note, a deleted entry, an action item edited, wrap-up) call the same `changed()`; Viewed is set in the cache at once
  and refetched if storing it fails.
- The `version` prop and the `onTurnEnd` and `onEntriesChanged` callbacks are gone, and so are the per-component
  `stale` flags and the Overview's hand-made cache.
- **GitHub data refreshes**: `openWorktree` (the PR's head), the Overview and the open PRs go stale after a minute
  and refetch when the window gains focus. Offline or signed out, `openWorktree` and the Overview keep what they
  fetched before (the query errors and keeps its data), and the Navigator says the PR couldn't be checked.
- Refetches with the same data keep the same arrays (structural sharing), so the Navigator's tree and the memoised
  Viewers don't remount or redraw.
- Checked in the app on #5311: Overview, Diff (279 files, the round bar) and Guide load; the Guide shows its groups
  two frames after switching back from Overview; Viewed toggles and survives a tab switch. Not yet checked live: an
  agent turn or a question refreshing the panes through `changed`.

### Tech debt

- UI writes are plain calls followed by `changed()`, not `useMutation`; only Viewed is optimistic. Move to
  `useMutation` where a write needs pending or error state on screen.
- The Projects screen (repository pages) and Settings still load with `useEffect`; they aren't on the paths that
  switch often.
- Queries are dropped five minutes after their pane unmounts (TanStack's default `gcTime`); raise it if switching
  back after longer flashes empty.
- Paid off: "PR data loads once per workspace and never refreshes" and "Nothing is cached; switching workspaces
  refetches everything".

## 2026-09-25 — Typed queries

### What works

- **Every query in the core goes through Kysely** ([ADR 0016](adr/0016-typed-queries-with-kysely.md),
  ticket 0002). `db.ts` has the tables' types (`Tables`) next to the
  migrations; `openDatabase` still runs the migrations on `node:sqlite`, then returns a `Kysely<Tables>` (`Db`) on
  Kysely's own SQLite dialect, through a ten-line adapter. Column lists are typed arrays with `as` aliases, so a wrong
  column or alias fails `pnpm typecheck`. The `as` casts are gone; it found one: the stream was typed as entries with
  a state they don't have.
- Queries are async now, and so are the core functions that look up a workspace's worktree (`openedWorktree`,
  `openedBefore`, `getWorkspaceRepo`). `runTurn` checks for a running turn again after its lookup.
- Wrap-up writes its action items in a Kysely transaction; `getRound` counts the rounds in the same query it reads.
- Checked on a copy of the real database: projects, workspaces, agent sessions, settings, a guide and round 3
  read the same; the hand-offs of rounds 1–3, `getRound` and `getGuide` come out identical to the code before;
  a note is added, sent by an ask and deleted; a question with a stand-in `claude` makes the round's agent session,
  stores the answer and reuses the session; a failed transaction rolls back. A second instance on the copy shows
  #5311's Overview, Guide (80 files) and Diff (279 files, 223 viewed) as before.

### Tech debt

- **`Tables` is kept in step with the migrations by hand** (ADR 0016). A migration that changes a table without
  changing `Tables` still typechecks.
- JSON columns (`guides.groups`, `action_items.entry_ids`) are `string` and parsed by hand.

## 2026-09-25 — Hand off a round to the agent

### What works

- **Send to agent** on a wrapped-up round's bar puts the round in L4's message box (_Round N · N
  action items_, ✕ to take it out). The next message is an ask whose prompt is the action items in
  order, each with its anchor and code, then the round's whole numbered stream (notes, questions,
  answers) as context, then the notes attached and the user's text (`formatHandOff` in `review.ts`;
  `formatStream` is shared with wrap-up). It goes to L4's current agent session, so it shows there.
- Checked: the prompt for #5311's round 2 (4 items, 11 entries) from a copy of the database.
- **Agent sessions run in auto mode** ([ADR 0013](adr/0013-auto-permission-mode.md)), so the
  agent can read Linear, run tests and the like when Claude Code's classifier allows it; before,
  anything that would prompt was refused, which is why a hand-off on #5311 said Linear was declined.
  Checked with `claude -p --permission-mode auto` in #5311's worktree: a Linear read and `git log`
  ran with no denials. Questions stay read-only.
- **Fixed blank space in L4**: tool lines (`⏺ Bash …`) collapsed to nothing once the chat
  overflowed (`truncate` lets a flex item shrink to zero), leaving only the gaps between them. A
  subagent's own messages no longer stream into L4, matching what the transcript shows on reload.
- **Fixed Guides piling up**: every Guide → Diff → Guide switch left the old Guide in the page, so
  the tab showed several stacked. `Round` shared the Guide's key (the workspace ID) as its sibling, so
  React never deleted the old Guide's DOM. Found by driving a second instance over the Chrome
  DevTools protocol (`--remote-debugging-port`); checked the same way after the fix: one Guide on
  Guide, none on Diff or Overview.
- **Commits in the Diff tab**: _Commits_ next to _Files_ opens a native menu of the commits from
  the merge base to HEAD (`listCommits`); picking one shows its commit diff (first parent → commit;
  `listChangedFiles` takes a `head`, and the Viewer reads the new side at it). Checked on #5311: a
  commit's 80 files match `git diff`, and the button shows. The menu itself wasn't clicked (a native
  menu can't be driven over the DevTools protocol).
- **The guide is made on request**: without a stored guide, the Guide tab shows _Create guide_
  instead of starting one on open. A guide already being made still shows its progress.
- **A guide to one commit**: _Create guide_ and _Regenerate_ first open the Commits menu, _All
  Changes_ or one commit. A commit guide is made from its commit diff (migration 13: `guides.head`,
  with `merge_base` the commit's parent; `readFileDiff` and `diffFingerprints` take a `head`), and the
  Guide tab shows it with that commit's file diffs, its header saying _Commit abc1234_ or _All
  changes_. The tab shows the latest guide of either kind. Checked with a hand-made commit guide on a
  copy of the database: the commit's 80 files, 2 in its group and 78 under _Not in the guide_.
- Dropdown buttons have no ▾.
- **Guides are pinned to the PR head** ([ADR 0014](adr/0014-reviewed-follows-file-diff-contents.md)): a new
  guide to all changes covers the merge base → the PR head (migration 14: `guides.kind`, and `head`
  set for both kinds) and reads its file diffs there, so an agent's local edits don't show in it.
  When the PR head moves on, an amber bar says the guide is stale, with _Regenerate_. **Viewed
  belongs to file diff contents**: in a pinned guide it's read at the guide's head
  (`diffFingerprints`, one `git cat-file --batch`), in the Diff tab from the worktree; `viewed_files`
  keeps a row per fingerprint. File summaries use the same fingerprint. Checked on a copy of the
  database with #5311: a guide pinned at the head before the agent's commit shows 297 of 297 viewed
  and the stale bar; the live Diff tab shows 223 of 279; a guide at the new head would start at 223.
  Guides from before keep showing the live diff.
- **Entries record where they were written, and go outdated**
  ([ADR 0015](adr/0015-entries-pinned-and-outdated.md)). Migration 15: `entries.base`/`head` and
  `review_rounds.merge_base`/`head`. `listEntries` takes the view's range and gives each entry a
  state: current (its lines still read as its code), outdated, or wrapped-up. Only current entries
  show between the lines and in the ✎ counts; a file diff's header opens its _N outdated_. A
  wrapped-up round's entries leave the views; the Round bar still counts them. Prompts say "as at
  commit abc1234" for entries made on a pinned range.

### Tech debt

- **A hand-off isn't recorded** (`ponytail:` on `formatHandOff`): the items don't know they were
  sent, and the button offers it again. Add `handed_off_at` when it matters.
- **All items or none**: no picking single items; delete the others in the draft first.
- **Notes on a commit diff** keep the commit's line numbers but say "as in the worktree then", and
  _Viewed_ in a commit diff marks the file viewed for all changes (`ponytail:` on the Viewer's
  `head`). Anchor entries to the commit if that misleads.
- **A wrapped-up round with no action items can't be read again** (ADR 0015 hides wrapped-up rounds):
  ticket 0001.
- **Guide and Diff tab can disagree** on a file with local changes: viewed in one, not the other
  (ADR 0014). Local changes get no guide or "changes since" yet.
- **Guides from before pinning** have no head and keep the old live behaviour until regenerated.
- **Old viewed rows stay** (`ponytail:` in `viewed.ts`).
- **Commit guides don't expire** (`ponytail:` on `getGuide`): one stays even if a rebase drops its
  commit from the PR.
- **Summaries are cached per file**, not per diff, so guides to a commit and to all changes evict
  each other's summaries and re-summarise those files (Haiku calls) when they alternate.
- **A merge commit's diff** is against its first parent, so it shows everything merged in.
- **Blocked tools can't be approved** (`ponytail:` on `runTurn`): what auto mode blocks stays
  blocked until L4 shows permission prompts. Planned: every agent run over ACP
  ([ADR 0018](adr/0018-agents-over-acp.md), ticket 0004).
- **No data cache in the UI**: panes refetch on every switch and reread through `version` counters.
  Planned: TanStack Query with `changed` events from the core
  ([ADR 0017](adr/0017-data-fetching-with-tanstack-query.md),
  ticket 0003).
- **The whole stream goes along**, answers in full. Fine for a round; trim if long rounds crowd the
  prompt.

## 2026-09-25 — App icon

### What works

- coxswain has an icon: a racing shell seen from above, oars out, with the cox in amber at the stern.
  The source is `resources/icon.svg`, rendered to `resources/icon.png` with
  `swift scripts/render-icon.swift resources/icon.svg resources/icon.png`.
- The main process sets it as the Dock icon on macOS and as the window icon on Windows and Linux.

### Tech debt

- **The icon is set at runtime** (`ponytail:` in `src/main/index.ts`), because there's no packaging
  yet. The menu bar still says _Electron_, and the Dock shows Electron's icon for a moment at launch.
  Build an `.icns` into the app bundle when we package.

## 2026-09-25 — Review rounds

### What works

Not checked in the app yet: the user tests it.

- **Review rounds of entries replace local comments** (ADR 0011).
  Glossary first: _note_, _question_, _answer_, _thread_, _anchor_, _review round_; _comment_ now
  means GitHub only; _local comment_, _imported comment_, _import_ and _publish_ are gone (_post_
  replaces publish).
- Migration 11: `review_rounds` and `entries` (kind, body, `parent_id`, optional anchor); old comments
  and the agent sessions asked from them are dropped; `agent_sessions` rebuilt with
  `review_round_id` in place of `comment_id`. Checked from a copy of a version 10 database.
- `src/core/comments.ts` is now `src/core/review.ts`. The gutter box says _Note_ where it said
  _Comment_.
- **Questions share one agent session per round**, so a question knows the earlier ones. They run
  read-only (`--permission-mode default`, so edits are refused), and the reply is saved as an answer
  entry when the turn ends. Follow-ups are questions in the same thread.
- **Counts of notes and questions** (`✎ N`, hover for how many of each) on changed files in the
  Navigator, tree and list, and on groups in the Guide's table of contents (`countItems` in `ui.tsx`).
  A question's follow-ups and answers don't count; the thread does.
- **Wrap up** (ADR 0012): a bar at the bottom of _Guide_ and
  _Diff_ shows the round (_Round N_, its notes and questions) and _Wrap up_, which sends the round's
  numbered stream to one `claude -p` with a schema and no tools (`runClaude`, now exported from
  `guides.ts`) and stores the action items it drafts (migration 12: `action_items`,
  `review_rounds.ended_at`). The draft opens above the bar to edit or delete items. Wrapping up ends
  the round; the next entry starts another. On #5311's test round it took 15 s and made one anchored
  item from a question and its answer, leaving out a note with nothing to change.
- `runTurn` takes a finished prompt; formatting an ask's notes moved to the main process
  (`formatAsk`), so `agents.ts` no longer depends on the review code.

### Tech debt

- **Rounds don't go stale** (`ponytail:` in `review.ts`): a round isn't tied to the commit or guide it
  reviewed, so new changes don't end it; only wrapping up does (glossary open question 3).
- **Only the latest round is reachable**: once a new round starts, the last one's entries and action
  items leave the UI (`ponytail:` on `ReviewRound`).
- **The wrap-up prompt is fixed** and uses Claude Code's default model, not in Settings like the
  guide's. No _Stop_ while it runs.
- **Hand-off isn't built**: action items can't be implemented or posted yet. (Paid off for agents in _Hand off a round to the agent_.)
- **Questions run one at a time per round**: a second while one runs gets _A turn is already running_.
  Queue them if it gets in the way.
- **Tool calls in a thread show only while streaming**; an answer keeps only the agent's text, and a
  stopped or failed turn leaves no answer.
- **Only changed files show counts** in the Navigator: in _Files_, a note on an unchanged file (made
  from a whole file) has no row decoration.
- No UI yet for a round's whole stream, floating entries, action items or GitHub comments (UX open
  question 3).

## 2026-09-25 — Faster guides

### What works

Not checked in the app yet: the user runs the first guide with it.

- **Guides made in one-turn calls** (ADR 0010). #5311 took ~6½ minutes,
  mostly summary agents taking ~20 turns to read diffs themselves. Now coxswain puts each file diff in
  the prompt (`readFileDiff`, cut to 300 lines) and every `claude -p` runs with no tools and a short
  system prompt of its own in place of Claude Code's.
- **Summaries are cached** in `file_summaries` (migration 10) by file diff fingerprint, so
  _Regenerate_ and a PR that moved on only summarise changed files. Every file is summarised now,
  small PRs too, in batches of at most 25 files or 1200 lines, 16 at once.
- **Grouping answers with file numbers**, not paths, and no descriptions; files it leaves out go in
  _Other changes_.
- **Groups are described in parallel after grouping**, each with a description and a _file note_ per
  file diff (glossary), shown above the file diff. The guide shows as soon as it's grouped, groups
  read _Describing…_ until theirs arrives, and the top counts the groups described.
- **How long a guide took** is stored (`started_at`, `finished_at`, migration 9) and shown at the top
  of the tab; the main process logs each phase's seconds and how many summaries were reused.
- The default guide prompt now asks for file notes too; Settings says what each model does.
- **First run on #5311: 3 min 31 s** (was ~6 min 25 s), on screen after 1 min 47 s: summaries ~70 s,
  grouping 30 s, 20 groups described in ~1 min 40 s (one took 99 s). Every file got a note.
- **Summaries run without thinking** (`MAX_THINKING_TOKENS=0`): Haiku spent about as many tokens
  thinking as answering. Grouping and describing keep it.
- **Fixed: switching workspace on the Guide tab made a stray guide** for the new workspace from the old one's
  merge base (the first render after a switch still held the old PR data), running 16 `claude` processes
  in the background over a diff of 1000+ files. `usePullRequest` now only returns data for the current
  workspace.
- **Notes don't mention file numbers**: one said "file 106"; the prompts now say to name files by path.
- **Guide tags**: grouping may tag a group _generated_ (glossary); the default prompt asks for
  lockfiles, generated clients, snapshots and build output to go in such groups. They're sorted last
  (in the core, and in the tab after _Not in the guide_) and low-lighted. Old guides have no tags.
- **Scrolling file diffs no longer freezes** (Diff and Guide tabs): `@pierre/diffs` highlighted each
  file diff on the main thread as it scrolled into range. It now runs in the library's worker pool
  (`WorkerPoolContextProvider` in `main.tsx`, ES module workers in `electron.vite.config.ts`).
- **Long lines wrap** in file diffs and files, instead of scrolling sideways (`overflow: 'wrap'` in
  `Viewer.tsx`; the library's virtualizer measures wrapped lines).
- **View options in the tab's bar**: on _Guide_ and _Diff_, a cog opens a native menu with _Unified_
  or _Split_ file diffs and _Show Viewed Files_. That setting moved there from the Navigator's cog
  menu and the Guide's _Show viewed_ button, so the two now share it. It resets on restart
  (`ponytail:` in `App.tsx`), like the Navigator's settings.
- **Guide text renders as Markdown**: group titles (inline), descriptions and file notes, with one
  readable style for descriptions and notes and more space between groups. The Markdown setup is
  shared as `Prose` in `ui.tsx`, also used by the Overview and agent replies.

### Tech debt

- Paid off: summaries weren't cached.
- **Batch sizes, cut-offs and parallelism are fixed guesses** (`ponytail:` in `guides.ts`): 300 lines
  per diff, 25 files or 1200 lines per batch, 3000 lines per group, 16 calls at once.
- Paid off: rules for generated files, now the _generated_ guide tag. A saved custom guide prompt
  doesn't get the new sentence; the schema's description of the tag still tells the agent.
- **An unfinished guide** (the app quit while describing) stays so until regenerated.
- **The progress bar's split** between summarising and grouping (50/50) and its pace are new guesses.
- **Placeholder heights of file diffs not yet loaded are guesses** (20 px a changed line, capped at
  200 lines), so the page shifts a little when one loads.

## 2026-09-24 — Guide

### What works

- **The Guide tab** (ADR 0009). The first time it opens
  it shows a progress bar while `createGuide` asks Claude Code (`claude -p` with a
  JSON schema). No diff goes in the prompt: agents get the file list and read diffs themselves with
  `git diff` (read-only tools, no MCP servers). A big PR is cut into batches of files, summarised by
  up to eight agents at once on the summary model (`haiku`), then one agent groups the summaries. The guide's groups show one after another: title, a short
  description of what to look at, then the group's file diffs, the same Viewer as in _Diff_
  (comments, _Ask agent_, Viewed). A group's _Viewed_ checkbox marks all its file diffs. Viewed file
  diffs and fully viewed groups are hidden, with _Show viewed_ to bring them back. A table of
  contents on the left lists the groups with their viewed counts and a bar for the whole guide,
  follows the scroll, and jumps to a group on click. Its width is fixed (`ponytail:` in `Guide.tsx`). Files the guide doesn't mention show last under _Not in the guide_. _Regenerate_ makes
  a new one. Leaving the tab while it's being made and coming back waits for the same run.
- **Guides are stored** (`guides`, migration 7) with the merge base and the model that made them,
  shown at the top of the tab. Checked in the app: #5284 got five groups from
  `claude-opus-5-5[1m]`, and showed again at once after a restart.
- **Settings > Guide**: the guide prompt (with _Reset_), the model (empty is Claude Code's
  default) and the summary model, stored in a new `settings` table (migration 8).
- **Stacked file diffs read their files only when scrolled near the screen**, in both _Diff_ and
  _Guide_. Before, a big PR (#5311, 297 files) started ~600 `git` processes at once and every other
  call, like switching tabs or workspaces, queued behind them.
- The agents are told to run `git diff --no-ext-diff`, since one repo's `.gitattributes` sends CSV to
  `daff`, which isn't always installed. A first version put the patch in the prompt and failed on it.

### Tech debt

- **Groups are whole file diffs**, not hunks (UX open question 2).
- **Summaries aren't cached**, and batch sizes and parallelism are fixed (`ponytail:` in
  `guides.ts`): _Regenerate_ summarises everything again. Cache by `diffFingerprint` when that hurts.
- **The progress bar is approximate**: the core reports batches summarised and when grouping
  starts (`guides:progress`); between those the bar creeps on at a guessed pace (`Guide.tsx`), and
  the split between summarising and grouping (60/40) is a guess from one PR.
- **A guide from another merge base is hidden, not marked outdated**, and files changed since
  only show under _Not in the guide_.
- **Two app instances make two guides**: runs are shared per process only.
- **A file diff still loading shows its path at a guessed height**, so scrolling to a file can land a
  bit off until the ones above it have loaded (the old `ponytail:` in `App.tsx`, now smaller).

## 2026-09-24 — Viewer tabs

### What works

- **Tabs in L3:** _Overview_, _Guide_ and _Diff_. A workspace opens on _Overview_: the PR's title
  and its description as Markdown (`getPullRequestOverview`). Cached in memory per workspace, so the
  tab shows at once and refreshes in the background.
  _Guide_ says "Coming soon". _Diff_ shows every changed file's diff one after another in one
  scroll, with the Navigator on its left, shown with the _Files N_ toggle in the tab's bar; picking a changed file there scrolls to
  it, and a file picked in _Files_ shows in place of the file diffs. The Diff tab stays mounted
  while another tab shows, so the file diffs and Navigator keep their state. A second bar under the tabs is there for each tab's options, empty so far.
- **The Navigator and L4 start hidden**; ⌘B (_View > Toggle Navigator_) toggles the Navigator too.
  L4's button moved from its header to the right of each tab's bar, as an _Agent_ toggle like _Files_.

### Tech debt

- **Switching tabs or panes was slow**: every click re-diffed and redrew every file diff, since the
  Viewers re-rendered with new file objects and `@pierre/diffs` redraws on each render. Paid off: the
  Viewer is memoised with stable props, and the Diff tab uses the library's `Virtualizer`, which
  draws only the lines on screen. Still, **every changed file is read from disk up front**
  (`ponytail:` in `App.tsx`); read them as they scroll into view if big PRs load slowly.
- **Scrolling to a file diff can land short** while file diffs above it are still loading
  (`ponytail:` in `App.tsx`).

## 2026-09-24 — Local comments and asks

Comments on code, handed to the agent: the first version of the main selling point (G4) from inside
coxswain, before importing any GitHub comments.

### What works

- **Commenting.** In the Viewer, the gutter `+` (from `@pierre/diffs`) starts a comment on one line,
  or on a range by dragging it. Works on both sides of a diff and on whole files. ⌘Enter saves, Esc
  cancels.
- **Local comments are stored** (`comments` table, migration 4) with path, side (`old` = merge base,
  `new` = worktree), line range, the code as it was, and the text. They show inline and survive
  restarts. They can be deleted.
- **Asks.** _Send to agent_ puts a comment in the L4 message box as a chip; several can be collected.
  On send, the core puts each comment in front of the message (file, lines, side, the code in a
  fence, the comment) and marks them sent; they then show _Sent to agent_ inline.
- **Agent replies render as Markdown** in L4 (`react-markdown` + `remark-gfm`: lists, tables,
  code, links). Links open in the browser; the app window never navigates.
- **Ask agent from a comment.** The comment box has _Ask agent_ (⇧⌘Enter): it saves the comment
  and starts an agent session tied to it (`agent_sessions.comment_id`, migration 6), with the
  comment as the first turn. Replies stream into the comment's thread in the Viewer, and the user
  can answer there. L4 leaves these sessions out. The Viewer now keeps showing the file while it
  rereads after a turn, instead of flashing _Loading…_. Checked in the app: an ask and a follow-up.
- **Viewed files.** A _Viewed_ checkbox in a file diff's header; the Navigator hides viewed files, says
  "N of M viewed", and has a cog button with a native menu: _Show Viewed Files_ (then shown with a
  ✓), and _As Tree_ / _As List_ for the changed files. Stored per workspace (`viewed_files`, migration 5) with a fingerprint of the
  file diff (merge base + worktree file), so a file becomes unviewed when an agent or new PR commits
  change it. Checked in the app on #5284.
- **The Agents pane can be hidden**: a button in its header, _View > Toggle Agents_ (⌥⌘B), and a
  button in L3's top bar to show it again. It stays mounted while hidden, so a running turn keeps
  going and still reloads the diff. _Send to agent_ shows it.
- **Resizable panes.** Drag the border between L2 and L3, or L3 and L4, to resize. L3 takes the
  rest.
- Checked in the app on a private repo #5291: comment on lines 3–5, send with an instruction,
  the agent read the file and answered about those lines.

### Tech debt

- **Viewed isn't synced with GitHub's** _Viewed_ checkbox; it's local only, and also covers local
  changes, which GitHub doesn't see.
- **The ✓ in the Navigator is redrawn by resetting the rows' git status** (`ponytail:` in
  `Navigator.tsx`), since `@pierre/trees` has no call to refresh decorations.
- **The Navigator's cog settings reset** per workspace and on restart (`ponytail:` in
  `Navigator.tsx`), like the pane widths.
- **The list is a tree without folders:** `@pierre/trees` has no list mode, so rows are named after
  the file and the folder goes in the row decoration. Two files with the same name show their whole
  path instead. A long file name squeezes out its folder and can clip the +/− lines.
- **Whether the Agents pane is shown resets on restart**, like the pane widths.
- **A thread may show an entry twice** if it mounts while its turn runs (transcript + stream;
  `ponytail:` in `Viewer.tsx`).
- **Pane widths reset on restart** (`ponytail:` in `App.tsx`); persist them once there's a settings
  table.
- **Comments drift.** They're anchored by line numbers only, so an agent's edits move them off their
  lines; the stored code snippet keeps the ask right, the inline position doesn't. Outdated tracking
  is glossary open question 2 (`ponytail:` in `comments.ts`).
- A range dragged across both sides of a diff is taken as the side it ends on (`ponytail:` in
  `Viewer.tsx`).
- Comments can't be edited, only deleted, and deleting doesn't ask first.
- **No way to see pending comments or send them in bulk.** Comments not yet sent are only visible
  inline in the file they're on, and each one has to be added to the message box by hand; there's no
  list of a workspace's unsent comments and no "send all" ([UX](UX.md) open question 3).
- No threads, no resolving.
- Asks are sent as one plain-text prompt; the chat shows it in full.
- Code blocks in agent replies aren't syntax-highlighted (`ponytail:` in `Agents.tsx`); user
  messages stay plain text.

## 2026-09-24 — Clones and PR worktrees

Each project now has its own clone and each workspace a PR worktree, per
[ADR 0008](adr/0008-clones-and-pr-worktrees.md). Agent sessions work in the worktree and may edit
files there, and _Diffs_ shows what they changed. That's the first full loop for G4: ask the agent,
see its diff. G1 is ticked.

### What works

- **Clone on add.** Making a project current starts a blobless clone into
  `~/coxswain/repos/<owner>/<name>/` in the background; the project icon pulses meanwhile. Clones
  are written to `<name>.cloning` and renamed when done.
- **PR worktree on open.** Opening a workspace fetches the PR's head branch and creates
  `~/coxswain/worktrees/<owner>/<name>/<workspace id>/` on a local branch tracking it. Later opens
  fast-forward it when the PR moved and nothing is changed locally; otherwise the Navigator says so.
- **Switching is local.** A worktree opened before shows at once (150–400 ms, measured) from what the
  core remembers; the GitHub check and fetch (~2.5 s) run in the background and only redraw if the PR
  moved. Offline, the worktree still shows, with a notice.
- **Navigator and Viewer read the worktree.** _Diffs_ is `git diff <merge base>` against the
  worktree plus untracked files (renames detected); _Files_ is `git ls-files`; the Viewer's old side
  is `git show <merge base>:<path>`, its new side the file on disk. Both reload after every agent
  turn.
- **Agents edit files** in their worktree (`--permission-mode acceptEdits`). Checked in the app: a
  33-second first open of a private repo #5284, then an agent-written file showed up in _Diffs_
  next to the PR's 12 files.
- The core resolves every path and ref itself from workspace and project IDs; file paths from the
  UI can't leave the worktree, and commits must be full SHAs.

### Tech debt

Paid off from the proof of concept: per-file GitHub API reads for trees and files, GitHub's
truncated trees and 3000-file limit on _Diffs_, the missing clone and worktree paths, and the empty
agent folder.

- **PR and local changes look the same** in _Diffs_ ([UX](UX.md) open question 5).
- **Fork PRs** show an error; they need a fork remote (`ponytail:` in `git.ts`).
- **No cleanup.** Worktrees, their branches and clones stay on disk forever; removing workspaces and
  projects isn't built.
- **No undo** for agent edits beyond git itself; no commit or push from coxswain yet.
- The remembered head and merge base live in memory, so the first open of each workspace after a
  restart still waits ~2.5 s (`ponytail:` in `git.ts`).
- Reloads only happen on workspace open and after agent turns; edits made outside coxswain show on
  the next turn or reopen. A file watcher would fix it.
- The opened file keeps the status it had when opened; if a turn deletes it, the Viewer shows it
  empty rather than deleted.
- A PR whose head branch is the repository's default branch can't get a worktree, because the clone
  itself has that branch checked out.
- HTTPS clones rely on `gh auth setup-git` (or another credential helper); without one they fail
  with git's message. `git` and `gh` are found through `PATH`.
- `parseChanges` was checked against a real repository (renames, binary, deletes, untracked) with a
  throwaway script; still no test setup in the repo.

## 2026-09-24 — First agent sessions: chat with Claude Code

L4 is now a chat with a local Claude Code, per ADR 0007. It
proves the loop of sending a turn, streaming the reply and resuming later. The agent can't see the
PR's code yet, because there is still no clone.

### What works

- **Chat in L4.** Type a message, press Enter; the agent's text and each tool it uses (one line,
  e.g. `⏺ Bash pwd`) appear as they arrive. _Stop_ kills a running turn.
- **Agent sessions per workspace.** The first message creates one (`agent_sessions` table, migration
  3). _New session_ starts another with the next message. Switching workspaces shows that
  workspace's latest agent session.
- **Resume after restart.** The transcript is read back from Claude Code's own
  `~/.claude/projects/*/<session ID>.jsonl`, and the next turn resumes with `--resume`.
- **Running turns are killed** when the app quits.

### How it's put together

| Where                         | What                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/agents.ts`          | Agent sessions in SQLite, `runTurn` (spawns `claude -p … --output-format stream-json`), `readTranscript`, `stopTurn`. One parser for stream and transcript lines. |
| `src/main/index.ts`           | `agents:*` handlers; chat entries go to the window as `agents:entry` events.                                                                                      |
| `src/renderer/src/Agents.tsx` | The L4 chat pane.                                                                                                                                                 |

### Tech debt

- **The worktree is an empty folder** until cloning lands (paid off in the entry above).
- **No tool approval.** Print mode refuses tools that need permission, so the agent can't run most
  commands (file edits were allowed in the entry above). Next step: `--permission-prompt-tool` or the
  Agent SDK (ADR 0007).
- Only the latest agent session per workspace is shown; earlier ones stay in the database
  (`ponytail:` in `Agents.tsx`, UX open question 4).
- Tool results aren't shown, only the call; replies are plain text, not Markdown (`ponytail:` in
  `agents.ts`, `Agents.tsx`).
- No partial streaming (`--include-partial-messages`): text appears a message block at a time.
- A turn keeps running if you switch workspaces, but coming back doesn't show it as running, and its
  entries arriving meanwhile are only visible after reopening.
- `claude` is found through `PATH`, like `gh`.
- The `agents.ts` logic is checked by a throwaway script (two real turns, resume, transcript), not a
  committed test; still no test setup in the repo.

## 2026-09-24 — Proof of concept

The first vertical slice: open a GitHub repository, pick one of its PRs, and read its diffs and
files. It proves the stack from ADRs 0002–0006 works together. Nothing talks to an agent yet, and
nothing is cloned.

### Running it

```sh
pnpm install     # also downloads the Electron binary (see debt)
pnpm dev         # run with hot reload
pnpm start       # build and run the built app
pnpm typecheck
```

GitHub features need the GitHub CLI signed in (`gh auth login`), per
[ADR 0006](adr/0006-github-integration.md).

### What works

- **Onboarding.** With no project, a full-window screen links to Settings and to choosing a first
  project.
- **Settings** (⌘,). Shows the GitHub account `gh` is signed in as, or what to do if `gh` is
  missing or signed out.
- **Projects.** The project icon at the top of L1 opens the list of projects and the user's GitHub
  repositories (paged, searchable). Picking a repository adds it as a project and makes it current.
- **Workspaces.** `+` under the project icon lists the repository's open PRs; picking one adds a
  workspace. Workspace icons sit in L1 in the order they were added, the current one marked.
- **Navigator** (L2). A _Diffs / Files_ toggle: the PR's changed files as a tree with status and
  +/− lines, or the whole tree at the PR's head with changed folders marked.
- **Viewer** (L3). Selecting a file in _Diffs_ shows its file diff side by side (merge base vs head,
  as GitHub shows it); selecting one in _Files_ shows the whole file.
- **Storage.** Projects and workspaces persist in SQLite, with migrations from the start.

L4 (agents) is an empty placeholder (since filled; see the entry above).

### How it's put together

| Where                  | What                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/`            | The UI-free core ([ADR 0002](adr/0002-standalone-electron-app.md)): `github.ts` (Octokit, token from `gh`), `db.ts` (SQLite and migrations), `projects.ts`, `workspaces.ts`.       |
| `src/main/index.ts`    | Electron main process: window, native menu, and one `ipcMain.handle` per core function.                                                                                            |
| `src/preload/index.ts` | The single typed interface the UI uses to reach the core (`window.coxswain`).                                                                                                      |
| `src/renderer/src/`    | React UI. `App.tsx` holds the screen state; one file per screen or pane (`Navigator`, `Viewer`, `Projects`, `NewWorkspace`, `Settings`, `Onboarding`); `ui.tsx` has shared pieces. |

Stack: Electron 44, electron-vite 5, React 19, TypeScript 7, Tailwind 4, `@pierre/trees` and
`@pierre/diffs` (pinned exactly), `@octokit/core`, `node:sqlite` (built into Electron's Node 24, so
no native module).

### Tech debt

Deliberate shortcuts for the PoC, grouped by what will force them. Items marked `ponytail:` in the
code are found with `grep -rn "ponytail:" src`.

**No local clone yet** — the biggest gap, and next to go.

- Every file tree and file content is read from the GitHub API, one request per file opened
  (`src/core/github.ts`). Slow, rate-limited (5000 requests/hour), and it can't show local changes.
- GitHub truncates very large trees, and lists at most 3000 changed files per PR.
- Projects have no `repo_path` and workspaces no `worktree_path` (`projects.ts`, `workspaces.ts`).
  Cloning into `~/coxswain/repos/…` and worktrees into `~/coxswain/worktrees/…` (ADRs 0005, 0006)
  replaces the API reads above.
- Local repositories can't be added yet; detecting a GitHub remote (ADR 0006) isn't built.

**GitHub**

- Signing in depends on `gh`; native OAuth is the long-term plan (ADR 0006).
- `gh` is found through `PATH` (a packaged app takes the login shell's, ADR 0024).
- Open PRs: only the first 100 are listed.
- Repository search only filters the pages already loaded.
- No ETags (ADR 0006, decision 7): GitHub data refetches in full after a minute, on window focus (ADR 0017).

**Data and state**

- Projects and workspaces can't be removed, and closed or merged PRs keep their workspace.
- UI state isn't stored (ADR 0005 plans for it): the Diffs/Files toggle, the open file and pane sizes
  reset on restart.
- The core runs inside the main process and SQLite calls are synchronous. Fine at this size; move it
  to a utility process if the main process ever stutters.
- IPC handlers don't validate their arguments; they trust the renderer.

**UI**

- shadcn/ui isn't set up (ADR 0004); `src/renderer/src/components/` holds our own controls until it is.
- Keyboard shortcuts cover Settings, Open Quickly, the command palette (⌘K), Toggle Navigator, Back, Forward and
  Rebuild and Reload (⇧⌘R, `pnpm start` only);
  the rest are reached through ⌘K.
- ADR 0004's system accent colour, reduced motion and high contrast aren't wired up.
- The native menu is laid out for macOS only.
- Panes have fixed widths; no resizing.
- The Viewer shows one file at a time; tabs are an open question in [UX](UX.md).
- No React error boundary; a failed core call can leave a pane blank.
- The renderer bundle isn't split; Shiki's grammars all ship in it.

**Tooling**

- Tests are one `node --test` file (`pnpm test`); no linter or formatter config.
- No signing or auto-update (ADR 0024).
- electron-vite 5 doesn't know Electron 44 downloads its binary lazily, so `postinstall` runs
  `install-electron`. Remove it once electron-vite catches up.
- electron-vite 5 holds Vite at 7.
- `@pierre/trees` is a beta and `@pierre/diffs` is young (ADR 0003); both are pinned and need
  deliberate upgrades.

**Docs**

- [ADR 0005](adr/0005-local-data-storage.md) still says _session_ for what the glossary now calls a
  _workspace_. Accepted ADRs aren't edited; a later ADR touching storage should use the new term.
