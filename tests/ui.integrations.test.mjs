import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as probeServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { createVault, encryptVault } from "../src/vault.ts";
import { createApp } from "../server/index.mjs";
import { hashPassword } from "../server/auth.mjs";
async function freePort() { const p = probeServer(); await new Promise((r) => p.listen(0, "127.0.0.1", r)); const port = p.address().port; await new Promise((r) => p.close(r)); return port; }

test("KI needs login and explicit note consent; suggestions require review, share capture waits for unlock", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "aio-ai-ui-")); const received = [];
  const ollama = createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); received.push(JSON.parse(Buffer.concat(chunks).toString())); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ message: { content: "- Termin vereinbaren\n- Dokumente prüfen" } })); });
  await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  const server = createApp({ publicOrigin: origin, passwordHash: await hashPassword("Server Testpassphrase lang"), dataDir: root, distDir: resolve("dist"), hosts: [], ai: { url: `http://127.0.0.1:${ollama.address().port}`, model: "local-test" } }); await new Promise((r) => server.listen(port, "127.0.0.1", r)); let browser;
  try {
    const unauthorized = await fetch(`${origin}/api/ai`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ consent: true, title: "x", body: "y", action: "tasks" }) }); assert.equal(unauthorized.status, 401);
    const created = await createVault("bestehende Passphrase ü 123");
    created.data.notes.push({ id: "approved", title: "Planung", body: "Termin mit Dokumenten", updatedAt: "2026-10-11" }, { id: "private", title: "Andere Notiz", body: "DO_NOT_SEND_OTHER_NOTE", updatedAt: "2026-10-11" });
    created.data.passwords.push({ id: "secret", title: "Zugang", username: "u", password: "DO_NOT_SEND_PASSWORD", url: "https://example.com", notes: "", updatedAt: "2026-10-11" });
    const envelope = await encryptVault(created.data, created.key, created.envelope.kdf.salt);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }); const context = await browser.newContext({ reducedMotion: "reduce" }); const page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.goto(origin); await page.evaluate((env) => localStorage.setItem("allinone.vault.v1", JSON.stringify(env)), envelope); await page.reload(); await page.locator("#passphrase").fill("bestehende Passphrase ü 123"); await page.getByRole("button", { name: /Tresor entsperren/ }).click();
    await page.locator('[data-tab="sync"]').click(); await page.locator("#server-password").fill("Server Testpassphrase lang"); await page.getByRole("button", { name: "Server verbinden" }).click(); await page.getByText("Server-Sitzung aktiv").waitFor();
    await page.locator('[data-tab="ai"]').click(); await page.locator("#ai-note").selectOption("approved"); await page.locator("#ai-action").selectOption("tasks"); await page.getByRole("button", { name: "KI-Anfrage starten" }).click(); assert.equal(received.length, 0);
    await page.locator("#ai-consent").check(); await page.getByRole("button", { name: "KI-Anfrage starten" }).click(); await page.getByRole("textbox", { name: "KI-Aufgaben bearbeiten" }).waitFor();
    assert.equal(received.length, 1); assert.equal(received[0].messages[1].content, "Planung\n\nTermin mit Dokumenten"); assert.equal(JSON.stringify(received).includes("DO_NOT_SEND"), false);
    const before = await page.evaluate(() => localStorage.getItem("allinone.vault.v1")); await page.getByRole("textbox", { name: "KI-Aufgaben bearbeiten" }).fill("Nur diese geprüfte Aufgabe"); assert.equal(await page.evaluate(() => localStorage.getItem("allinone.vault.v1")), before);
    await page.getByRole("button", { name: "Geprüfte Aufgaben übernehmen" }).click(); await page.locator('[data-tab="tasks"]').click(); await page.getByText("Nur diese geprüfte Aufgabe", { exact: true }).waitFor(); assert.equal(await page.getByText("Dokumente prüfen", { exact: true }).count(), 0);
    await page.goto(`${origin}/?share=1&title=Geteilter%20Artikel&text=Ein%20Gedanke&url=https%3A%2F%2Fexample.com%2Fartikel`); await page.locator("#passphrase").fill("bestehende Passphrase ü 123"); await page.getByRole("button", { name: /Tresor entsperren/ }).click(); await page.getByRole("heading", { name: "Geteilten Inhalt speichern" }).waitFor();
    await page.getByRole("button", { name: "Als Notiz speichern" }).click(); await page.waitForFunction(() => !location.search); await page.locator('[data-tab="notes"]').click(); await page.locator(".note-card").getByText("Geteilter Artikel", { exact: true }).waitFor();
    await page.locator('[data-tab="settings"]').click(); await context.grantPermissions(["notifications"], { origin }); await page.getByRole("button", { name: "Browser-Mitteilungen aktivieren" }).click(); await page.getByRole("button", { name: "Mitteilungen deaktivieren" }).waitFor();
  } finally { await browser?.close(); await new Promise((r) => server.close(r)); await new Promise((r) => ollama.close(r)); await rm(root, { recursive: true, force: true }); }
});
