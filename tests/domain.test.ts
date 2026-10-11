import assert from "node:assert/strict";
import { test } from "node:test";
import { balance, generatePassword, monthTotals, nextRecurringDate, parseEuro, wikiLinks } from "../src/domain.ts";

test("finance amounts stay in integer cents and recurring dates clamp to month end", () => {
  assert.equal(parseEuro("12,34"), 1234);
  assert.equal(parseEuro("0.5"), 50);
  assert.throws(() => parseEuro("1,234"));
  const account = { id: "a", name: "Konto", currency: "EUR" as const, openingBalanceCents: 10000 };
  const transactions = [
    { id: "1", accountId: "a", amountCents: -1234, date: "2026-10-11", category: "Essen", payee: "Laden", note: "", updatedAt: "" },
    { id: "2", accountId: "a", amountCents: 5000, date: "2026-10-12", category: "Gehalt", payee: "Firma", note: "", updatedAt: "" }
  ];
  assert.equal(balance(account, transactions), 13766);
  assert.deepEqual(monthTotals(transactions, "2026-10"), { income: 5000, expenses: 1234 });
  assert.equal(nextRecurringDate({ id: "r", accountId: "a", amountCents: 100, dayOfMonth: 31, category: "", payee: "", active: true, updatedAt: "" }, new Date(2026, 1, 1)), "2026-02-28");
});

test("wiki links are found and generated passwords cover required groups", () => {
  assert.deepEqual(wikiLinks("Siehe [[Idee]] und [[Plan]] und [[Idee]]"), ["Idee", "Plan"]);
  const password = generatePassword(24);
  assert.equal(password.length, 24);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[!@#$%&*+\-=?]/);
});
