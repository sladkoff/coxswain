import type { CoxswainApi } from "../../preload";

declare global {
  interface Window {
    coxswain: CoxswainApi;
  }
}
