// Run after pnpm build: pnpm exec electron scripts/check-remote-update.cjs
// Uses synthetic preload responses; never fetches or changes a real repository.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const temp = mkdtempSync(join(tmpdir(), "coxswain-remote-menu-"));
app.setPath("userData", temp);
let window;
const js = (code) => window.webContents.executeJavaScript(code, true);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(code, label) {
  for (let i = 0; i < 120; i++) {
    if (await js(code)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${label}`);
}
const menu = (choice) =>
  js(
    `fixture.nextMenu=${JSON.stringify(choice)}; document.querySelector('[title="Settings"]').click()`,
  );
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      width: 1440,
      height: 950,
      show: true,
      webPreferences: {
        preload: join(__dirname, "fixtures/remote-update.cjs"),
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    await window.loadFile(join(__dirname, "../out/renderer/index.html"));
    await until(
      "document.body.innerText.includes('workspace-1') && !!document.querySelector('[title=\"Settings\"]')",
      "workspace",
    );
    await menu({ kind: "update-remote" });
    await until("fixture.remoteCalls===1", "manual update action");
    await menu({ kind: "update-remote" });
    await until("fixture.lastMenu[4]===true", "pending feedback sent to native menu");
    assert.equal(await js("fixture.remoteCalls"), 1, "busy manual updates cannot be picked twice");
    await js("fixture.finishRemote(false)");
    await pause(50);
    await menu({ kind: "dismissed" });
    await until("fixture.lastMenu[4]===false", "pending feedback clears");
    assert.equal(
      await js("coxswain.getAutoUpdate(1)"),
      false,
      "manual update leaves automatic mode off",
    );
    await menu({ kind: "update-remote" });
    await until("fixture.remoteCalls===2", "second manual action");
    await js("fixture.finishRemote(true)");
    await until("fixture.errors.length===1", "failed update reports native error");
    assert.match((await js("fixture.errors[0]")).detail, /Local edits/);
    await menu({ kind: "auto-update", enabled: true });
    await until("fixture.automaticCalls.length===1", "native toggle uses shared preload operation");
    assert.deepEqual(await js("fixture.automaticCalls[0]"), { id: 1, enabled: true });
    console.log(
      "PASS manual menu action, pending state, duplicate protection, errors and shared automatic toggle",
    );
  })
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
app.on("quit", () => rmSync(temp, { recursive: true, force: true }));
