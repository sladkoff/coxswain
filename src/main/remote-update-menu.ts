import type { MenuItemConstructorOptions } from "electron";

// The native top menu returns intentions; the renderer invokes the same core writes as other entry points.
export function remoteUpdateMenu(options: {
  workspace: boolean;
  automatic: boolean;
  busy: boolean;
  onAutomatic: (enabled: boolean) => void;
  onManual: () => void;
}): MenuItemConstructorOptions[] {
  return [
    {
      label: "Auto-update from Remote",
      type: "checkbox",
      checked: options.automatic,
      enabled: options.workspace && !options.busy,
      click: () => options.onAutomatic(!options.automatic),
    },
    ...(options.workspace && !options.automatic
      ? [
          {
            label: options.busy ? "Updating from Remote…" : "Update from Remote",
            enabled: !options.busy,
            click: options.onManual,
          },
        ]
      : []),
  ];
}
