import assert from "node:assert/strict";
import { test } from "node:test";
import { completeTask, globalSearch, nextTaskDate, transactionCsv, tasksCalendar } from "../src/productivity.ts";
import { createVault, encryptVault, unlockVault, normalizeData } from "../src/vault.ts";

test("recurring tasks clamp dates and undo does not create duplicate successors", async () => {
  assert.equal(nextTaskDate("2026-01-31", "monatlich"), "2026-02-28");
  assert.equal(nextTaskDate("2026-12-29", "wöchentlich"), "2027-01-05");
  const { data } = await createVault("lange produktivität Testpassphrase");
  data.tasks.push({ id: "t", title: "Monatsabschluss", due: "2026-01-31", done: false, repeat: "monatlich", priority: "hoch", createdAt: "2026-01-01", subtasks: [{ id: "s", title: "Belege", done: true }], reminderAt: "2026-01-31T09:00" });
  completeTask(data, "t", true); completeTask(data, "t", false); completeTask(data, "t", true);
  assert.equal(data.tasks.length, 2); assert.equal(data.tasks[1].due, "2026-02-28"); assert.equal(data.tasks[1].subtasks![0].done, false);
  assert.equal(data.tasks[1].reminderAt, "2026-02-28T09:00");
  assert.equal(nextTaskDate(data.tasks[1].due!, "monatlich", data.tasks[1].repeatDay), "2026-03-31");
  const calendar = tasksCalendar(data.tasks); assert.match(calendar, /DTSTART;VALUE=DATE:20260228/); assert.doesNotMatch(calendar, /20260131/);
});
test("CSV preserves quoted multiline fields and rejects invalid rows before import", () => {
  assert.deepEqual(transactionCsv('Datum;Betrag;Empfänger;Kategorie;Notiz\r\n2026-10-11;-12,34;"Shop; Nord";Essen;"Erste Zeile\nZweite ""Zeile"""'), [{ date: "2026-10-11", amountCents: -1234, payee: "Shop; Nord", category: "Essen", note: 'Erste Zeile\nZweite "Zeile"' }]);
  assert.throws(() => transactionCsv("Datum;Betrag;Empfänger\n2026-02-30;1;Shop"), /Ungültige Buchung/);
  assert.throws(() => transactionCsv('Datum;Betrag;Empfänger\n2026-10-11;1;"offen'), /geschlossenes Feld/);
});
test("enhanced vault preserves preferences, note history, attachments and budgets; search excludes secrets", async () => {
  const created = await createVault("lange produktivität Testpassphrase");
  created.data.preferences = { lockMinutes: 7, notifications: true, widgets: ["payments", "tasks"] };
  created.data.budgets = [{ id: "b", month: "2026-10", category: "Essen", amountCents: 10000 }];
  created.data.notes.push({ id: "n", title: "Wissen", body: "Archivinhalt", updatedAt: "2026-10-11", folder: "Arbeit", tags: ["web"], history: [{ title: "Alt", body: "vorher", updatedAt: "2026-10-10" }], attachments: [{ id: "a", name: "datei.txt", mime: "text/plain", base64: "SGFsbG8=" }] });
  created.data.passwords.push({ id: "p", title: "Login", username: "user", password: "secret-only", url: "https://example.com", notes: "private", updatedAt: "2026-10-11" });
  const envelope = await encryptVault(created.data, created.key, created.envelope.kdf.salt);
  const result = await unlockVault(envelope, "lange produktivität Testpassphrase"); assert.deepEqual(result.data, created.data);
  assert.equal(globalSearch(result.data, "secret-only").length, 0); assert.equal(globalSearch(result.data, "Archivinhalt")[0].id, "n"); assert.equal(globalSearch(result.data, "web")[0].id, "n");
  assert.throws(() => normalizeData({ ...result.data, preferences: { ...result.data.preferences, lockMinutes: 0 } }), /Tresorformat/);
  assert.throws(() => normalizeData({ ...result.data, notes: [{ ...result.data.notes[0], history: [null] }] }), /Tresorformat/);
});
