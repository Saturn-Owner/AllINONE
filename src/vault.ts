import { parseEnvelope, base64Bytes as fromBase64, type VaultEnvelope } from "./envelope.ts";
export { parseEnvelope, type VaultEnvelope } from "./envelope.ts";
import { sumCents } from "./domain.ts";
import { validDate, validMonth, validReminder } from "./dates.ts";
export type Priority = "niedrig" | "mittel" | "hoch";

export interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: Priority;
  due: string | null;
  createdAt: string;
  status?: "offen" | "in-arbeit" | "erledigt";
  subtasks?: { id: string; title: string; done: boolean }[];
  repeatDay?: number;
  repeat?: "keine" | "täglich" | "wöchentlich" | "monatlich";
  reminderAt?: string;
  successorId?: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  folder?: string;
  tags?: string[];
  attachments?: { id: string; name: string; mime: string; base64: string }[];
  history?: { title: string; body: string; updatedAt: string }[];
}

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  name: string;
  openingBalanceCents: number;
  currency: "EUR";
}

export interface Transaction {
  id: string;
  accountId: string;
  amountCents: number;
  date: string;
  category: string;
  payee: string;
  note: string;
  updatedAt: string;
}

export interface RecurringPayment {
  id: string;
  accountId: string;
  amountCents: number;
  dayOfMonth: number;
  category: string;
  payee: string;
  active: boolean;
  updatedAt: string;
  subscription?: boolean;
  cancelBy?: string;
  website?: string;
}

export interface Preferences {
  lockMinutes: number;
  widgets: string[];
  notifications: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  lockMinutes: 15, widgets: ["tasks", "notes", "payments"], notifications: false
};

export interface VaultData {
  version: 3;
  tasks: Task[];
  notes: Note[];
  passwords: PasswordEntry[];
  accounts: Account[];
  transactions: Transaction[];
  recurring: RecurringPayment[];
  budgets?: { id: string; month: string; category: string; amountCents: number }[];
  preferences?: Preferences;
}

