import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { unzipSync } from "fflate";

test("create, edit, lock, restore and use offline", { timeout: 30000 }, async () => {
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { stdio: "ignore" });
  let browser;
  try {
    const url = "http://127.0.0.1:4173";
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { ready = (await fetch(url)).ok; } catch { /* server starting */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, "preview server did not start");

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(url);
    await page.locator("#passphrase").fill("eine sehr lange Testpassphrase");
    await page.locator("#confirm").fill("eine sehr lange Testpassphrase");
    await page.getByRole("button", { name: /Tresor erstellen/ }).click();
    await page.getByRole("heading", { name: "Hallo, schön dass du da bist." }).waitFor();

    await page.locator('[data-tab="tasks"]').click();
    await page.locator("#task-title").fill("Testaufgabe");
    await page.getByRole("button", { name: /Aufgabe hinzufügen/ }).click();
    await page.getByText("Testaufgabe").waitFor();

    await page.locator('[data-tab="notes"]').click();
    await page.locator("#note-title").fill("Testnotiz");
    await page.locator("#note-body").fill("Ein privater Gedanke");
    await page.getByRole("button", { name: "Notiz speichern" }).click();
    await page.getByText("Ein privater Gedanke").waitFor();
    await page.getByRole("button", { name: "Bearbeiten" }).click();
    await page.locator("#note-body").fill("# Überschrift\n\nEin privater Gedanke. [[Andere Notiz]]\n\n<img src=x onerror=alert(1)>");
    await page.locator("#markdown-preview h1").getByText("Überschrift").waitFor();
    assert.equal(await page.locator("#markdown-preview img").count(), 0);
    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    const markdownDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Markdown exportieren" }).click();
    const markdownZip = unzipSync(await readFile(await (await markdownDownload).path()));
    assert.equal(Object.values(markdownZip).some((bytes) => Buffer.from(bytes).toString().includes("Ein privater Gedanke")), true);

    await page.locator('[data-tab="passwords"]').click();
    await page.locator("#pw-title").fill("Testzugang");
    await page.locator("#pw-username").fill("test@example.com");
    await page.getByRole("button", { name: "Generieren" }).click();
    assert.equal((await page.locator("#pw-password").inputValue()).length, 24);
    await page.getByRole("button", { name: "Zugang speichern" }).click();
    await page.getByText("Testzugang").waitFor();

    await page.locator('[data-tab="finances"]').click();
    await page.locator("#account-name").fill("Testkonto");
    await page.getByRole("button", { name: "Konto hinzufügen" }).click();
    await page.locator("#tx-amount").fill("12,34");
    await page.locator("#tx-payee").fill("Testkauf");
    await page.getByRole("button", { name: "Buchung speichern" }).click();
    await page.getByText("Testkauf").waitFor();
    await page.locator("#rec-payee").fill("Testabo");
    await page.locator("#rec-amount").fill("5,00");
    await page.getByRole("button", { name: "Zahlung vormerken" }).click();
    await page.getByText("Testabo").waitFor();
    await page.locator('[data-tab="dashboard"]').click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Sicherung exportieren/ }).click();
    const backup = await readFile(await (await downloadPromise).path());
    assert.equal(backup.includes(Buffer.from("Ein privater Gedanke")), false);
    assert.equal(backup.includes(Buffer.from("Testzugang")), false);

    await page.reload();
    await page.locator("#passphrase").fill("falsche passphrase");
    await page.getByRole("button", { name: /Tresor entsperren/ }).click();
    await page.getByText("Passphrase falsch oder Tresor beschädigt.").waitFor();
    await page.locator("#passphrase").fill("eine sehr lange Testpassphrase");
    await page.getByRole("button", { name: /Tresor entsperren/ }).click();
    await page.getByText("Testaufgabe").waitFor();

    const restored = await browser.newContext();
    const otherPage = await restored.newPage();
    otherPage.setDefaultTimeout(5000);
    await otherPage.goto(url);
    await otherPage.locator("#passphrase").fill("eine sehr lange Testpassphrase");
    await otherPage.locator("#import-file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: backup });
    await otherPage.getByText("Testaufgabe").waitFor();
    await otherPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await restored.setOffline(true);
    await otherPage.reload();
    await otherPage.locator("#passphrase").fill("eine sehr lange Testpassphrase");
    await otherPage.getByRole("button", { name: /Tresor entsperren/ }).click();
    await otherPage.getByText("Testaufgabe").waitFor();
    await otherPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await otherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "mobile layout overflows horizontally");
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
});
