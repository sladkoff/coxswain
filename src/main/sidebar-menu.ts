import type { MenuItemConstructorOptions } from "electron";
import type { GuideOptions } from "../preload";
import { guideAuthorVisible, type GuideAuthor } from "../shared/guide-authors.ts";

export function sidebarFilterItems(
  options: GuideOptions,
  authors: GuideAuthor[],
  onPick: (options: GuideOptions) => void,
): MenuItemConstructorOptions[] {
  options = {
    ...options,
    hiddenAuthors: options.hiddenAuthors ?? [],
    shownAuthors: options.shownAuthors ?? [],
  };
  const toggles: {
    key: keyof Omit<GuideOptions, "hiddenAuthors" | "shownAuthors">;
    label: string;
  }[] = [
    { key: "onlyFilesWithThreads", label: "Only Files with Threads" },
    { key: "showResolved", label: "Hide Resolved Threads" },
    { key: "showAgentThreads", label: "Agent Threads" },
    { key: "showComments", label: "Comments" },
  ];
  return [
    ...toggles.map(({ key, label }) => ({
      label,
      type: "checkbox" as const,
      checked: key === "showResolved" ? !options[key] : options[key],
      click: () => onPick({ ...options, [key]: !options[key] }),
    })),
    { type: "separator" },
    {
      label: "Authors",
      enabled: authors.length > 0,
      submenu: [
        {
          label: "Show All Authors",
          click: () =>
            onPick({
              ...options,
              hiddenAuthors: [],
              shownAuthors: authors.map((author) => author.name),
            }),
        },
        { type: "separator" },
        ...authors.map((author) => ({
          label: author.name,
          type: "checkbox" as const,
          checked: guideAuthorVisible(author, options),
          click: () => {
            const visible = guideAuthorVisible(author, options);
            onPick({
              ...options,
              hiddenAuthors: visible
                ? [...options.hiddenAuthors, author.name]
                : options.hiddenAuthors.filter((name) => name !== author.name),
              shownAuthors: visible
                ? options.shownAuthors.filter((name) => name !== author.name)
                : [...options.shownAuthors, author.name],
            });
          },
        })),
      ],
    },
  ];
}
