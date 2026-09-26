import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()],
    // The @pierre/diffs highlighting worker loads its grammars lazily, which needs ES module workers.
    worker: { format: "es" },
  },
});
