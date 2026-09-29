import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { LanguageServer } from "./index.ts";

// TypeScript and JavaScript: TypeScript 7's own server, the native `tsc` in the typescript package's per-platform
// package. A packaged app runs it from outside the asar, where it's unpacked.
export const typescript: LanguageServer = {
  name: "TypeScript",
  languageIds: {
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascriptreact",
  },
  dependencies: ["node_modules"],
  start: async () => {
    const platform = `@typescript/typescript-${process.platform}-${process.arch}/package.json`;
    const require = createRequire(import.meta.url);
    const pkg = require.resolve(platform, {
      paths: [dirname(require.resolve("typescript/package.json"))],
    });
    const exe = join(dirname(pkg), "lib", process.platform === "win32" ? "tsc.exe" : "tsc");
    return {
      command: exe.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked"),
      args: ["--lsp", "--stdio"],
    };
  },
};
