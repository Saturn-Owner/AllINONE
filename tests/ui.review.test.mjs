import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { createVault, encryptVault, unlockVault } from "../src/vault.ts";
const pass = "Review Benutzer Passphrase lang";
async function preview() {
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4191", "--strictPort"], { stdio: "ignore" });
  const origin = "http://127.0.0.1:4191";
  for (let i = 0; i < 50; i++) { try { if ((await fetch(origin)).ok) return { server, origin }; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  server.kill(); throw new Error("Preview not ready");
}
async function fixture() {
  const created = await createVault(pass);
  created.data.notes.push({ id: "n", title: "Review Notiz", body: "Gespeicherter Inhalt", updatedAt: "2026-10-12" });
  created.data.tasks.push({ id: "t", title: "Gespeicherte Aufgabe", due: null, priority: "mittel", done: false, createdAt: "2026-10-12" });
  created.data.accounts.push({ id: "a", name: "Giro", currency: "EUR", openingBalanceCents: 0 }, { id: "b", name: "Sparen", currency: "EUR", openingBalanceCents: 0 });
  created.envelope = await encryptVault(created.data, created.key, created.envelope.kdf.salt); return created;
}
async function seed(page, origin, envelope) { await page.goto(origin); await page.evaluate((e) => localStorage.setItem("allinone.vault.v1", JSON.stringify(e)), envelope); await page.reload(); await page.locator("#passphrase").fill(pass); await page.getByRole("button", { name: /Tresor entsperren/ }).click(); await page.locator(".workspace").waitFor(); }
async function holdCrypto(page, name) {
  await page.evaluate((name) => {
    const old = crypto.subtle[name].bind(crypto.subtle);
    window.cryptoStarted = false; window.cryptoFinished = false;
    crypto.subtle[name] = async (...args) => {
      window.cryptoStarted = true; await new Promise((r) => { window.releaseCrypto = r; });
      const result = await old(...args); setTimeout(() => { window.cryptoFinished = true; }, 40); return result;
    };
  }, name);
}

test("drafts survive attachments and row changes; duplicate subtasks and multi-account CSV remain correct", { timeout: 30000 }, async () => {
  const { server, origin } = await preview(); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }); const context = await browser.newContext({ reducedMotion: "reduce" }); const page = await context.newPage(); page.setDefaultTimeout(5000);
    const created = await fixture(); await seed(page, origin, created.envelope);
    await page.locator('[data-tab="notes"]').click(); await page.getByRole("button", { name: "Bearbeiten", exact: true }).click(); await page.locator("#note-body").fill("Nicht gespeicherter Entwurf");
    await page.locator(".note-attachments input[type=file]").setInputFiles({ name: "test.txt", mimeType: "text/plain", buffer: Buffer.from("Anhang") }); await page.getByRole("button", { name: "↓ test.txt", exact: true }).waitFor(); assert.equal(await page.locator("#note-body").inputValue(), "Nicht gespeicherter Entwurf");
    let data = (await unlockVault(JSON.parse(await page.evaluate(() => localStorage.getItem("allinone.vault.v1"))), pass)).data; assert.equal(data.notes[0].body, "Gespeicherter Inhalt"); assert.equal(data.notes[0].attachments.length, 1);
    await page.locator('[data-tab="tasks"]').click(); await page.locator("#task-title").fill("Noch nicht gespeichert"); await page.getByRole("checkbox", { name: "Aufgabe Gespeicherte Aufgabe abschließen", exact: true }).click(); await page.waitForFunction(() => document.querySelector('.task-row.done')); assert.equal(await page.locator("#task-title").inputValue(), "Noch nicht gespeichert");
    await page.locator("#task-title").fill("Doppelte Unteraufgaben"); await page.locator("#task-subtasks").fill("Prüfen\nPrüfen"); await page.getByRole("button", { name: /Aufgabe hinzufügen/ }).click(); await page.getByText("Doppelte Unteraufgaben", { exact: true }).waitFor();
    await page.locator("#task-title").fill("Zu leeren"); await page.getByRole("button", { name: "Leeren", exact: true }).click(); assert.equal(await page.locator("#task-title").inputValue(), "");
    await page.locator(".advanced-task").filter({ hasText: "Doppelte Unteraufgaben" }).getByRole("button", { name: "Bearbeiten", exact: true }).click(); await page.locator("#task-title").fill("Geänderte Unteraufgaben"); await page.getByRole("button", { name: "Aufgabe speichern", exact: true }).click(); await page.getByText("Geänderte Unteraufgaben", { exact: true }).waitFor();
    data = (await unlockVault(JSON.parse(await page.evaluate(() => localStorage.getItem("allinone.vault.v1"))), pass)).data; const subs = data.tasks.find((t) => t.title === "Geänderte Unteraufgaben").subtasks; assert.equal(new Set(subs.map((s) => s.id)).size, 2);
    await page.locator('[data-tab="finances"]').click(); await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({ name: "konten.csv", mimeType: "text/csv", buffer: Buffer.from("Datum;Betrag;Empfänger;Konto\n2026-10-12;-1,25;Kauf;Giro\n2026-10-12;2,00;Zins;Sparen\n") });
    await page.getByText(/2 neue Buchungen für 2 Konten/).waitFor(); await page.getByRole("button", { name: "CSV-Buchungen importieren" }).click(); await page.getByText("Zins", { exact: true }).waitFor();
    data = (await unlockVault(JSON.parse(await page.evaluate(() => localStorage.getItem("allinone.vault.v1"))), pass)).data; assert.equal(data.transactions.find((t) => t.payee === "Kauf").accountId, "a"); assert.equal(data.transactions.find((t) => t.payee === "Zins").accountId, "b");
  } finally { await browser?.close(); server.kill(); }
});
test("pending restore cannot unlock a locked vault and stale encrypt cannot overwrite another tab", { timeout: 30000 }, async () => {
  const { server, origin } = await preview(); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }); const context = await browser.newContext({ reducedMotion: "reduce" }); const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("dialog", (d) => d.accept());
    const created = await fixture(); await seed(page, origin, created.envelope);
    await page.locator('[data-tab="settings"]').click(); await page.getByRole("button", { name: "Jetzt Sicherungsstand anlegen" }).click(); await page.getByText("Aktueller Stand gesichert.").waitFor();
    await holdCrypto(page, "deriveKey"); await page.locator("#backup-passphrase").fill(pass); await page.getByRole("button", { name: "Sicherungsstand wiederherstellen", exact: true }).first().click(); await page.waitForFunction(() => window.cryptoStarted);
    await page.getByRole("button", { name: "⇥ Tresor sperren", exact: true }).click(); await page.evaluate(() => window.releaseCrypto()); await page.waitForFunction(() => window.cryptoFinished); assert.equal(await page.locator(".workspace").count(), 0); assert.equal(await page.evaluate(() => localStorage.getItem("allinone.vault.v1")), JSON.stringify(created.envelope));
    await page.reload(); await page.locator("#passphrase").fill(pass); await page.getByRole("button", { name: /Tresor entsperren/ }).click(); await page.locator('[data-tab="notes"]').click(); await page.locator("#note-title").fill("Darf nicht in anderen Tresor"); await holdCrypto(page, "encrypt"); await page.getByRole("button", { name: "Notiz speichern", exact: true }).click(); await page.waitForFunction(() => window.cryptoStarted);
    const other = await context.newPage(); await other.goto(origin); const replacement = await createVault("Anderer Tresor Passphrase lang"); await other.evaluate((e) => localStorage.setItem("allinone.vault.v1", JSON.stringify(e)), replacement.envelope); await page.locator("#vault-form").waitFor(); await page.evaluate(() => window.releaseCrypto()); await page.waitForFunction(() => window.cryptoFinished);
    assert.equal(await page.evaluate(() => localStorage.getItem("allinone.vault.v1")), JSON.stringify(replacement.envelope)); assert.equal(await page.locator(".workspace").count(), 0);
    await page.reload(); await holdCrypto(page, "deriveKey"); await page.locator("#passphrase").fill("Anderer Tresor Passphrase lang"); await page.getByRole("button", { name: /Tresor entsperren/ }).click(); await page.waitForFunction(() => window.cryptoStarted);
    await other.evaluate((e) => localStorage.setItem("allinone.vault.v1", JSON.stringify(e)), created.envelope); await page.waitForFunction(() => !document.querySelector("#vault-form button").disabled); await page.evaluate(() => window.releaseCrypto()); await page.waitForFunction(() => window.cryptoFinished);
    assert.equal(await page.locator(".workspace").count(), 0); assert.equal(await page.evaluate(() => localStorage.getItem("allinone.vault.v1")), JSON.stringify(created.envelope));
  } finally { await browser?.close(); server.kill(); }
});

