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

    await page.locator('[data-tab="settings"]').click();
    await page.locator("#lock-minutes").fill("7"); await page.getByRole("button", { name: "Sperrzeit speichern" }).click();
    await page.waitForFunction(() => document.querySelector("#lock-minutes").value === "7" && !document.querySelector("#settings-form").inert);
    await page.locator('[data-tab="tasks"]').click();
    await page.locator("#task-title").fill("Veraltete Änderung");
    await page.getByRole("button", { name: /Aufgabe hinzufügen/ }).click();
    await page.locator('[data-tab="sync"]').click();
    await page.getByRole("button", { name: "Verschlüsselten Tresor hochladen" }).click();
    await page.getByText("Synchronisationskonflikt.").waitFor();
    assert.equal((await page.getByText("Synchronisationskonflikt.").count()), 1);
    await page.locator("#remote-passphrase").fill("erste lange Tresor-Passphrase");
    await page.getByRole("button", { name: "Versionen vergleichen / Konflikt lösen" }).click();
    await page.getByRole("heading", { name: "Synchronisationskonflikt lösen" }).waitFor();
    await page.getByRole("combobox", { name: "Einstellungen bei Konflikt" }).selectOption("remote");
    await page.getByRole("button", { name: "Auswahl zusammenführen & synchronisieren" }).click();
    await page.waitForFunction((previous) => localStorage.getItem("allinone.serverRevision.v1") !== previous && Boolean(localStorage.getItem("allinone.serverRevision.v1")), oldRevision);
    await page.locator('[data-tab="dashboard"]').click();
    await page.getByText("Auf Gerät zwei").waitFor();
    await page.getByText("Veraltete Änderung").waitFor();
    await observer.evaluate(() => window.dispatchEvent(new Event("focus")));
    await observer.locator('[data-tab="dashboard"]').click();
    await observer.getByText("Veraltete Änderung").waitFor();
    const { unlockVault } = await import("../src/vault.ts");
    const merged = (await unlockVault(JSON.parse(await page.evaluate(() => localStorage.getItem("allinone.vault.v1"))), "erste lange Tresor-Passphrase")).data; assert.equal(merged.preferences, undefined);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("a delayed automatic pull preserves a draft typed while the request is in flight", { timeout: 30000 }, async () => {
  const { createVault, encryptVault, unlockVault } = await import("../src/vault.ts");
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  const root = await mkdtemp(join(tmpdir(), "aio-sync-draft-"));
  const server = createApp({ publicOrigin: origin, passwordHash: await hashPassword("Review Serverpassphrase lang"), dataDir: root, distDir: resolve("dist"), hosts: [] }); await new Promise((r) => server.listen(port, "127.0.0.1", r)); let browser;
  try {
    const passphrase = "Review Tresorpassphrase lang"; const created = await createVault(passphrase);
    created.data.notes.push({ id: "n", title: "Review Notiz", body: "Original", updatedAt: "2026-10-12" }); const local = await encryptVault(created.data, created.key, created.envelope.kdf.salt);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }); const page = await browser.newPage({ reducedMotion: "reduce" }); page.setDefaultTimeout(5000);
    await page.goto(origin); await page.evaluate((e) => localStorage.setItem("allinone.vault.v1", JSON.stringify(e)), local); await page.reload(); await page.locator("#passphrase").fill(passphrase); await page.getByRole("button", { name: /Tresor entsperren/ }).click();
    await page.locator('[data-tab="sync"]').click(); await page.locator("#server-password").fill("Review Serverpassphrase lang"); await page.getByRole("button", { name: "Server verbinden" }).click(); await page.getByRole("button", { name: "Verschlüsselten Tresor hochladen" }).click(); await page.getByText("Verschlüsselter Tresor auf dem Server gespeichert.").waitFor();
    created.data.notes[0].body = "Serverversion"; const remote = await encryptVault(created.data, created.key, created.envelope.kdf.salt);
    await page.evaluate(async (envelope) => { const current = await (await fetch("/api/sync")).json(); const r = await fetch("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: current.revision, envelope }) }); if (!r.ok) throw new Error("Fixture upload failed"); }, remote);
    await page.locator('[data-tab="notes"]').click(); await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    let release; const barrier = new Promise((r) => { release = r; }); let intercepted;
    const reached = new Promise((r) => { intercepted = r; });
    await page.route("**/api/sync", async (route) => { if (route.request().method() === "GET") { intercepted(); await barrier; } await route.continue(); });
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await reached;
    await page.locator("#note-body").fill("Während Abruf getippter Entwurf"); release();
    await page.getByText("Lokale Änderungen erkannt. Bitte Synchronisationskonflikt prüfen.", { exact: true }).waitFor();
    assert.equal(await page.locator("#note-body").inputValue(), "Während Abruf getippter Entwurf");
    const current = JSON.parse(await page.evaluate(() => localStorage.getItem("allinone.vault.v1"))); assert.equal((await unlockVault(current, passphrase)).data.notes[0].body, "Original");
  } finally { await browser?.close(); await new Promise((r) => server.close(r)); await rm(root, { recursive: true, force: true }); }
});

test("late upload response cannot re-pair a vault restored in another tab", { timeout: 30000 }, async () => {
  const { createVault } = await import("../src/vault.ts"); const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  const root = await mkdtemp(join(tmpdir(), "aio-sync-generation-")); const server = createApp({ publicOrigin: origin, passwordHash: await hashPassword("Review Serverpassphrase lang"), dataDir: root, distDir: resolve("dist"), hosts: [] }); await new Promise((r) => server.listen(port, "127.0.0.1", r)); let browser;
  try {
    const passphrase = "Review Tresorpassphrase lang"; const created = await createVault(passphrase);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }); const context = await browser.newContext({ reducedMotion: "reduce" }); const page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.goto(origin); await page.evaluate((e) => localStorage.setItem("allinone.vault.v1", JSON.stringify(e)), created.envelope); await page.reload(); await page.locator("#passphrase").fill(passphrase); await page.getByRole("button", { name: /Tresor entsperren/ }).click(); await page.locator('[data-tab="sync"]').click(); await page.locator("#server-password").fill("Review Serverpassphrase lang"); await page.getByRole("button", { name: "Server verbinden" }).click(); await page.getByText("Server-Sitzung aktiv", { exact: true }).waitFor();
    let release; const barrier = new Promise((r) => { release = r; }); let reached; const accepted = new Promise((r) => { reached = r; });
    await page.route("**/api/sync", async (route) => { if (route.request().method() === "PUT") { const response = await route.fetch(); reached(); await barrier; return route.fulfill({ response }); } return route.continue(); });
    await page.getByRole("button", { name: "Verschlüsselten Tresor hochladen" }).click(); await accepted;
    const other = await context.newPage(); other.setDefaultTimeout(5000); await other.goto(origin); await other.locator("#passphrase").fill(passphrase); await other.getByRole("button", { name: /Tresor entsperren/ }).click(); await other.locator('[data-tab="settings"]').click(); await other.getByRole("button", { name: "Jetzt Sicherungsstand anlegen" }).click(); await other.getByText("Aktueller Stand gesichert.").waitFor();
    const before = await other.evaluate(() => localStorage.getItem("allinone.serverGeneration.v1")); await other.locator("#backup-passphrase").fill(passphrase); other.once("dialog", (d) => d.accept()); await other.getByRole("button", { name: "Sicherungsstand wiederherstellen", exact: true }).first().click(); await other.waitForFunction((prior) => localStorage.getItem("allinone.serverGeneration.v1") !== prior, before);
    release(); await page.getByText("Synchronisation zwischenzeitlich zurückgesetzt.", { exact: true }).waitFor(); assert.equal(await other.evaluate(() => localStorage.getItem("allinone.serverRevision.v1")), null); assert.equal(await other.evaluate(() => localStorage.getItem("allinone.serverBase.v1")), null);
  } finally { await browser?.close(); await new Promise((r) => server.close(r)); await rm(root, { recursive: true, force: true }); }
});
