import { execFileSync } from "node:child_process";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { version } from "./package.json";

// The commit this build is from, shown in Settings with the version.
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();

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
