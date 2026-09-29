# 32. Agent attachments over ACP

Date: 2026-09-29

## Status

Accepted

## Context

The agent pane needs images and files from the native picker, drag-and-drop and paste (#20; G3, G5).
ACP accepts image, resource and resource-link blocks, but adapter history loses original file names and previews:
Codex replays images as text links, and both adapters flatten embedded text. The agent still owns the transcript.

## Decision

- The core reads and classifies files. Electron supplies native file paths; the preload supplies bytes for clipboard
  files without paths. The renderer handles presentation and input events only.
- PNG, JPEG, GIF and WebP images use ACP `image` blocks; UTF-8 text up to 1 MB uses `resource` (or plain text if the
  agent does not advertise embedded context). Other files use `resource_link` to their original absolute path.
  Binary resource blobs are not portable across our adapters. Referenced files must remain accessible to the agent.
- Keep initialization's `promptCapabilities` and reject image attachments when unsupported. Bound each message to
  ten files and 20 MB total, with images up to 5 MB. Images and text capture the contents when attached.
- A SQLite `agent_attachments` record stores the sent bundle's original names, image data, embedded text and file
  references. It belongs to an agent session and is removed by cascading deletion. A leading `[Attachments · UUID]`
  line in the text prompt links the agent-owned history to this record, like the existing view/comment headers.
  Replay uses the leading message text and restores previews from the bundle instead of showing the adapter's
  appended resource text or image links. No transcript is copied into coxswain.
- Streamed chat entries carry small attachment references. Image previews are fetched separately through IPC and cached
  by the UI, so every reply token does not copy the original files again.
- Unsent attachments are workspace presentation state for the window's lifetime. A failed send retains the draft.
  The renderer allows data images in its image CSP for captured previews; script policy is unchanged.

## Alternatives considered

- Rely only on ACP replay: loses original names and thumbnails across adapters.
- Store copied files beside the worktree: adds unrelated files to git and requires separate cleanup.
- Send every file as a binary resource: Claude ignores blobs and Codex turns non-image blobs into base64 text.
- Copy whole transcripts: duplicates agent-owned state and is unnecessary for attachment previews.

## Consequences

The two agents share one attachment flow. Preview data increases database size; the per-message
limits bound each addition. Other file types depend on the agent's tools and filesystem permissions. A failed prompt
can leave an unreferenced bundle until session removal; a future cleanup can collect it. As with view/comment cards,
history restoration depends on the adapter preserving the leading text block and its header.
