import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { buildFingerprint } from "../scripts/build-fingerprint.ts";

test("offline build fingerprint changes for extension-only and manifest-only updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aio-build-review-"));
  try {
    await writeFile(join(directory, "index.html"), "unchanged app shell");
    await writeFile(join(directory, "allinone-extension.zip"), "old extension");
    await writeFile(join(directory, "manifest.webmanifest"), "old manifest");
    const initial = await buildFingerprint(directory); assert.equal(await buildFingerprint(directory), initial);
    await writeFile(join(directory, "allinone-extension.zip"), "new extension"); const extension = await buildFingerprint(directory); assert.notEqual(extension, initial);
    await writeFile(join(directory, "manifest.webmanifest"), "new manifest"); assert.notEqual(await buildFingerprint(directory), extension);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("service worker cleans only AllINONE caches and waits for client control", async () => {
  const listeners = new Map(); const deleted: string[] = []; let claimed = false;
  runInNewContext(await readFile("public/sw.js", "utf8"), {
    self: { addEventListener: (name: string, handler: unknown) => listeners.set(name, handler), clients: { claim: async () => { claimed = true; } } },
    caches: { keys: async () => ["allinone-shell-old", "allinone-shell-v2", "another-app"], delete: async (key: string) => { deleted.push(key); } }
  });
  const pending: Promise<unknown>[] = []; listeners.get("activate")({ waitUntil: (p: Promise<unknown>) => pending.push(p) }); await Promise.all(pending);
  assert.deepEqual(deleted, ["allinone-shell-old"]); assert.equal(claimed, true);
});
