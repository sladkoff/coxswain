// Run after pnpm build: pnpm exec electron scripts/test-flickering.cjs
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const temp = mkdtempSync(join(tmpdir(), "coxswain-ui-"));
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
const click = (title) => js(`document.querySelector('[title=${JSON.stringify(title)}]').click()`);
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      width: 1440,
      height: 950,
      show: true,
      webPreferences: {
        preload: join(__dirname, "fixtures/flickering.cjs"),
        contextIsolation: false,
        sandbox: false,
      },
    });
    const errors = [];
    window.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    await window.loadFile(join(__dirname, "../out/renderer/index.html"));
    await until("!!document.querySelector('.mermaid svg')", "initial diagram");
    await js(`window.diagram = document.querySelector('.mermaid svg'); window.flashes = 0;
    window.observer = new MutationObserver(() => {
      if (document.querySelector('.mermaid')?.textContent.includes('Drawing the diagram')) flashes++;
    }); observer.observe(document.getElementById('root'), {childList:true, subtree:true});`);
    for (let i = 0; i < 3; i++) {
      await action("command-palette");
      await until("!!document.querySelector('input[placeholder^=\"Open a file\"]')", "palette");
      await js(
        "document.querySelector('input[placeholder^=\"Open a file\"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))",
      );
    }
    assert.equal(
      await js("diagram === document.querySelector('.mermaid svg')"),
      true,
      "palette retains SVG identity",
    );
    assert.equal(await js("flashes"), 0, "palette never replaces diagram with a placeholder");
    await js("observer.disconnect()");
    console.log("PASS palette retains diagram");

    await js(`window.liveFlashes = 0; window.liveObserver = new MutationObserver(() => {
    if (document.getElementById('diff:live-only.ts')) liveFlashes++;
  }); liveObserver.observe(document.getElementById('root'), {childList:true, subtree:true});`);
    await js("document.querySelector('.mermaid').closest('.overflow-auto').scrollTop = 300");
    await pause(80);
    await action("workspace:2");
    await until(
      "document.body.innerText.includes('Diagram 2') && !!document.querySelector('.mermaid svg')",
      "cold workspace",
    );
    assert.equal(await js("liveFlashes"), 0, "cold switch never presents temporary live diff");
    await action("workspace:1");
    await until("document.body.innerText.includes('Diagram 1')", "return to remembered view");
    await until(
      "Math.abs(document.querySelector('.mermaid').closest('.overflow-auto').scrollTop - 300) < 2",
      "workspace scroll restored",
    );
    await action("back");
    await until("document.body.innerText.includes('Diagram 2')", "Back across workspaces");
    await action("forward");
    await until("document.body.innerText.includes('Diagram 1')", "Forward across workspaces");
    await js("liveObserver.disconnect()");
    console.log("PASS workspace selection and history");

    await js(`const textarea = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Continue fixture');
    textarea.dispatchEvent(new Event('input', {bubbles:true}));`);
    await click("Send (Enter; Shift+Enter for a new line)");
    await until("document.body.innerText.includes('Streaming before switch')", "turn starts");
    await action("workspace:2");
    await until("document.body.innerText.includes('Earlier answer 2')", "other session");
    await js(`fixture.update('session-1', {entries: [
    {kind:'user',text:'Earlier question 1'}, {kind:'text',text:'Earlier answer 1'},
    {kind:'user',text:'Continue fixture'}, {id:10,kind:'text',text:'Streaming while hidden'}
  ]}); fixture.permission();`);
    await action("workspace:1");
    await until(
      "document.body.innerText.includes('Streaming while hidden') && document.body.innerText.includes('Fixture permission')",
      "reattached running turn",
    );
    assert.equal(
      await js(
        "document.body.innerText.includes('Earlier answer 1') && !!document.querySelector('[title=\"Stop the turn\"]')",
      ),
      true,
    );
    await js(
      "[...document.querySelectorAll('button')].find(b => b.textContent === 'Allow fixture').click()",
    );
    await until("!document.body.innerText.includes('Fixture permission')", "permission answered");
    await action("workspace:2");
    await js("fixture.finish()");
    await action("workspace:1");
    await until(
      "document.body.innerText.includes('Streaming while hidden') && !document.querySelector('[title=\"Stop the turn\"]')",
      "turn completed while hidden",
    );
    console.log("PASS session survives switching, permissions and completion");

    assert.equal(
      await js("!!document.getElementById('diff:a.ts')"),
      false,
      "reviewed file starts hidden",
    );
    await click("Show the threads");
    await js(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Navigate to this reviewed comment')).click()",
    );
    await until("!!document.getElementById('thread:1')", "reviewed thread revealed");
    assert.equal(
      await js("document.body.innerText.includes('1/1 reviewed')"),
      true,
      "reviewed mark retained",
    );
    await js("fixture.outdated()");
    await until("document.body.innerText.includes('Outdated ·')", "outdated thread opened");
    console.log("PASS reviewed and outdated comment navigation");
    await js(`const composer = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(composer, 'Unsent draft');
      composer.dispatchEvent(new Event('input', {bubbles:true}));`);
    await action("workspace:2");
    await until("document.querySelector('textarea')?.value === ''", "separate draft");
    await action("workspace:1");
    await until("document.querySelector('textarea')?.value === 'Unsent draft'", "remembered draft");
    await js("document.querySelector('[aria-label=\"New session\"]').click()");
    await click("Send (Enter; Shift+Enter for a new line)");
    await action("workspace:2");
    await pause(400);
    await action("workspace:1");
    await until(
      "document.body.innerText.includes('Session 3') && document.body.innerText.includes('Streaming before switch')",
      "session created while hidden",
    );
    assert.equal(
      await js("document.body.innerText.includes('Unsent draft')"),
      true,
      "first prompt preserved",
    );
    await click("Stop the turn");
    await until("!document.querySelector('[title=\"Stop the turn\"]')", "stop after reattachment");
    console.log("PASS drafts and session creation while hidden");

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
