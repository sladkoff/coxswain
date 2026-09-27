import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { QueryClientProvider } from "@tanstack/react-query";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { queryClient } from "./queries";

// Diffs and files are highlighted in workers: on the main thread, each file diff that loaded froze scrolling.
// useTokenTransformer: the workers wrap each token in its own span, which Go to Definition's token events need.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffsWorker() }}
      highlighterOptions={{ preferredHighlighter: "shiki-js", useTokenTransformer: true }}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WorkerPoolContextProvider>
  </StrictMode>,
);
