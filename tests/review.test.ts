import assert from "node:assert/strict";
import { test } from "node:test";
import { createVault, encryptVault, normalizeData, parseEnvelope } from "../src/vault.ts";
import { parseCsv, transactionCsv, tasksCalendar, nextTaskDate } from "../src/productivity.ts";
import { decimalCents, formatEuro, sumCents } from "../src/domain.ts";

test("malformed collections, dates, duplicate IDs, orphan accounts and attachment encodings are rejected", async () => {
  const { data, envelope } = await createVault("Review fixture Passphrase lang");
  assert.throws(() => normalizeData({ version: 1, tasks: [], notes: [], passwords: {} }), /Tresorformat/);
  const task = { id: "t", title: "Aufgabe", due: "2026-02-30", done: false, priority: "mittel", createdAt: "2026-10-12" };
  assert.throws(() => normalizeData({ ...data, tasks: [task] }), /Tresorformat/);
  assert.throws(() => normalizeData({ ...data, tasks: [{ ...task, due: null }, { ...task, due: null }] }), /Tresorformat/);
  assert.throws(() => normalizeData({ ...data, tasks: [{ ...task, due: null, reminderAt: "2026-10-12T25:01" }] }), /Tresorformat/);
  assert.throws(() => normalizeData({ ...data, budgets: [{ id: "b", category: "x", amountCents: 1, month: "2026-99" }] }), /Tresorformat/);
  assert.throws(() => normalizeData({ ...data, transactions: [{ id: "tx", accountId: "missing", date: "2026-10-12", amountCents: 1, payee: "x", category: "", note: "", updatedAt: "2026-10-12" }] }), /Tresorformat/);
  assert.throws(() => normalizeData({ ...data, notes: [{ id: "n", title: "x", body: "", updatedAt: "2026-10-12", attachments: [{ id: "a", name: "x", mime: "text/plain", base64: "A" }] }] }));
  const padded = structuredClone(envelope); padded.kdf.salt = padded.kdf.salt.slice(0, -3) + "B=="; assert.throws(() => parseEnvelope(JSON.stringify(padded)));
});
test("CSV is structurally strict and preserves exported account names", () => {
  assert.throws(() => parseCsv('a;b\n"x"junk;y'), /Anführungszeichen/);
  assert.throws(() => transactionCsv("Datum;Betrag;Empfänger;Betrag\n2026-10-12;1;X;2"), /doppelte/);
  assert.throws(() => transactionCsv("Datum;Betrag;Empfänger\n2026-10-12;1;X;extra"), /Spaltenzahl/);
  const rows = transactionCsv("Datum;Betrag;Empfänger;Konto\n2026-10-12;-1,25;X;Giro\n2026-10-12;2;Y;Sparen");
  const protectedExport = transactionCsv("Datum;Betrag;Empfänger;Konto;Konto-ID;AllINONE-Format\n2026-10-12;1;'=SUM(A1);'=Giro;a;1"); assert.equal(protectedExport[0].payee, "=SUM(A1)"); assert.equal(protectedExport[0].sourceAccountId, "a");
  assert.equal(rows[0].accountName, "Giro"); assert.equal(rows[1].accountName, "Sparen");
});
test("cent totals are exact and calendar data cannot inject raw content lines", () => {
  assert.equal(sumCents([Number.MAX_SAFE_INTEGER, 1, -1]), Number.MAX_SAFE_INTEGER);
  assert.equal(decimalCents(Number.MAX_SAFE_INTEGER), "90071992547409,91");
  assert.match(formatEuro(Number.MAX_SAFE_INTEGER), /90\.071\.992\.547\.409,91/);
  assert.match(formatEuro(-1), /-0,01/);
  assert.throws(() => sumCents([Number.MAX_SAFE_INTEGER, 1]), /zu groß/);
  assert.equal(nextTaskDate("2026-01-31", "keine"), "2026-01-31");
  const calendar = tasksCalendar([{ id: "x\r\nATTENDEE:evil", title: "Titel\rBEGIN:VEVENT\nFalsch", done: false, priority: "mittel", createdAt: "", due: "2026-10-12" }]);
  assert.equal((calendar.match(/\r\nBEGIN:VEVENT/g) || []).length, 1);
  assert.doesNotMatch(calendar, /\r\nATTENDEE/); assert.match(calendar, /Titel\\nBEGIN:VEVENT\\nFalsch/);
});

test("legacy duplicate subtask IDs are repaired without changing text or completion flags", async () => {
  const { data } = await createVault("Review fixture Passphrase lang");
  data.tasks.push({ id: "t", title: "Alt", done: false, priority: "mittel", due: null, createdAt: "2026-10-12", subtasks: [{ id: "same", title: "Prüfen", done: true }, { id: "same", title: "Prüfen", done: false }] });
  const repaired = normalizeData(data); assert.equal(new Set(repaired.tasks[0].subtasks!.map((s) => s.id)).size, 2);
  assert.deepEqual(repaired.tasks[0].subtasks!.map(({ title, done }) => ({ title, done })), data.tasks[0].subtasks!.map(({ title, done }) => ({ title, done })));
  assert.equal(data.tasks[0].subtasks![1].id, "same", "normalization must not mutate the caller's object");
});

test("encryption refuses data that would produce a backup the reader cannot reopen", async () => {
  const created = await createVault("Review fixture Passphrase lang"); const before = JSON.stringify(created.envelope);
  created.data.notes.push({ id: "large", title: "Groß", body: "x".repeat(8_000_000), updatedAt: "2026-10-12" });
  await assert.rejects(encryptVault(created.data, created.key, created.envelope.kdf.salt), /maximal 10 MB/);
  assert.equal(JSON.stringify(created.envelope), before);
});
