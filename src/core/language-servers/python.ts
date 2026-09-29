import { downloaded, type Release } from "./download.ts";
import type { LanguageServer } from "./index.ts";

// Python: pyrefly, Meta's type checker, a native binary fetched from its GitHub release on first use. It finds the
// project's environment itself (a `.venv` or `venv` in the checkout, else the Python on PATH), and bundles stubs for
// common packages. Without the venv, a repository's own packages resolve only where they import without installing.
// ponytail: glibc builds only on Linux; the musl ones if Alpine users show up.
const url = (asset: string) =>
  `https://github.com/facebook/pyrefly/releases/download/1.3.2/${asset}`;
const pyrefly: Release = {
  name: "pyrefly",
  version: "1.3.2",
  exe: process.platform === "win32" ? "pyrefly.exe" : "pyrefly",
  archives: {
    "darwin-arm64": {
      url: url("pyrefly-macos-arm64.tar.gz"),
      sha256: "7c0b2109a00ccca83e22daa3724d4a091a1b673823175004eb449ba88ab2adb7",
    },
    "darwin-x64": {
      url: url("pyrefly-macos-x86_64.tar.gz"),
      sha256: "5ceb539168b2cd681d032f6e2b6d95571fd92e6cad70d11acd9284660d56e88e",
    },
    "linux-arm64": {
      url: url("pyrefly-linux-arm64.tar.gz"),
      sha256: "bf55cbd7a9869a761aa613e1d2f17772e587cbd1fa62a85454fe57b041615842",
    },
    "linux-x64": {
      url: url("pyrefly-linux-x86_64.tar.gz"),
      sha256: "27453347a83535113a77ea7bda5116f18049216621dbd6f9523aa47c86e9a2e2",
    },
    "win32-arm64": {
      url: url("pyrefly-windows-arm64.zip"),
      sha256: "46e7a5eeef2eb4a11e88aebff2a49f5d45f31250221bcef1ef1b9cba08513bb1",
    },
    "win32-x64": {
      url: url("pyrefly-windows-x86_64.zip"),
      sha256: "3f23b1807033aff34c96f65ead4958d1493fbcbb087cc5ba3ab3ce9ebbd95911",
    },
  },
};

export const python: LanguageServer = {
  name: "Python",
  languageIds: { ".py": "python", ".pyi": "python" },
  dependencies: [".venv", "venv"],
  start: async () => ({ command: await downloaded(pyrefly), args: ["lsp"] }),
};
