import type { CoxswainApi } from "../../preload";

declare global {
  interface Window {
    coxswain: CoxswainApi;
  }
  // Set at build time in electron.vite.config.ts.
  const __VERSION__: string;
  const __COMMIT__: string;
}
