import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteUpdateMenu } from "./remote-update-menu.ts";

test("top menu offers one-shot remote updates only when automatic updates are off", () => {
  const picked: unknown[] = [];
  const options = {
    workspace: true,
    automatic: false,
    busy: false,
    onAutomatic: (enabled: boolean) => picked.push(enabled),
    onManual: () => picked.push("manual"),
  };
  const menu = remoteUpdateMenu(options);
  assert.equal(menu[1].label, "Update from Remote");
  (menu[0].click as () => void)();
  (menu[1].click as () => void)();
  assert.deepEqual(picked, [true, "manual"]);
  assert.equal(remoteUpdateMenu({ ...options, automatic: true }).length, 1);
  const busy = remoteUpdateMenu({ ...options, busy: true });
  assert.equal(busy[1].label, "Updating from Remote…");
  assert.equal(busy[1].enabled, false);
  const empty = remoteUpdateMenu({ ...options, workspace: false });
  assert.equal(empty.length, 1);
  assert.equal(empty[0].enabled, false);
});