const ITERATIONS = 600000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function normalizeData(value: unknown): VaultData {
  if (!value || typeof value !== "object") throw new Error("Unbekanntes Tresorformat.");
  const data = value as Partial<Omit<VaultData, "version">> & { version?: number };
  const validBase = ([1, 2, 3].includes(data.version || 0)) && Array.isArray(data.tasks) && Array.isArray(data.notes)
    && data.tasks.every((task) => typeof task?.id === "string" && typeof task.title === "string"
      && typeof task.done === "boolean" && ["niedrig", "mittel", "hoch"].includes(task.priority)
      && (task.due === null || typeof task.due === "string") && typeof task.createdAt === "string")
    && data.notes.every((note) => typeof note?.id === "string" && typeof note.title === "string"
      && typeof note.body === "string" && typeof note.updatedAt === "string");
  if (!validBase) throw new Error("Unbekanntes Tresorformat.");
  const arrays = [data.passwords, data.accounts, data.transactions, data.recurring];
  if (arrays.some((items) => (items !== undefined || data.version !== 1) && !Array.isArray(items))) throw new Error("Unbekanntes Tresorformat.");
  const passwords = data.passwords || [];
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  const recurring = data.recurring || [];
  if (!passwords.every((item) => typeof item?.id === "string" && typeof item.title === "string"
      && typeof item.username === "string" && typeof item.password === "string"
      && typeof item.url === "string" && typeof item.notes === "string" && typeof item.updatedAt === "string")
    || !accounts.every((item) => typeof item?.id === "string" && typeof item.name === "string"
      && Number.isSafeInteger(item.openingBalanceCents) && item.currency === "EUR")
    || !transactions.every((item) => typeof item?.id === "string" && typeof item.accountId === "string"
      && Number.isSafeInteger(item.amountCents) && typeof item.date === "string"
      && typeof item.category === "string" && typeof item.payee === "string"
      && typeof item.note === "string" && typeof item.updatedAt === "string")
    || !recurring.every((item) => typeof item?.id === "string" && typeof item.accountId === "string"
      && Number.isSafeInteger(item.amountCents) && Number.isInteger(item.dayOfMonth)
      && item.dayOfMonth >= 1 && item.dayOfMonth <= 31 && typeof item.category === "string"
      && typeof item.payee === "string" && typeof item.active === "boolean" && typeof item.updatedAt === "string")) {
    throw new Error("Unbekanntes Tresorformat.");
  }
  const invalid = () => { throw new Error("Unbekanntes Tresorformat."); };
  const unique = (items: { id: string }[]) => Array.isArray(items) && items.every((i) => typeof i?.id === "string" && i.id.length > 0 && !/[\r\n\0]/.test(i.id)) && new Set(items.map((i) => i.id)).size === items.length;
  for (const items of [data.tasks!, data.notes!, passwords, accounts, transactions, recurring, data.budgets || []]) if (!unique(items)) invalid();
  for (const task of data.tasks!) {
    if (task.due !== null && !validDate(task.due)) invalid();
    if (task.reminderAt !== undefined && !validReminder(task.reminderAt)) invalid();
    if (Array.isArray(task.subtasks) && task.subtasks.some((s) => typeof s?.id !== "string" || !s.id || /[\r\n\0]/.test(s.id))) invalid();
    if (task.status !== undefined && !["offen", "in-arbeit", "erledigt"].includes(task.status)) invalid();
    if (task.repeat !== undefined && !["keine", "täglich", "wöchentlich", "monatlich"].includes(task.repeat)) invalid();
    if (task.repeatDay !== undefined && (!Number.isInteger(task.repeatDay) || task.repeatDay < 1 || task.repeatDay > 31)) invalid();
    if (task.reminderAt !== undefined && typeof task.reminderAt !== "string") invalid();
    if (task.successorId !== undefined && typeof task.successorId !== "string") invalid();
    if (task.subtasks !== undefined && (!Array.isArray(task.subtasks) || !task.subtasks.every((s) => typeof s?.id === "string" && typeof s.title === "string" && typeof s.done === "boolean"))) invalid();
  }
  for (const note of data.notes!) {
    if (note.attachments && (!Array.isArray(note.attachments) || !unique(note.attachments))) invalid();
    if (note.folder !== undefined && typeof note.folder !== "string") invalid();
    if (note.tags !== undefined && (!Array.isArray(note.tags) || !note.tags.every((tag) => typeof tag === "string"))) invalid();
    if (note.history !== undefined && (!Array.isArray(note.history) || note.history.length > 20 || !note.history.every((h) => typeof h?.title === "string" && typeof h.body === "string" && typeof h.updatedAt === "string"))) invalid();
    if (note.attachments !== undefined && (!Array.isArray(note.attachments) || !note.attachments.every((a) => typeof a?.id === "string" && typeof a.name === "string" && typeof a.mime === "string" && typeof a.base64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(a.base64) && a.base64.length <= 2_800_000 && fromBase64(a.base64).length <= 2_000_000))) invalid();
  }
  for (const transaction of transactions) if (!validDate(transaction.date) || transaction.amountCents === 0) invalid();
  for (const payment of recurring) {
    if (payment.amountCents <= 0 || (payment.cancelBy && !validDate(payment.cancelBy))) invalid();
    if (payment.subscription !== undefined && typeof payment.subscription !== "boolean") invalid();
    if (payment.cancelBy !== undefined && typeof payment.cancelBy !== "string") invalid();
    if (payment.website !== undefined && typeof payment.website !== "string") invalid();
  }
  if (data.budgets !== undefined && (!Array.isArray(data.budgets) || !data.budgets.every((b) => typeof b?.id === "string" && validMonth(b.month) && typeof b.category === "string" && Number.isSafeInteger(b.amountCents) && b.amountCents >= 0))) invalid();
  if (data.preferences !== undefined && (!Number.isInteger(data.preferences?.lockMinutes) || data.preferences.lockMinutes < 1 || data.preferences.lockMinutes > 120 || typeof data.preferences.notifications !== "boolean" || !Array.isArray(data.preferences.widgets) || new Set(data.preferences.widgets).size !== data.preferences.widgets.length || !data.preferences.widgets.every((w) => ["tasks", "notes", "payments"].includes(w)))) invalid();
  const accountIds = new Set(accounts.map((a) => a.id));
  if ([...transactions, ...recurring].some((t) => !accountIds.has(t.accountId))) invalid();
  const balances = new Map(accounts.map((a) => [a.id, BigInt(a.openingBalanceCents)]));
  const months = new Map<string, { income: bigint; expenses: bigint }>();
  for (const t of transactions) {
    balances.set(t.accountId, balances.get(t.accountId)! + BigInt(t.amountCents));
    const month = t.date.slice(0, 7); const totals = months.get(month) || { income: 0n, expenses: 0n };
    if (t.amountCents > 0) totals.income += BigInt(t.amountCents); else totals.expenses -= BigInt(t.amountCents);
    months.set(month, totals);
  }
  const exact = (value: bigint) => { const result = Number(value); if (!Number.isSafeInteger(result)) throw new Error("Die Finanzsumme ist zu groß für eine genaue Cent-Berechnung."); return result; };
  sumCents([...balances.values()].map(exact));
  for (const totals of months.values()) { exact(totals.income); exact(totals.expenses); }
  sumCents(recurring.filter((r) => r.active && r.subscription).map((r) => sumCents(Array(12).fill(r.amountCents))));
  // Version 0.2.0 reused the first ID when editing identical subtask titles.
  // Repair only those local IDs; keep every title, completion flag and task intact.
  const tasks = data.tasks!.map((task) => {
    if (!task.subtasks) return task;
    const seen = new Set<string>();
    const subtasks = task.subtasks.map((sub) => {
      const id = seen.has(sub.id) ? crypto.randomUUID() : sub.id; seen.add(id);
      return id === sub.id ? sub : { ...sub, id };
    });
    return { ...task, subtasks };
  });
  return { version: 3, tasks, notes: data.notes!, passwords, accounts, transactions, recurring,
    ...(data.budgets !== undefined ? { budgets: data.budgets } : {}),
    ...(data.preferences !== undefined ? { preferences: data.preferences } : {}) };
}

