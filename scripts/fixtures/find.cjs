// Real renderer, deterministic long diffs and chat; no user data or agent processes.
require("./flickering.cjs");
const before =
  Array.from(
    { length: 1600 },
    (_, i) => `const old_${i} = "${i === 9 || i === 1399 ? "needle" : "before"}";`,
  ).join("\n") + "\nshared context\n";
const after = before.replaceAll("old_", "new_").replaceAll("before", "after");
window.coxswain.listViews = async () => [];
window.coxswain.listReviewed = async () => [];
window.coxswain.listEntries = async () => [];
window.coxswain.listChangedFiles = async () => ({
  status: "ok",
  files: [
    { path: "long.ts", status: "modified", additions: 1600, deletions: 1600 },
    { path: "other.ts", status: "added", additions: 1, deletions: 0 },
  ],
});
window.coxswain.readFileAt = async (_id, sha, path) => ({
  status: "ok",
  binary: false,
  text: path === "other.ts" ? "needle elsewhere\n" : sha === "base" ? before : after,
});
window.coxswain.readWorktreeFile = async (_id, path) => ({
  status: "ok",
  binary: false,
  text: path === "other.ts" ? "needle elsewhere\n" : after,
});
window.coxswain.listWorktreeFiles = async () => ({ status: "ok", paths: ["long.ts", "other.ts"] });
window.coxswain.agentAttachmentCapabilities = async () => ({ image: true });
window.fixture.chat = (extra = "") =>
  window.fixture.update("session-1", {
    entries: [
      { kind: "user", text: "Chat needle start" },
      {
        kind: "text",
        text:
          "A **needle** across formatting.\n\n" +
          "Paragraph to fill the chat.\n\n".repeat(100) +
          extra,
      },
      { kind: "tool", text: "Tool needle" },
      {
        kind: "user",
        text: "",
        comment: {
          threadId: 1,
          where: "long.ts:10",
          body: "Card text\n".repeat(20) + "hidden needle",
        },
      },
    ],
    running: !!extra,
  });
window.fixture.chat();
window.coxswain.onSummaryJobs = () => () => {};
window.coxswain.listSummaryJobs = async () => [];
window.coxswain.getSummarySettings = async () => ({ agent: "codex", model: "", ahead: false });
window.coxswain.listPrompts = async () => [];
