import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { chromium } from "playwright-core";

test("successful unlock animates, failures stay locked and reduced motion skips it", { timeout: 30000 }, async () => {
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4176", "--strictPort"], { stdio: "ignore" });
  let browser;
  try {
    const origin = "http://127.0.0.1:4176";
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { ready = (await fetch(origin)).ok; } catch { /* server starting */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.goto(origin);
    await page.locator("#passphrase").fill("eine lange Animation Testpassphrase");
    await page.locator("#confirm").fill("eine lange Animation Testpassphrase");
    await page.getByRole("button", { name: /Tresor erstellen/ }).click();
    await page.getByText("Tresor entsperrt.").waitFor();
    assert.equal(await page.locator("#app").evaluate((node) => node.inert), true);
    if (process.env.CAPTURE_UNLOCK) {
      await page.waitForTimeout(450);
      await page.screenshot({ path: "/tmp/allinone-unlock-desktop.png" });
    }
    await page.locator(".unlock-scene").waitFor({ state: "detached" });
    assert.equal(await page.locator("#app").evaluate((node) => node.inert), false);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Hallo, schön dass du da bist.");

    await page.getByRole("button", { name: /Tresor sperren/ }).click();
    await page.locator("#passphrase").fill("falsche passphrase");
    await page.getByRole("button", { name: /Tresor entsperren/ }).click();
    await page.getByText("Passphrase falsch oder Tresor beschädigt.").waitFor();
    assert.equal(await page.locator(".unlock-scene").count(), 0);
    assert.equal(await page.getByRole("button", { name: /Tresor entsperren/ }).isEnabled(), true);
    assert.equal(await page.locator(".workspace").count(), 0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#passphrase").fill("eine lange Animation Testpassphrase");
    await page.getByRole("button", { name: /Tresor entsperren/ }).click();
    await page.getByText("Tresor entsperrt.").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.CAPTURE_UNLOCK) {
      await page.waitForTimeout(450);
      await page.screenshot({ path: "/tmp/allinone-unlock-mobile.png" });
    }
    await page.locator(".unlock-scene").waitFor({ state: "detached" });

    const reduced = await browser.newContext({ reducedMotion: "reduce" });
    const quiet = await reduced.newPage(); quiet.setDefaultTimeout(5000);
    await quiet.goto(origin);
    await quiet.evaluate(() => {
      window.unlockScenesCreated = 0;
      new MutationObserver((changes) => {
        for (const change of changes) for (const node of change.addedNodes) {
          if (node instanceof Element && node.matches(".unlock-scene")) window.unlockScenesCreated++;
        }
      }).observe(document.body, { childList: true });
    });
    await quiet.locator("#passphrase").fill("eine lange Animation Testpassphrase");
    await quiet.locator("#confirm").fill("eine lange Animation Testpassphrase");
    await quiet.getByRole("button", { name: /Tresor erstellen/ }).click();
    await quiet.getByRole("heading", { name: "Hallo, schön dass du da bist." }).waitFor();
    assert.equal(await quiet.evaluate(() => window.unlockScenesCreated), 0);
    assert.equal(await quiet.locator("#app").evaluate((node) => node.inert), false);
    await reduced.close();
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
});
