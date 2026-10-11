import type { Task, VaultData } from "./vault.ts";

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDate(date) === value;
}
export function nextTaskDate(value: string, repeat: Task["repeat"], anchorDay?: number): string {
  if (!validDate(value)) throw new Error("Ein gültiger Termin ist für Wiederholungen erforderlich.");
  const date = new Date(`${value}T12:00:00`);
  if (repeat === "monatlich") {
    const day = anchorDay || date.getDate();
    date.setDate(1); date.setMonth(date.getMonth() + 1);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  } else date.setDate(date.getDate() + (repeat === "wöchentlich" ? 7 : 1));
  return localDate(date);
}
export function completeTask(data: VaultData, id: string, done: boolean): void {
  const task = data.tasks.find((t) => t.id === id);
  if (!task) return;
  const wasDone = task.done;
  task.done = done; task.status = done ? "erledigt" : "offen";
  if (done && !wasDone && task.repeat && task.repeat !== "keine" && !task.successorId && task.due) {
    const next = structuredClone(task);
    next.id = crypto.randomUUID(); next.done = false; next.status = "offen";
    next.repeatDay = task.repeatDay || Number(task.due.slice(8, 10));
    next.due = nextTaskDate(task.due, task.repeat, next.repeatDay); next.createdAt = new Date().toISOString();
    delete next.successorId;
    if (task.reminderAt && validDate(task.reminderAt.slice(0, 10))) {
      const offset = Math.round((Date.parse(`${task.reminderAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${task.due}T00:00:00Z`)) / 86400000);
      const reminder = new Date(`${next.due}T12:00:00`); reminder.setDate(reminder.getDate() + offset);
      next.reminderAt = `${localDate(reminder)}T${task.reminderAt.split("T")[1] || "09:00"}`;
    }
    next.subtasks?.forEach((s) => { s.id = crypto.randomUUID(); s.done = false; });
    task.successorId = next.id; data.tasks.push(next);
  }
}
export function reusedPasswords(data: VaultData): Set<string> {
  const counts = new Map<string, number>();
  for (const entry of data.passwords) counts.set(entry.password, (counts.get(entry.password) || 0) + 1);
  return new Set(data.passwords.filter((entry) => (counts.get(entry.password) || 0) > 1).map((entry) => entry.id));
}
export function globalSearch(data: VaultData, query: string): { kind: string; id: string; title: string; detail: string }[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  return [
    ...data.tasks.map((t) => ({ kind: "tasks", id: t.id, title: t.title, detail: [t.due || "Ohne Termin", ...(t.subtasks || []).map((s) => s.title)].join(" · ") })),
    ...data.notes.map((n) => ({ kind: "notes", id: n.id, title: n.title, detail: [n.folder, ...(n.tags || []), n.body].filter(Boolean).join(" · ") })),
    ...data.passwords.map((p) => ({ kind: "passwords", id: p.id, title: p.title, detail: [p.username, p.url].join(" · ") })),
    ...data.transactions.map((t) => ({ kind: "finances", id: t.id, title: t.payee, detail: `${t.date} · ${t.category} · ${t.note}` })),
    ...data.recurring.map((t) => ({ kind: "finances", id: t.id, title: t.payee, detail: `${t.category} · ${t.cancelBy || ""}` }))
  ].filter((r) => `${r.title} ${r.detail}`.toLocaleLowerCase().includes(q)).slice(0, 50);
}

export function parseCsv(raw: string): string[][] {
  if (raw.length > 2_000_000) throw new Error("CSV zu groß (maximal 2 MB).");
  const text = raw.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0];
  const separator = first.includes(";") ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === "") quoted = !quoted;
      else throw new Error("Ungültige CSV-Anführungszeichen.");
    } else if (!quoted && (c === separator || c === "\n" || c === "\r")) {
      row.push(field); field = "";
      if (c !== separator) { if (row.some(Boolean)) rows.push(row); row = []; if (c === "\r" && text[i + 1] === "\n") i++; }
    } else field += c;
  }
  if (quoted) throw new Error("CSV enthält ein nicht geschlossenes Feld.");
  row.push(field); if (row.some(Boolean)) rows.push(row);
  if (rows.length > 5001) throw new Error("Maximal 5000 Buchungen pro Import.");
  return rows;
}
export interface CsvTransaction { date: string; amountCents: number; payee: string; category: string; note: string }
export function transactionCsv(raw: string): CsvTransaction[] {
  const rows = parseCsv(raw); const headers = rows.shift()?.map((h) => h.trim().toLocaleLowerCase()) || [];
  const indices = ["datum", "betrag", "empfänger", "kategorie", "notiz"].map((h) => headers.indexOf(h));
  if (indices.slice(0, 3).some((i) => i < 0)) throw new Error("CSV braucht die Spalten Datum, Betrag und Empfänger. Kategorie und Notiz sind optional.");
  return rows.map((row, index) => {
    const [date, amount, payee, category, note] = indices.map((i) => row[i]?.trim() || "");
    const value = amount.replace(",", ".");
    if (!validDate(date) || !/^-?\d{1,9}(\.\d{1,2})?$/.test(value) || !payee || payee.length > 160 || category.length > 80 || note.length > 500) throw new Error(`Ungültige Buchung in CSV-Zeile ${index + 2}. Datum: JJJJ-MM-TT; Betrag: negativ für Ausgaben.`);
    const [whole, decimal = ""] = value.replace("-", "").split(".");
    const amountCents = (Number(whole) * 100 + Number(decimal.padEnd(2, "0"))) * (value.startsWith("-") ? -1 : 1);
    if (!amountCents) throw new Error(`Betrag in Zeile ${index + 2} ist null.`);
    return { date, amountCents, payee, category, note };
  });
}
export function csvCell(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
export function tasksCalendar(tasks: Task[]): string {
  const escape = (s: string) => s.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
  // Fold long UTF-8 content lines according to RFC 5545.
  const fold = (line: string) => { let out = "", size = 0; for (const c of line) { const bytes = new TextEncoder().encode(c).length; if (size + bytes > 73) { out += "\r\n "; size = 1; } out += c; size += bytes; } return out; };
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AllINONE//Aufgaben//DE", ...tasks.filter((t) => t.due && !t.done).flatMap((t) => ["BEGIN:VEVENT", `UID:${escape(t.id)}@allinone`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`, `DTSTART;VALUE=DATE:${t.due!.replaceAll("-", "")}`, `SUMMARY:${escape(t.title)}`, "END:VEVENT"]), "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
export function downloadFile(name: string, content: BlobPart, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
