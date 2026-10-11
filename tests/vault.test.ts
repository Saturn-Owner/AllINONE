import assert from "node:assert/strict";
import { test } from "node:test";
import { createVault, encryptVault, normalizeData, parseEnvelope, unlockVault } from "../src/vault.ts";

test("new vault unlocks and preserves tasks and notes after encryption", async () => {
  const passphrase = "eine sehr lange Testpassphrase";
  const created = await createVault(passphrase);
  created.data.tasks.push({ id: "task-1", title: "Einkaufen", done: false, priority: "mittel", due: null, createdAt: "2026-10-11T00:00:00Z" });
  created.data.notes.push({ id: "note-1", title: "Idee", body: "Ein Gedanke", updatedAt: "2026-10-11T00:00:00Z" });
  const envelope = await encryptVault(created.data, created.key, created.envelope.kdf.salt);
  const reopened = await unlockVault(parseEnvelope(JSON.stringify(envelope)), passphrase);
  assert.deepEqual(reopened.data, created.data);
  assert.equal(JSON.stringify(envelope).includes("Ein Gedanke"), false);
});

test("wrong passphrase and changed ciphertext do not reveal data", async () => {
  const created = await createVault("eine sehr lange Testpassphrase");
  await assert.rejects(unlockVault(created.envelope, "eine falsche Testpassphrase"), /falsch oder Tresor beschädigt/);
  const damaged = structuredClone(created.envelope);
  damaged.cipher.data = damaged.cipher.data.slice(0, -4) + "AAAA";
  await assert.rejects(unlockVault(damaged, "eine sehr lange Testpassphrase"));
});

test("invalid backup formats are rejected", async () => {
  assert.throws(() => parseEnvelope("not json"));
  assert.throws(() => parseEnvelope(JSON.stringify({ version: 99 })));
  await assert.rejects(createVault("short"), /mindestens 14/);
});

test("old task and note vaults migrate without losing content", () => {
  const migrated = normalizeData({ version: 1, tasks: [], notes: [{ id: "n", title: "Alt", body: "Inhalt", updatedAt: "2026-10-11" }] });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.notes[0].body, "Inhalt");
  assert.deepEqual(migrated.passwords, []);
  assert.deepEqual(migrated.transactions, []);
});
