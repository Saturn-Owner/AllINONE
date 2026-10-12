import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { createVault, encryptVault } from "../src/vault.ts";

test("backup retention is atomic between tabs and a duplicate successful save clears a previous storage error", { timeout: 30000 }, async () => {
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4192", "--strictPort"], { stdio: "ignore" }); let browser;
  const origin = "http://127.0.0.1:4192";
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const created = await createVault("Backup fixture Passphrase lang"); const raws = [];
    for (let i = 0; i < 50; i++) { created.data.notes = [{ id: "n", title: `Stand ${i}`, body: "Private Testdaten", updatedAt: "2026-10-12" }]; raws.push(JSON.stringify(await encryptVault(created.data, created.key, created.envelope.kdf.salt))); }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }); const context = await browser.newContext(); const left = await context.newPage(); const right = await context.newPage(); await Promise.all([left.goto(origin), right.goto(origin)]);
    const save = (page, values) => page.evaluate(async (values) => { const backups = await import("/src/backups.ts"); await Promise.all(values.map((raw) => backups.saveBackup(raw))); }, values);
    await Promise.all([save(left, raws.slice(0, 25)), save(right, raws.slice(25))]);
    const entries = await left.evaluate(async () => (await import("/src/backups.ts")).listBackups()); assert.equal(entries.length, 20); assert.equal(new Set(entries.map((b) => b.order)).size, 20); assert.equal(entries.some((b) => b.raw.includes("Private Testdaten")), false);
    const recovered = await left.evaluate(async (raw) => {
      const backups = await import("/src/backups.ts"); const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = () => { throw new Error("simulated storage failure"); };
      try { await backups.saveBackup(raw); } catch {}
      const failed = backups.backupError; IDBDatabase.prototype.transaction = original;
      await backups.saveBackup(raw); return { failed, final: backups.backupError };
    }, entries[0].raw);
    assert.match(recovered.failed, /fehlgeschlagen/); assert.equal(recovered.final, "");
  } finally { await browser?.close(); server.kill(); }
});
