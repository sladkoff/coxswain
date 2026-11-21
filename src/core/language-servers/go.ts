import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { LanguageServer } from "./index.ts";

// Go: gopls, the Go team's server, as installed on the machine rather than fetched: it runs the `go` command, so Go has
// to be installed anyway, and gopls should be one built for that Go. Found on PATH (a packaged app takes the login
// shell's, src/main/index.ts), else where `go install` puts it. It finds each file's module itself, the nearest go.mod,
// so a module in a subfolder works; the module cache stands in for dependency folders.
export const go: LanguageServer = {
  name: "Go",
  languageIds: { ".go": "go" },
  dependencies: [],
  start: async () => ({ command: await gopls(), args: ["serve"] }),
};

const exe = process.platform === "win32" ? "gopls.exe" : "gopls";
const install = "go install golang.org/x/tools/gopls@latest";

async function gopls(): Promise<string> {
  const onPath = (process.env.PATH ?? "")
    .split(delimiter)
    .map((dir) => join(dir, exe))
    .find(existsSync);
  if (onPath) return onPath;
  let env: string;
  try {
    ({ stdout: env } = await promisify(execFile)("go", ["env", "GOBIN", "GOPATH"]));
  } catch {
    throw new Error("Go (go) is not installed or not on PATH; gopls needs it");
  }
  const [gobin = "", gopath = ""] = env.split(/\r?\n/);
  const found = [gobin, ...gopath.split(delimiter).map((dir) => dir && join(dir, "bin"))]
    .filter(Boolean)
    .map((dir) => join(dir, exe))
    .find(existsSync);
  if (!found) throw new Error(`gopls is not installed; install it with \`${install}\``);
  return found;
}
