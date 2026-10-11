import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { chromium } from "playwright-core";

test("Google Drive stores only an encrypted snapshot and restores it", { timeout: 30000 }, async () => {
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4175", "--strictPort"], { stdio: "ignore" });
  let browser;
  try {
    const origin = "http://127.0.0.1:4175";
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { ready = (await fetch(origin)).ok; } catch { /* server starting */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.google = { accounts: { oauth2: { initTokenClient: ({ callback }) => ({ requestAccessToken: () => callback({ access_token: "test-token" }) }) } } };
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    let snapshot;
    let uploadBody = "";
    await page.route("https://www.googleapis.com/**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        uploadBody = request.postData() || "";
        const boundary = /boundary=([^;]+)/.exec(request.headers()["content-type"] || "")?.[1];
        assert.ok(boundary);
        snapshot = JSON.parse(uploadBody.split(`--${boundary}`)[2].split("\r\n\r\n")[1].trim());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "test_snapshot" }) });
      }
      if (request.url().includes("alt=media")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: snapshot ? [{ id: "test_snapshot", name: "allinone-vault-test.json", modifiedTime: new Date().toISOString() }] : [] }) });
    });
    await page.goto(origin);
    await page.locator("#passphrase").fill("eine lange Drive Testpassphrase");
    await page.locator("#confirm").fill("eine lange Drive Testpassphrase");
    await page.getByRole("button", { name: /Tresor erstellen/ }).click();
    await page.locator('[data-tab="tasks"]').click();
    await page.locator("#task-title").fill("Vor dem Snapshot");
    await page.getByRole("button", { name: /Aufgabe hinzufügen/ }).click();
    await page.locator('[data-tab="sync"]').click();
    await page.locator("#google-client-id").fill("test.apps.googleusercontent.com");
    await page.getByRole("button", { name: "Client-ID speichern" }).click();
    await page.getByRole("button", { name: "Google Drive verbinden" }).click();
    await page.getByRole("button", { name: "Verschlüsselte Version hochladen" }).click();
    await page.getByRole("button", { name: "Diese Version laden" }).waitFor();
    assert.equal(snapshot.version, 1);
    assert.equal(uploadBody.includes("Vor dem Snapshot"), false);
    assert.ok(snapshot.cipher.data);

    await page.locator('[data-tab="tasks"]').click();
    await page.locator("#task-title").fill("Nach dem Snapshot");
    await page.getByRole("button", { name: /Aufgabe hinzufügen/ }).click();
    await page.getByText("Nach dem Snapshot").waitFor();
    await page.locator('[data-tab="sync"]').click();
    await page.locator("#drive-passphrase").fill("eine lange Drive Testpassphrase");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Diese Version laden" }).click();
    await page.waitForFunction((cipher) => JSON.parse(localStorage.getItem("allinone.vault.v1") || "null")?.cipher?.data === cipher, snapshot.cipher.data);
    await page.locator('[data-tab="tasks"]').click();
    await page.getByText("Vor dem Snapshot").waitFor();
    assert.equal(await page.getByText("Nach dem Snapshot").count(), 0);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
});