export async function encryptVault(data: VaultData, key: CryptoKey, salt: string): Promise<VaultEnvelope> {
  const checked = normalizeData(data);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(checked))
  ));
  const envelope: VaultEnvelope = {
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt },
    cipher: { name: "AES-GCM", iv: toBase64(iv), data: toBase64(ciphertext) }
  };
  if (JSON.stringify(envelope).length > 10_000_000) throw new Error("Der verschlüsselte Tresor darf maximal 10 MB groß sein. Entferne große Anhänge oder teile den Import auf.");
  return envelope;
}

export async function createVault(passphrase: string): Promise<{ data: VaultData; key: CryptoKey; envelope: VaultEnvelope }> {
  if (passphrase.length < 14) throw new Error("Wähle mindestens 14 Zeichen für die Tresor-Passphrase.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const data: VaultData = { version: 3, tasks: [], notes: [], passwords: [], accounts: [], transactions: [], recurring: [] };
  const envelope = await encryptVault(data, key, toBase64(salt));
  return { data, key, envelope };
}

export async function unlockVault(envelope: VaultEnvelope, passphrase: string): Promise<{ data: VaultData; key: CryptoKey }> {
  const checked = parseEnvelope(JSON.stringify(envelope));
  const key = await deriveKey(passphrase, fromBase64(checked.kdf.salt));
  return { data: await decryptVaultWithKey(checked, key, checked.kdf.salt), key };
}

export async function decryptVaultWithKey(envelope: VaultEnvelope, key: CryptoKey, expectedSalt: string): Promise<VaultData> {
  const checked = parseEnvelope(JSON.stringify(envelope));
  if (checked.kdf.salt !== expectedSalt) throw new Error("Anderer Tresor: Passphrase zum Übernehmen erforderlich.");
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(checked.cipher.iv) as BufferSource },
      key, fromBase64(checked.cipher.data) as BufferSource
    );
  } catch {
    throw new Error("Passphrase falsch oder Tresor beschädigt.");
  }
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(plaintext)); }
  catch { throw new Error("Tresordaten beschädigt."); }
  return normalizeData(data);
}
