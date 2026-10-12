import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { unzipSync } from "fflate";
import { createVault, encryptVault } from "../src/vault.ts";

test("packaged Autofill popup decrypts only in memory and fills exactly matching HTTPS login forms", { timeout: 30000 }, async () => {
  const files = unzipSync(await readFile("dist/allinone-extension.zip")); const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]); assert.equal(manifest.host_permissions, undefined);
  // Managed cloud Chromium disables installation. Adapt only Chrome's tab/scripting
  // API; execute the packaged popup and its actual fill function in real browser pages.
  const host = createServer((req, res) => { const name = req.url.slice(1) || "popup.html"; if (!files[name]) { res.writeHead(404); return res.end(); } res.setHeader("content-type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html"); res.end(Buffer.from(files[name])); }); await new Promise((r) => host.listen(0, "127.0.0.1", r)); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }); const context = await browser.newContext();
    await context.route("https://*.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><form><input type="email" autocomplete="username" id="user"><input type="password" autocomplete="current-password" id="password"><button>Login</button></form>' }));
    const target = await context.newPage(); await target.goto("https://login.example.test/");
    const popup = await context.newPage(); popup.setDefaultTimeout(5000);
    await popup.exposeFunction("queryTabs", () => [{ id: 1, url: target.url() }]);
    await popup.exposeFunction("executeFill", async (source, args) => [{ result: await target.evaluate(({ source, args }) => (0, eval)(`(${source})`)(...args), { source, args }) }]);
    await popup.addInitScript(() => { window.chrome = { tabs: { query: () => window.queryTabs() }, scripting: { executeScript: (options) => window.executeFill(options.func.toString(), options.args) } }; });
    await popup.goto(`http://127.0.0.1:${host.address().port}/popup.html`);
    const created = await createVault("Erweiterung Testpassphrase lang");
    created.data.passwords.push({ id: "correct", title: "Passender Zugang", username: "user@example.test", password: "actual-test-secret", url: "https://login.example.test/account", notes: "", updatedAt: "2026-10-11" }, { id: "wrong", title: "Ähnliche falsche Website", username: "", password: "wrong-secret", url: "https://login.example.test.evil.example/", notes: "", updatedAt: "2026-10-11" });
    const envelope = await encryptVault(created.data, created.key, created.envelope.kdf.salt);
    await popup.locator("#file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)) }); await popup.locator("#pass").fill("Erweiterung Testpassphrase lang"); await popup.getByRole("button", { name: "Entsperren", exact: true }).click();
    await popup.getByRole("button", { name: "Passender Zugang · user@example.test ausfüllen", exact: true }).waitFor(); assert.equal(await popup.getByText("Ähnliche falsche Website").count(), 0); assert.equal(await popup.locator("#pass").inputValue(), "");
    await popup.getByRole("button", { name: "Passender Zugang · user@example.test ausfüllen", exact: true }).click(); await popup.getByText("Ausgefüllt. Die Anmeldung musst du selbst bestätigen.").waitFor(); assert.equal(await target.locator("#user").inputValue(), "user@example.test"); assert.equal(await target.locator("#password").inputValue(), "actual-test-secret");
    await target.evaluate(() => { document.querySelector("#password").value = ""; document.querySelector("#password").autocomplete = "section-register new-password"; });
    await popup.getByRole("button", { name: "Passender Zugang · user@example.test ausfüllen", exact: true }).click(); await popup.getByText(/Kein eindeutiges Login-Formular/).waitFor(); assert.equal(await target.locator("#password").inputValue(), "");
    await target.evaluate(() => { document.querySelector("#password").autocomplete = "current-password"; document.querySelector("#password").style.opacity = "0"; });
    await popup.getByRole("button", { name: "Passender Zugang · user@example.test ausfüllen", exact: true }).click(); assert.equal(await target.locator("#password").inputValue(), "");
    await target.goto("https://other.example.test/"); await popup.getByRole("button", { name: "Passender Zugang · user@example.test ausfüllen", exact: true }).click(); await popup.getByText(/Kein eindeutiges Login-Formular/).waitFor(); assert.equal(await target.locator("#password").inputValue(), "");
    assert.equal(await popup.evaluate(() => localStorage.length), 0); await popup.getByRole("button", { name: "Sperren", exact: true }).click(); assert.equal(await popup.locator("#entries button").count(), 0);
  } finally { await browser?.close(); await new Promise((r) => host.close(r)); }
});
