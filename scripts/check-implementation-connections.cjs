// Run after pnpm build: pnpm exec electron scripts/check-implementation-connections.cjs
// Exercises the real Settings UI with a synthetic connection; never invokes a provider.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const temp = mkdtempSync(join(tmpdir(), "coxswain-connections-ui-"));
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
const panel = '[id="settings-Connections"]';
const click = (label) =>
  js(
    `[...document.querySelectorAll(${JSON.stringify(panel + " button")})].find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`,
  );
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      width: 1200,
      height: 850,
      show: true,
      webPreferences: {
        preload: join(__dirname, "fixtures/implementation-connections.cjs"),
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    const errors = [];
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    await window.loadFile(join(__dirname, "../out/renderer/index.html"));
    await until("document.body.innerText.includes('workspace-1')", "workspace");
    await js("fixture.action('settings')");
    await until("!!document.querySelector('nav[aria-label=\"Settings sections\"]')", "Settings");
    await js(
      "[...document.querySelectorAll('nav[aria-label=\"Settings sections\"] button')].find(button=>button.textContent==='Connections').click()",
    );
    await until(
      `document.querySelector(${JSON.stringify(panel)}).innerText.includes('Not connected')`,
      "disconnected state",
    );
    await js("fixture.failConnection=true");
    await click("Connect");
    await until(
      `document.querySelector(${JSON.stringify(panel)}).innerText.includes('Sign in to the implementation tool')`,
      "connection failure",
    );
    assert.ok(
      await js(
        `document.querySelector(${JSON.stringify(panel)}).innerText.includes('Not connected')`,
      ),
    );
    await js("fixture.failConnection=false");
    await click("Connect");
    await until(
      `document.querySelector(${JSON.stringify(panel)}).innerText.includes('Connected ·')`,
      "connected state from settings event",
    );
    if (process.env.COXSWAIN_TEST_SCREENSHOT)
      writeFileSync(
        process.env.COXSWAIN_TEST_SCREENSHOT,
        (await window.webContents.capturePage()).toPNG(),
      );
    await click("Disconnect");
    await until(
      `document.querySelector(${JSON.stringify(panel)}).innerText.includes('Not connected')`,
      "disconnect state from settings event",
    );
    assert.deepEqual(errors, [], "no renderer errors");
    console.log(
      "PASS Settings connection failure, connect and disconnect without manual query invalidation",
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
