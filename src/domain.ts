import type { Account, RecurringPayment, Transaction } from "./vault";

export function parseEuro(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Bitte einen Betrag mit höchstens zwei Nachkommastellen eingeben.");
  const [whole, decimal = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function balance(account: Account, transactions: Transaction[]): number {
  return account.openingBalanceCents + transactions
    .filter((item) => item.accountId === account.id)
    .reduce((sum, item) => sum + item.amountCents, 0);
}

export function monthTotals(transactions: Transaction[], month: string): { income: number; expenses: number } {
  const current = transactions.filter((item) => item.date.startsWith(month));
  return {
    income: current.filter((item) => item.amountCents > 0).reduce((sum, item) => sum + item.amountCents, 0),
    expenses: -current.filter((item) => item.amountCents < 0).reduce((sum, item) => sum + item.amountCents, 0)
  };
}

export function nextRecurringDate(payment: RecurringPayment, now = new Date()): string {
  for (let offset = 0; offset <= 1; offset++) {
    const year = now.getFullYear();
    const month = now.getMonth() + offset;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const date = new Date(year, month, Math.min(payment.dayOfMonth, lastDay));
    if (date.getTime() >= new Date(year, now.getMonth(), now.getDate()).getTime()) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
  }
  throw new Error("Ungültiges Wiederholungsdatum.");
}

export function wikiLinks(body: string): string[] {
  return [...new Set([...body.matchAll(/\[\[([^\[\]\n]{1,160})\]\]/g)]
    .map((match) => match[1].trim()).filter(Boolean))];
}

export function generatePassword(length = 24): string {
  if (!Number.isInteger(length) || length < 16 || length > 128) throw new Error("Passwortlänge muss zwischen 16 und 128 liegen.");
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*+-=?"];
  const alphabet = groups.join("");
  const randomIndex = (max: number): number => {
    const limit = 256 - (256 % max);
    let byte: number;
    do { byte = crypto.getRandomValues(new Uint8Array(1))[0]; } while (byte >= limit);
    return byte % max;
  };
  const result = groups.map((group) => group[randomIndex(group.length)]);
  while (result.length < length) result.push(alphabet[randomIndex(alphabet.length)]);
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join("");
}
