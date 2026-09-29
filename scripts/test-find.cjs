// Run after pnpm build: pnpm exec electron scripts/test-find.cjs
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const temp = mkdtempSync(join(tmpdir(), "coxswain-find-"));
app.setPath("userData", temp);
app.commandLine.appendSwitch("disable-gpu");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
const js = (code) => window.webContents.executeJavaScript(code, true);
async function until(code, label) {
  for (let i = 0; i < 100; i++) {
    if (await js(code)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${label}`);
}
const action = (id) => js(`fixture.action(${JSON.stringify(id)})`);
const query = (value) =>
  js(
    `(() => {const input = document.querySelector('input[aria-label="Find text"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true}));})()`,
  );
const currentText = () =>
  js("[...(CSS.highlights.get('find-current') ?? [])].map(r => r.toString())");
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      width: 1440,
      height: 950,
      show: true,
      webPreferences: {
        preload: join(__dirname, "fixtures/find.cjs"),
        contextIsolation: false,
        sandbox: false,
      },
    });
    const errors = [];
    window.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) {
        errors.push(message);
        console.error(message);
      }
    });
    await window.loadFile(join(__dirname, "../out/renderer/index.html"));
    await until(
      "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')",
      "diff ready",
    );
    await action("find");
    await until("!!document.querySelector('[aria-label=\"Find in canvas\"]')", "file Find bar");
    await query("needle");
    await until(
      "document.querySelector('[role=search]')?.textContent.includes('1 of 5')",
      "five matches across both diffs",
    );
    assert.deepEqual(await currentText(), ["needle"]);
    await action("find-previous");
    await until(
      "document.querySelector('[role=search]')?.textContent.includes('5 of 5') && CSS.highlights.get('find-current')?.size === 1",
      "result in another file",
    );
    assert.equal(
      await js("document.querySelector('[role=search]').textContent.includes('other.ts')"),
      true,
      "Find crosses files",
    );
    await action("find-previous");
    await until(
      "document.querySelector('[role=search]')?.textContent.includes('4 of 5') && CSS.highlights.get('find-current')?.size === 1",
      "distant result in the first file",
    );
    assert.equal(
      await js(
        "[...CSS.highlights.get('find-current')][0].startContainer.parentElement.closest('[data-line]').dataset.line",
      ),
      "1400",
    );
    assert.equal(
      await js(
        "(() => {const r = [...CSS.highlights.get('find-current')][0].getBoundingClientRect();return r.top > 0 && r.bottom < innerHeight})()",
      ),
      true,
      "distant match is visible",
    );
    await action("find-previous");
    await until(
      "CSS.highlights.get('find-current')?.size === 1 && [...CSS.highlights.get('find-current')][0].startContainer.parentElement.closest('[data-line]').dataset.lineType === 'change-deletion'",
      "old-side result",
    );
    console.log("PASS canvas-wide matches, cross-file wrap, distant old/new results");
    await query("shared context");
    await until(
      "document.querySelector('[role=search]')?.textContent.includes('1 of 1')",
      "context counted once",
    );
    await action("diff-split");
    await until(
      "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-additions]')",
      "split layout",
    );
    await query("needle");
    await until(
      "document.querySelector('[role=search]')?.textContent.includes('1 of 5')",
      "split search ready",
    );
    await action("find-previous");
    await until(
      "document.querySelector('[role=search]')?.textContent.includes('5 of 5')",
      "split last file",
    );
    await action("find-previous");
    await until(
      "CSS.highlights.get('find-current')?.size === 1 && [...CSS.highlights.get('find-current')][0].startContainer.parentElement.closest('[data-line]').dataset.line === '1400'",
      "split distant result",
    );
    console.log("PASS split layout and shared context");
    await js("document.querySelector('textarea').focus()");
    await action("find");
    await until(
      "!!document.querySelector('[aria-label=\"Find in conversation\"]')",
      "chat Find bar",
    );
    await query("needle");
    await until(
      "document.querySelector('[role=search]')?.textContent.includes('1 of 4')",
      "chat matches",
    );
    assert.deepEqual(await currentText(), ["needle"]);
    const top = await js("document.querySelector('[data-find-entry]').parentElement.scrollTop");
    await js("fixture.chat('Streaming more text')");
    await pause(250);
    assert.equal(
      await js("document.querySelector('[data-find-entry]').parentElement.scrollTop"),
      top,
      "streaming preserves search scroll",
    );
    await action("find-previous");
    await until(
      "!!document.querySelector('[data-find-revealed] .line-clamp-6')",
      "clipped card expanded",
    );
    assert.deepEqual(await currentText(), ["needle"]);
    await js(
      "document.querySelector('[aria-label=\"Find text\"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))",
    );
    assert.equal(
      await js("document.activeElement === document.querySelector('textarea')"),
      true,
      "Escape restores composer focus",
    );
    assert.equal(await js("CSS.highlights.has('find-current')"), false);
    console.log("PASS chat matches, streaming, clipped cards and Escape");
    await action("find");
    await action("workspace:2");
    await until("!document.querySelector('[role=search]')", "workspace clears Find");
    assert.deepEqual(errors, [], "no renderer errors");
    if (process.env.COXSWAIN_TEST_SCREENSHOT)
      writeFileSync(
        process.env.COXSWAIN_TEST_SCREENSHOT,
        (await window.webContents.capturePage()).toPNG(),
      );
  })
  .then(
    () => app.exit(0),
    async (error) => {
      console.error(error);
      if (window) console.error(await js("document.body.innerText"));
      app.exit(1);
    },
  );
app.on("quit", () => rmSync(temp, { recursive: true, force: true }));
