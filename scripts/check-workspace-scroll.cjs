// Run after pnpm build: pnpm exec electron scripts/check-workspace-scroll.cjs
// The real renderer, router and Pierre components, with synthetic preload data only.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const temp = mkdtempSync(join(tmpdir(), "coxswain-workspace-scroll-"));
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
const action = (id) => js(`fixture.action(${JSON.stringify(id)})`);
const file = '[data-sidebar-file="a.ts"] [data-sidebar-nav="open"]';
const canvas = '[data-retained-canvas]:not([aria-hidden="true"]) .review-canvas';
const scroller = `${canvas} > .overflow-auto`;
async function returnToReadingPosition(surface) {
  await js(`(()=>{document.querySelector(${JSON.stringify(canvas)}).dispatchEvent(new WheelEvent('wheel', {bubbles:true}));
    window.readingScroller = document.querySelector(${JSON.stringify(scroller)});
    const file = readingScroller.querySelector('[id="diff:a.ts"]');
    readingScroller.scrollTop += file.getBoundingClientRect().top - readingScroller.getBoundingClientRect().top + 1800;})()`);
  await pause(250);
  const before = await js("readingScroller.scrollTop");
  assert.ok(before >= 1800, "fixture reads deep into the long inline conversation");
  await action("workspace:2");
  await until(
    "document.querySelector('[aria-selected=\"true\"]')?.textContent.includes('workspace-2')",
    "other workspace",
  );
  await action("workspace:1");
  await until(
    `!!document.querySelector(${JSON.stringify(scroller)})?.querySelector('[id="thread:1"]')`,
    "returning conversation",
  );
  const positions = await js(`(async()=>{
    const positions=[];
    for(let i=0;i<150;i++) {
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const s=document.querySelector(${JSON.stringify(scroller)});
      // RetainedCanvas stages a cold canvas while code rows acquire their dimensions.
      if(s && getComputedStyle(s).visibility !== 'hidden') positions.push(s.scrollTop);
    }
    return positions;
  })()`);
  assert.ok(positions.length > 30, "sample the visible destination over multiple restore retries");
  assert.ok(
    positions.every((top) => Math.abs(top - before) < 2),
    `${surface}: expected ${before}, saw ${[...new Set(positions)]}`,
  );
  console.log(`PASS ${surface}: return preserves ${before}px without flicker`);
  // Repeated explicit picks must still leave the saved reading position and reveal the header.
  await js(`document.querySelector(${JSON.stringify(file)}).click()`);
  await until(
    `document.querySelector(${JSON.stringify(scroller)})?.scrollTop < ${before - 1000}`,
    "explicit file pick after restoring",
  );
  const picked = await js(`document.querySelector(${JSON.stringify(scroller)}).scrollTop`);
  await pause(200);
  assert.ok(
    Math.abs((await js(`document.querySelector(${JSON.stringify(scroller)}).scrollTop`)) - picked) <
      2,
  );
  console.log(`PASS ${surface}: explicit file pick takes over`);
}
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      width: 1440,
      height: 950,
      show: true,
      webPreferences: {
        preload: join(__dirname, "fixtures/workspace-scroll.cjs"),
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    const errors = [];
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") {
        errors.push(event.message);
        console.error(event.message);
      }
    });
    await window.loadFile(join(__dirname, "../out/renderer/index.html"));
    await until("!!document.querySelector('[title=\"The changed files\"]')", "workspace");
    await js("document.querySelector('[title=\"The changed files\"]').click()");
    await until(`!!document.querySelector(${JSON.stringify(file)})`, "Changes file");
    await js(`document.querySelector(${JSON.stringify(file)}).click()`);
    await until(
      `!!document.querySelector(${JSON.stringify(scroller)})?.querySelector('textarea')`,
      "inline conversation",
    );
    await pause(200);
    await returnToReadingPosition("Changes");
    await js("document.querySelector('[title=\"The guide’s sections and threads\"]').click()");
    await until(
      `!!document.querySelector('[data-retained-canvas="guide"] [id="diff:a.ts"] textarea')`,
      "Guide conversation",
    );
    await js(`document.querySelector(${JSON.stringify(file)}).click()`);
    await pause(250);
    await returnToReadingPosition("Guide");
    assert.deepEqual(errors, [], "no renderer errors");
  })
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
app.on("quit", () => rmSync(temp, { recursive: true, force: true }));
