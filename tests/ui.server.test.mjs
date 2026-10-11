import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { hashPassword } from "../server/auth.mjs";
import { createApp } from "../server/index.mjs";

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test("browser profiles sync encrypted vaults automatically and reject stale uploads", { timeout: 45000 }, async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const root = await mkdtemp(join(tmpdir(), "allinone-sync-ui-"));
  const server = createApp({ publicOrigin: origin, passwordHash: await hashPassword("lange Server Testpassphrase"), dataDir: root, distDir: resolve("dist"), hosts: [] });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
    const first = await browser.newContext();
    const page = await first.newPage(); page.setDefaultTimeout(5000);
    await page.goto(origin);
    await page.locator("#passphrase").fill("erste lange Tresor-Passphrase");
    await page.locator("#confirm").fill("erste lange Tresor-Passphrase");
    await page.getByRole("button", { name: /Tresor erstellen/ }).click();
    await page.locator('[data-tab="tasks"]').click();
    await page.locator("#task-title").fill("Geräteübergreifend");
    await page.getByRole("button", { name: /Aufgabe hinzufügen/ }).click();
    await page.locator('[data-tab="sync"]').click();
    await page.locator("#server-password").fill("lange Server Testpassphrase");
    await page.getByRole("button", { name: "Server verbinden" }).click();
    await page.getByRole("button", { name: "Verschlüsselten Tresor hochladen" }).click();
    await page.getByText("Verschlüsselter Tresor auf dem Server gespeichert.").waitFor();

    const second = await browser.newContext();
    const other = await second.newPage(); other.setDefaultTimeout(5000);
    await other.goto(origin);
    await other.locator("#passphrase").fill("andere lange Tresor-Passphrase");
    await other.locator("#confirm").fill("andere lange Tresor-Passphrase");
    await other.getByRole("button", { name: /Tresor erstellen/ }).click();
    await other.locator('[data-tab="sync"]').click();
    await other.locator("#server-password").fill("lange Server Testpassphrase");
    await other.getByRole("button", { name: "Server verbinden" }).click();
    await other.locator("#remote-passphrase").fill("erste lange Tresor-Passphrase");
    other.once("dialog", (dialog) => dialog.accept());
    await other.getByRole("button", { name: "Vom Server herunterladen" }).click();
    await other.waitForFunction(() => Boolean(localStorage.getItem("allinone.serverRevision.v1")));
    await other.locator('[data-tab="dashboard"]').click();
    await other.getByText("Geräteübergreifend").waitFor();

    const third = await browser.newContext();
    const observer = await third.newPage(); observer.setDefaultTimeout(5000);
    await observer.goto(origin);
    await observer.locator("#passphrase").fill("dritte lange Tresor-Passphrase");
    await observer.locator("#confirm").fill("dritte lange Tresor-Passphrase");
    await observer.getByRole("button", { name: /Tresor erstellen/ }).click();
    await observer.locator('[data-tab="sync"]').click();
    await observer.locator("#server-password").fill("lange Server Testpassphrase");
    await observer.getByRole("button", { name: "Server verbinden" }).click();
    await observer.locator("#remote-passphrase").fill("erste lange Tresor-Passphrase");
    observer.once("dialog", (dialog) => dialog.accept());
    await observer.getByRole("button", { name: "Vom Server herunterladen" }).click();
    await observer.waitForFunction(() => Boolean(localStorage.getItem("allinone.serverRevision.v1")));
    const oldRevision = (await other.evaluate(async () => (await (await fetch("/api/sync")).json()).revision));

    await other.locator('[data-tab="tasks"]').click();
    await other.locator("#task-title").fill("Auf Gerät zwei");
    await other.getByRole("button", { name: /Aufgabe hinzufügen/ }).click();
    await other.waitForFunction((previous) => localStorage.getItem("allinone.serverRevision.v1") !== previous, oldRevision, { timeout: 10000 });
    await observer.evaluate(() => window.dispatchEvent(new Event("focus")));
    await observer.locator('[data-tab="dashboard"]').click();
    await observer.getByText("Auf Gerät zwei").waitFor();

    await page.locator('[data-tab="tasks"]').click();
    await page.locator("#task-title").fill("Veraltete Änderung");
    await page.getByRole("button", { name: /Aufgabe hinzufügen/ }).click();
    await page.locator('[data-tab="sync"]').click();
    await page.getByRole("button", { name: "Verschlüsselten Tresor hochladen" }).click();
    await page.getByText("Synchronisationskonflikt.").waitFor();
    assert.equal((await page.getByText("Synchronisationskonflikt.").count()), 1);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
