import { createContext, useContext } from "react";
import type { Project } from "../../core/projects";

// ADR 0041: how the UI names the current project's forge and its PRs: GitHub's PR #12, GitLab's MR !12.
export type ForgeNames = NonNullable<Project["names"]>;
export const ForgeNamesContext = createContext<ForgeNames | null>(null);

// Only what shows for a project on a forge asks; elsewhere the names are neutral.
const neutral: ForgeNames = {
  forge: "the forge",
  pr: "PR",
  request: "pull request",
  sign: "#",
  cli: "",
};
export const useForgeNames = () => useContext(ForgeNamesContext) ?? neutral;
// null for a project on no forge.
export const useProjectForge = () => useContext(ForgeNamesContext);

// "pull request" → "Pull Request", for titles and buttons.
export const titled = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
