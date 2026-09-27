import { execFileSync } from "node:child_process";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { version } from "./package.json";

// The commit this build is from, shown in Settings with the version. CI sets GITHUB_SHA; locally ask git.
const commit = (
  process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
).slice(0, 7);

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()],
    define: { __VERSION__: JSON.stringify(version), __COMMIT__: JSON.stringify(commit) },
    // The @pierre/diffs highlighting worker loads its grammars lazily, which needs ES module workers.
    worker: { format: "es" },
  },
});
