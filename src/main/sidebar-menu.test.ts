import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultUiPreferences } from "../shared/ui-preferences.ts";
import { sidebarFilterItems } from "./sidebar-menu.ts";

test("sidebar filters leave reviewed-file visibility to the global top-bar setting", () => {
  const items = sidebarFilterItems(defaultUiPreferences.guideOptions, [], () => {});
  assert.deepEqual(
    items.filter((item) => item.type === "checkbox").map((item) => item.label),
    ["Only Files with Threads", "Hide Resolved Threads", "Agent Threads", "Comments"],
  );
});
