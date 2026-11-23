import { resolvedAppearance } from "../../shared/appearance";
import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { core, queryClient } from "./queries";
import { router } from "./router";
import { codeAdditionStyles, codeThemes } from "./components/code-theme";
import { FileTypeIcons } from "./components/FileTypeIcon";
import { uiMetrics } from "./components/styles";

for (const [name, value] of Object.entries(uiMetrics))
  document.documentElement.style.setProperty(`--ui-${name}`, `${value}px`);

// The core owns the saved choice; its settings event updates this query in every window.
function AppearanceSync() {
  const appearance = useQuery(core("getAppearance")).data;
  const codeTheme = useQuery(core("getCodeTheme")).data;
  const softDark = useQuery(core("getSoftDark")).data;
  const dark = useSyncExternalStore(
    (listener) => {
      const media = matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const worker = useWorkerPool();
  useEffect(() => {
    if (codeTheme)
      void worker?.setRenderOptions({ theme: codeThemes(codeTheme) }).catch(console.error);
  }, [worker, codeTheme]);
  useEffect(() => {
    let current = true;
    if (codeTheme)
      void codeAdditionStyles(codeTheme)
        .then((styles) => {
          if (current)
            for (const [key, value] of Object.entries(styles))
              document.documentElement.style.setProperty(key, value);
        })
        .catch(console.error);
    return () => {
      current = false;
    };
  }, [codeTheme]);
  useLayoutEffect(() => {
    if (appearance && softDark !== undefined)
      document.documentElement.dataset.appearance = resolvedAppearance(appearance, softDark, dark);
  }, [appearance, softDark, dark]);
  return null;
}

// Diffs and files are highlighted in workers: on the main thread, each file diff that loaded froze scrolling.
// useTokenTransformer: the workers wrap each token in its own span, which Go to Definition's token events need.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffsWorker() }}
      highlighterOptions={{ preferredHighlighter: "shiki-js", useTokenTransformer: true }}
    >
      <QueryClientProvider client={queryClient}>
        <FileTypeIcons />
        <AppearanceSync />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </WorkerPoolContextProvider>
  </StrictMode>,
);
