// Run after pnpm build: pnpm exec electron scripts/check-thread-resolutions.cjs
// Exercises the built renderer with synthetic review state; no accounts, agents or real database.
const { app, BrowserWindow, nativeTheme } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const temp = mkdtempSync(join(tmpdir(), "coxswain-resolved-ui-"));
app.setPath("userData", temp);
let window;
const js = (code) => window.webContents.executeJavaScript(code, true);
async function until(code, label) {
  for (let i = 0; i < 120; i++) {
    if (await js(code)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      width: 1000,
      height: 950,
      show: true,
      webPreferences: {
        preload: join(__dirname, "fixtures/thread-resolutions.cjs"),
        contextIsolation: false,
        sandbox: false,
      },
    });
    await window.loadFile(join(__dirname, "../out/renderer/index.html"));
    await until(
      "!!document.querySelector('.review-comment-card[data-resolved]')",
      "resolved thread",
    );
    assert.match(
      await js("document.querySelector('.review-comment-card').innerText"),
      /Resolved · The exported default is now 2/,
    );
    await js("document.querySelector('.review-comment-card').scrollIntoView({block:'center'})");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(
      await js(`(() => {
      const summary = document.querySelector('[aria-label="Expand resolved thread"] span');
      return summary && summary.scrollWidth <= summary.clientWidth &&
        summary.getBoundingClientRect().height > parseFloat(getComputedStyle(summary).lineHeight);
    })()`),
      "collapsed summary wraps in full without horizontal clipping",
    );
    await until(
      "[...document.querySelectorAll('[role=tab]')].some(e=>e.innerText.includes('@review-creator'))",
      "PR creator on workspace tab",
    );
    for (const theme of ["light", "dark", "soft-dark"]) {
      nativeTheme.themeSource = theme === "light" ? "light" : "dark";
      await js(`fixture.appearance(${JSON.stringify(theme)})`);
      await until(
        `document.documentElement.dataset.appearance===${JSON.stringify(theme)}`,
        "appearance update",
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      const backgrounds = await js(
        "[...document.querySelectorAll('.review-comment-card[data-resolved], .guide-thread-row[data-resolved]')].map(e=>getComputedStyle(e).backgroundColor)",
      );
      assert.ok(backgrounds.length >= 2, "canvas and sidebar are resolved");
      console.log(theme, backgrounds);
      assert.equal(new Set(backgrounds).size, 1, "sidebar and canvas share a green surface");
      console.log(theme, backgrounds[0]);
      assert.ok(
        await js(`(() => {
        const find = (root) => {
          const line = root.querySelector('[data-line][data-line-type="change-addition"]');
          if (line) return line;
          for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) { const found = find(element.shadowRoot); if (found) return found; }
          }
        };
        const line = find(document);
        const thread = document.querySelector('.review-comment-card[data-resolved]');
        if (!line || !thread) return false;
        const pixel = (color) => {
          const context = document.createElement('canvas').getContext('2d');
          context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].join(',');
        };
        const foreground = getComputedStyle(line).getPropertyValue('--diffs-fg');
        const probe = document.createElement('span');
        probe.style.color = foreground; line.append(probe);
        const diffText = getComputedStyle(probe).color; probe.remove();
        const summary = thread.querySelector('.resolved-thread-summary');
        const sidebar = document.querySelector('.guide-thread-row[data-resolved] > button > span');
        return pixel(getComputedStyle(line).backgroundColor) === pixel(getComputedStyle(thread).backgroundColor) &&
          pixel(diffText) === pixel(getComputedStyle(summary).color) &&
          pixel(diffText) === pixel(getComputedStyle(sidebar).color);
      })()`),
        "resolved fill and text match the diff",
      );
    }
    await js("document.querySelector('.review-comment-card').scrollIntoView({block:'center'})");
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (process.env.COXSWAIN_TEST_SCREENSHOT)
      writeFileSync(
        process.env.COXSWAIN_TEST_SCREENSHOT,
        (await window.webContents.capturePage()).toPNG(),
      );
    await js("document.querySelector('[aria-label=\"Expand resolved thread\"]').click()");
    await until(
      "document.querySelector('.review-comment-card').innerText.includes('Change the default value to 2')",
      "expanded original conversation",
    );
    await js("document.querySelector('[aria-label=\"Reopen thread\"]').click()");
    await until(
      "!document.querySelector('.review-comment-card[data-resolved]')",
      "reopened thread",
    );
    assert.ok(
      !(await js(
        "document.querySelector('.review-comment-card').innerText.includes('The exported default is now 2')",
      )),
    );
    await js("document.querySelector('[aria-label=\"Resolve thread\"]').click()");
    await until(
      "!!document.querySelector('.review-comment-card[data-resolved] [aria-label=\"Expand resolved thread\"]')",
      "newly resolved conversation collapses",
    );
    console.log(
      "PASS resolution summary, green canvas/sidebar in light/dark, expansion and reopening",
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