test("blocked browser storage and unsupported vault locking show an actionable message", { timeout: 15000 }, async () => {
  const { server, origin } = await preview(); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
    const blocked = await browser.newContext(); await blocked.addInitScript(() => Object.defineProperty(window, "localStorage", { get: () => { throw new DOMException("Denied", "SecurityError"); } })); const page = await blocked.newPage(); await page.goto(origin); await page.getByText(/Der Browser-Speicher ist nicht verfügbar/).waitFor();
    const unsupported = await browser.newContext(); await unsupported.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined })); const other = await unsupported.newPage(); await other.goto(origin); await other.getByText(/HTTPS.*aktueller Browser erforderlich/).waitFor(); assert.equal(await other.getByRole("button", { name: /Tresor erstellen/ }).isDisabled(), true);
  } finally { await browser?.close(); server.kill(); }
});

test("queued note save keeps its original target when another note is opened", { timeout: 25000 }, async () => {
  const { server, origin } = await preview(); let browser;
  try {
    const created = await fixture(); created.data.notes.push({ id: "b", title: "Andere Notiz", body: "Unverändert", updatedAt: "2026-10-12" }); created.envelope = await encryptVault(created.data, created.key, created.envelope.kdf.salt);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }); const context = await browser.newContext({ reducedMotion: "reduce" }); const page = await context.newPage(); page.setDefaultTimeout(5000); await seed(page, origin, created.envelope);
    await page.locator('[data-tab="notes"]').click(); await page.locator(".note-card").filter({ hasText: "Review Notiz" }).getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await page.evaluate(() => { const old = crypto.subtle.encrypt.bind(crypto.subtle); let calls = 0; crypto.subtle.encrypt = async (...args) => { if (++calls === 1) { window.cryptoStarted = true; await new Promise((r) => { window.releaseCrypto = r; }); } return old(...args); }; });
    await page.locator(".note-attachments input[type=file]").setInputFiles({ name: "queue.txt", mimeType: "text/plain", buffer: Buffer.from("Anhang") }); await page.waitForFunction(() => window.cryptoStarted);
    await page.locator("#note-title").fill("Gespeicherte ursprüngliche Notiz"); await page.locator("#note-body").fill("Richtiger Zielinhalt"); await page.getByRole("button", { name: "Änderungen speichern", exact: true }).click();
    await page.locator(".note-card").filter({ hasText: "Andere Notiz" }).getByRole("button", { name: "Bearbeiten", exact: true }).click(); await page.evaluate(() => window.releaseCrypto()); await page.locator(".note-card").getByText("Gespeicherte ursprüngliche Notiz", { exact: true }).waitFor();
    const data = (await unlockVault(JSON.parse(await page.evaluate(() => localStorage.getItem("allinone.vault.v1"))), pass)).data;
    assert.equal(data.notes.find((n) => n.id === "n").body, "Richtiger Zielinhalt"); assert.equal(data.notes.find((n) => n.id === "b").body, "Unverändert");
  } finally { await browser?.close(); server.kill(); }
});
