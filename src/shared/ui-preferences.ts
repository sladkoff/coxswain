export type GuideOptions = {
  showResolved: boolean;
  onlyFilesWithThreads: boolean;
  showAgentThreads: boolean;
  showComments: boolean;
  hiddenAuthors: string[];
  shownAuthors: string[];
};
export type GuideDescriptionPosition = "beside" | "above";
export type ViewSettings = {
  diffStyle: "unified" | "split";
  showReviewed: boolean;
  layout: "tree" | "list";
};

export const defaultUiPreferences = {
  leftWidth: 336,
  agentsWidth: 416,
  paneOpen: true,
  history: "commits" as "commits" | "turns",
  historyOpen: false,
  groupChanges: true,
  guideDescriptionPosition: "beside" as GuideDescriptionPosition,
  historyHeight: null as number | null,
  guideOptions: {
    showResolved: true,
    onlyFilesWithThreads: false,
    showAgentThreads: true,
    showComments: true,
    hiddenAuthors: [],
    shownAuthors: [],
  } as GuideOptions,
  viewSettings: { diffStyle: "unified", showReviewed: true, layout: "tree" } as ViewSettings,
};
export type UiPreferences = typeof defaultUiPreferences;
