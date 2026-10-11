import type { ViewContext } from "./features";
import { formatEuro, parseEuro, monthTotals } from "./domain";
import { localDate, transactionCsv, downloadFile, csvCell } from "./productivity";
let selectedMonth = localDate().slice(0, 7);
export function renderFinanceExtras(ctx: ViewContext): void {
  const { content, data, element: el } = ctx;
  const panel = el("section", "panel"); panel.append(el("h2", "", "Budgets & Auswertungen"));
  const month = el("input"); month.type = "month"; month.value = selectedMonth; month.setAttribute("aria-label", "Auswertungsmonat"); month.onchange = () => { selectedMonth = month.value; ctx.render(); }; panel.append(month);
  const totals = monthTotals(data.transactions, selectedMonth);
  panel.append(el("p", "", `${selectedMonth}: Einnahmen ${formatEuro(totals.income)} · Ausgaben ${formatEuro(totals.expenses)} · Differenz ${formatEuro(totals.income - totals.expenses)}`));
  const categories = new Map<string, number>();
  for (const tx of data.transactions.filter((t) => t.date.startsWith(selectedMonth) && t.amountCents < 0)) categories.set(tx.category || "Ohne Kategorie", (categories.get(tx.category || "Ohne Kategorie") || 0) - tx.amountCents);
  for (const [category, cents] of [...categories].sort((a, b) => b[1] - a[1])) {
    const row = el("div", "budget-row"); row.append(el("span", "", `${category} · ${formatEuro(cents)}`));
    const meter = el("progress"); meter.max = Math.max(totals.expenses, 1); meter.value = cents; meter.setAttribute("aria-label", `Anteil ${category}`); row.append(meter); panel.append(row);
  }
  const form = el("form"); form.innerHTML = '<div class="form-pair"><div><label for="budget-category">Budget-Kategorie</label><input id="budget-category" maxlength="80" required /></div><div><label for="budget-amount">Monatsbudget in €</label><input id="budget-amount" inputmode="decimal" required /></div></div><button class="primary form-submit">Budget speichern</button>';
  form.onsubmit = async (e) => { e.preventDefault(); try {
    const category = form.querySelector<HTMLInputElement>("#budget-category")!.value.trim(); if (!category) throw new Error("Kategorie fehlt.");
    const amountCents = parseEuro(form.querySelector<HTMLInputElement>("#budget-amount")!.value); if (!amountCents) throw new Error("Budget muss größer als null sein.");
    await ctx.changeData((d) => { const budgets = d.budgets ||= []; const existing = budgets.find((b) => b.month === selectedMonth && b.category === category); if (existing) existing.amountCents = amountCents; else budgets.push({ id: crypto.randomUUID(), month: selectedMonth, category, amountCents }); });
  } catch (e) { window.alert(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); } }; panel.append(form);
  for (const budget of (data.budgets || []).filter((b) => b.month === selectedMonth)) {
    const spent = categories.get(budget.category) || 0; const row = el("div", "budget-row");
    row.append(el("strong", spent > budget.amountCents ? "negative" : "", `${budget.category}: ${formatEuro(spent)} / ${formatEuro(budget.amountCents)}`));
    const meter = el("progress"); meter.max = budget.amountCents; meter.value = spent; meter.setAttribute("aria-label", `Budget ${budget.category}`);
    const remove = el("button", "text-button danger", "Budget entfernen"); remove.onclick = () => { if (window.confirm("Budget entfernen?")) void ctx.changeData((d) => { d.budgets = d.budgets?.filter((b) => b.id !== budget.id); }).catch(() => window.alert("Speichern fehlgeschlagen.")); }; row.append(meter, remove); panel.append(row);
  }
  content.append(panel);
  const subscriptions = el("section", "panel"); subscriptions.append(el("h2", "", "Abos & Kündigungsfristen"));
  const active = data.recurring.filter((r) => r.subscription && r.active);
  subscriptions.append(el("p", "", `Aktive Abos: ${formatEuro(active.reduce((sum, r) => sum + r.amountCents, 0))} pro Monat · ${formatEuro(active.reduce((sum, r) => sum + r.amountCents, 0) * 12)} pro Jahr`));
  for (const r of data.recurring.filter((r) => r.subscription)) { const row = el("div", "finance-row"); row.append(el("strong", "", r.payee), el("span", r.cancelBy && r.cancelBy <= localDate() ? "negative" : "", `${r.active ? "Aktiv" : "Pausiert"} · ${formatEuro(r.amountCents)} · Kündigen bis: ${r.cancelBy || "Nicht angegeben"}`)); subscriptions.append(row); }
  if (!active.length) subscriptions.append(el("p", "empty", "Markiere eine wiederkehrende Zahlung als Abo.")); content.append(subscriptions);
  if (!data.accounts.length) return;
  const csv = el("section", "panel"); csv.append(el("h2", "", "CSV-Import & Export"), el("p", "hint", "Spalten: Datum;Betrag;Empfänger;Kategorie;Notiz. Datum JJJJ-MM-TT, negative Beträge sind Ausgaben. Prüfe die Vorschau vor dem Import. Gleiche Buchungen werden als Duplikate übersprungen."));
  const account = el("select"); account.setAttribute("aria-label", "CSV-Zielkonto"); data.accounts.forEach((a) => account.add(new Option(a.name, a.id))); csv.append(account);
  const label = el("label", "outline-button", "CSV auswählen"); const input = el("input"); input.type = "file"; input.accept = ".csv,text/csv"; input.className = "visually-hidden"; label.append(input); csv.append(label);
  const preview = el("div"); csv.append(preview);
  input.onchange = async () => { try {
    const file = input.files?.[0]; if (!file) return; if (file.size > 2_000_000) throw new Error("CSV zu groß.");
    const items = transactionCsv(await file.text()); const accountId = account.value;
    const fingerprint = (t: { date: string; amountCents: number; payee: string; category: string; note: string }) => JSON.stringify([t.date, t.amountCents, t.payee, t.category, t.note]);
    const seen = new Set(data.transactions.filter((t) => t.accountId === accountId).map(fingerprint));
    const unique = items.filter((t) => { const f = fingerprint(t); if (seen.has(f)) return false; seen.add(f); return true; });
    preview.replaceChildren(el("p", "", `${unique.length} neue Buchungen für ${data.accounts.find((a) => a.id === accountId)?.name}, ${items.length - unique.length} Duplikate. Summe: ${formatEuro(unique.reduce((s, t) => s + t.amountCents, 0))}`));
    unique.slice(0, 10).forEach((t) => preview.append(el("p", "", `${t.date} · ${t.payee} · ${formatEuro(t.amountCents)}`)));
    const commit = el("button", "primary", "CSV-Buchungen importieren"); commit.disabled = !unique.length;
    commit.onclick = async () => { commit.disabled = true; try { await ctx.changeData((d) => { const existing = new Set(d.transactions.filter((t) => t.accountId === accountId).map(fingerprint)); for (const tx of unique) if (!existing.has(fingerprint(tx))) d.transactions.push({ ...tx, id: crypto.randomUUID(), accountId, updatedAt: new Date().toISOString() }); }); } catch { commit.disabled = false; window.alert("Import fehlgeschlagen."); } }; preview.append(commit);
  } catch (e) { preview.textContent = e instanceof Error ? e.message : "Import fehlgeschlagen."; } };
  const exportButton = el("button", "outline-button", "Buchungen als CSV exportieren"); exportButton.onclick = () => downloadFile("allinone-buchungen.csv", "\uFEFFDatum;Betrag;Empfänger;Kategorie;Notiz;Konto\r\n" + data.transactions.map((t) => [t.date, (t.amountCents / 100).toFixed(2).replace(".", ","), t.payee, t.category, t.note, data.accounts.find((a) => a.id === t.accountId)?.name || ""].map((cell, index) => csvCell(index !== 1 && /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell)).join(";")).join("\r\n"), "text/csv"); csv.append(exportButton); content.append(csv);
}
