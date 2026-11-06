// Run after pnpm build: pnpm exec electron scripts/check-other-thread.cjs
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const temp = mkdtempSync(join(tmpdir(), "coxswain-other-thread-"));
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
const nav = 'nav[aria-label="Guide sections, files and threads"]';
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      width: 1440,
      height: 950,
      show: true,
      webPreferences: {
        preload: join(__dirname, "fixtures/other-thread.cjs"),
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error(event.message);
    });
    await window.loadFile(join(__dirname, "../out/renderer/index.html"));
    if (process.env.COXSWAIN_TEST_NO_GUIDE) {
      await until(
        `!!document.querySelector(${JSON.stringify(nav)})?.textContent.includes('Historical thread')`,
        "workspace threads without a saved Guide",
      );
      await js(
        `[...document.querySelectorAll(${JSON.stringify(nav + " button")})].find(button=>button.textContent.includes('Historical thread')).click()`,
      );
      await until(
        `!!document.querySelector('[data-retained-canvas]:not([aria-hidden="true"]) [id="thread:31"]')`,
        "historical conversation without a Guide",
      );
      assert.ok(
        await js(
          `document.querySelector(${JSON.stringify(nav)}).textContent.includes('Historical thread')`,
        ),
      );
      console.log("PASS workspaces without a saved Guide retain Other threads");
      return;
    }
    await until(
      `document.querySelector(${JSON.stringify(nav)})?.querySelectorAll('[data-guide-section]').length === 2`,
      "initial Guide sections",
    );
    await until(
      `!!document.querySelector(${JSON.stringify(nav)})?.textContent.includes('Other threads')`,
      "Other threads",
    );
    await js(
      `[...document.querySelectorAll(${JSON.stringify(nav + " button")})].find(button=>button.textContent.includes('Historical thread')).click()`,
    );
    await until(
      `!!document.querySelector('[data-retained-canvas]:not([aria-hidden="true"]) [id="thread:31"]')`,
      "historical conversation",
    );
    assert.equal(
      await js(
        `document.querySelector(${JSON.stringify(nav)})?.querySelectorAll('[data-guide-section]').length`,
      ),
      2,
      "opening an Other thread must retain the workspace Guide sections",
    );
    console.log("PASS Other thread opens its recorded range while retaining Guide sections");
    const reads = await js("fixture.reads");
    assert.ok(reads.some(([, sha, path]) => sha === "old-base" && path === "old-only.ts"));
    assert.ok(reads.some(([, sha, path]) => sha === "old-head" && path === "old-only.ts"));
    await js(
      `document.querySelector(${JSON.stringify(nav + ' [data-guide-section="1"] input[type="checkbox"]')}).click()`,
    );
    const writes = await js("fixture.reviewed");
    assert.deepEqual(
      writes[0].slice(0, 5),
      [1, "base", "a.ts", true, "head-1"],
      "Guide review controls use the current Guide, not the thread range",
    );
    console.log("PASS Guide review controls retain their own revision");
    await js(
      `document.querySelector(${JSON.stringify(nav + ' [data-sidebar-file="a.ts"] [data-sidebar-nav="open"]')}).click()`,
    );
    const active = '[data-retained-canvas]:not([aria-hidden="true"])';
    await until(
      `!!document.querySelector('${active} [id="view-section-1"] [id="diff:a.ts"]')`,
      "Guide file after historical thread",
    );
    await js("fixture.action('back')");
    await until(
      `!!document.querySelector('${active} [id="thread:31"]')`,
      "history returns to recorded thread",
    );
    assert.equal(
      await js(
        `document.querySelector(${JSON.stringify(nav)})?.querySelectorAll('[data-guide-section]').length`,
      ),
      2,
    );
    await js(
      `document.querySelector(${JSON.stringify(nav + ' [data-guide-section="0"] [data-sidebar-nav="open"]')}).click()`,
    );
    await until(
      `!!document.querySelector('${active} [id="view-section-0"]')`,
      "Guide section after historical thread",
    );
    console.log(
      "PASS Guide file/section picks and Back navigate between Guide and historical thread",
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
